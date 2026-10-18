#!/usr/bin/env python3
"""BestRunning · analizador musical "de DJ".

Para cada pista de audio/music-src/ (con metadatos en picks.tsv):
  1. Normaliza sonoridad a -14 LUFS (true peak -1 dBTP), recorta silencios y codifica AAC 160 kbps (.m4a).
  2. Mide BPM con precisión de centésimas (envolvente de onsets + peine de pulsos), fase del primer tiempo
     y el tiempo fuerte del compás (downbeat).
  3. Calcula energía por compás, puntos de "drop", entrada para mezclar (mixIn) y salida (outro).
  4. Escribe audio/music/library.json, que usa el motor de música de la app.

Uso: python3 tools/music/analyze.py [--force]
     python3 tools/music/analyze.py --new [--force] [--only=id1,id2]
       --new: modo incremental. Conserva tal cual las pistas que ya están en library.json y añade (o rehace, con
              --only) las de audio/music-src/nuevas/manifest.json (lista de { file, title, artist, url, tier,
              stated_bpm }). FORCE_BPM fija el tempo de las pistas que el detector dobla o parte por la mitad.
Requiere ffmpeg/ffprobe y numpy.
"""
import json
import subprocess
import sys
import re
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "audio" / "music-src"
OUT = ROOT / "audio" / "music"
SR = 22050
HOP = 256
FR = SR / HOP  # frames por segundo de la envolvente

# Rangos de BPM esperados por tramo (prior suave para resolver dobles/mitades de tempo).
TIER_PRIOR = {"calm": 110, "jog": 123, "run": 128, "fast": 138, "sprint": 165}
TIER_RANGES = [("calm", 0, 118), ("jog", 118, 126), ("run", 126, 134), ("fast", 134, 148), ("sprint", 148, 999)]
TIER_ORDER = [name for name, _lo, _hi in TIER_RANGES]
NEW_MANIFEST = SRC / "nuevas" / "manifest.json"

# Tempo impuesto por pista (id → BPM) cuando el detector cae en el doble o la mitad del tempo real.
# Se revisa con el BPM declarado por el autor y con el peine por bandas (bombo / caja / agudos).
FORCE_BPM = {
    # Declarado 160, pero no hay periodicidad a 160: el peine marca 95 (caja a medio tiempo) y 190 → DnB a 190
    "twinfish-pivot-drum-and-bass-twinfishaudio": 190.0,
}

# Tramo corregido (id → tramo) cuando el BPM medido contradice la estimación de docs/musica-nueva/candidatas.md.
TIER_OVERRIDE = {
    # Estimada «~174 (est.)» como neurofunk; medida 120 (agudos clavados a la rejilla de 120): es un tema de trote
    "neurobeat-soundreality": "jog",
    # Declarada 160 (sprint nativo según el doc): medida 95/190 → sprint nativo a 190
    "twinfish-pivot-drum-and-bass-twinfishaudio": "sprint",
}

# Rejilla desplazada medio tiempo (id): el peine de onsets se engancha a los platos abiertos a contratiempo y el bombo
# cae a +1/2 tiempo (flujo del bombo a contratiempo ≥ 3× y ataques del subgrave concentrados en esa fase).
HALF_BEAT_SHIFT = {
    "funky-summer-house-berrydeep",
    "pulse-check-128-german-techno-djfunkypharmacist",
    "techno-prettyjohn1",
    "midnight-drift-pwlpl",
    # Mismo patrón con ataques del subgrave en la segunda mitad del tiempo (flujo del bombo a contratiempo ≥ 2×)
    "feelings-122-bpm-house-instrum-thisisbeatkitchen",
    "modern-deep-house-artissizm",
    "afro-house-artissizm",
    "inception-inspired-dark-melodic-t-saturn-3-music",
    "241029-techno-dark-minimal-welc0me-0",
    "eurodance-hyperpop-type-beat-140-bpm-van-wiese",
}


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, **kw)


def slugify(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:48]


def normalize_encode(src: Path, dst: Path):
    """Dos pasadas de loudnorm + recorte de silencios → AAC 160 kbps."""
    pre = "silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.05," \
          "areverse,silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.3,areverse"
    p1 = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(src), "-af",
         pre + ",loudnorm=I=-14:TP=-1:LRA=11:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", p1.stderr, re.S)
    meas = json.loads(m.group(0))
    ln = ("loudnorm=I=-14:TP=-1:LRA=11:measured_I={input_i}:measured_TP={input_tp}:"
          "measured_LRA={input_lra}:measured_thresh={input_thresh}:offset={target_offset}:linear=true"
          ).format(**meas)
    run(["ffmpeg", "-hide_banner", "-y", "-i", str(src), "-af", pre + "," + ln,
         "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
         "-map_metadata", "-1", str(dst)])
    return float(meas["input_i"])


def decode_mono(path: Path):
    p = run(["ffmpeg", "-hide_banner", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"])
    return np.frombuffer(p.stdout, dtype=np.float32).copy()


def stft_mag(y, n_fft=2048, hop=HOP):
    win = np.hanning(n_fft).astype(np.float32)
    n = 1 + (len(y) - n_fft) // hop
    idx = np.arange(n_fft)[None, :] + hop * np.arange(n)[:, None]
    frames = y[idx] * win
    return np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32)  # (frames, bins)


def onset_envelope(S):
    L = np.log1p(100 * S)
    flux = np.maximum(0, np.diff(L, axis=0)).sum(axis=1)
    flux = np.concatenate([[0], flux])
    # quitar tendencia lenta y normalizar
    k = int(FR)  # ~1 s
    trend = np.convolve(flux, np.ones(k) / k, mode="same")
    env = np.maximum(0, flux - trend)
    return env / (env.max() + 1e-9)


def comb_score(env, bpm, phases=None):
    period = 60 * FR / bpm
    nbeats = int((len(env) - 1) / period) - 1
    if nbeats < 8:
        return 0.0, 0.0
    k = np.arange(nbeats) * period
    if phases is None:
        phases = np.arange(0, period, 0.5)
    pos = phases[:, None] + k[None, :]
    i0 = np.floor(pos).astype(int)
    frac = pos - i0
    i1 = np.minimum(i0 + 1, len(env) - 1)
    vals = env[i0] * (1 - frac) + env[i1] * frac
    scores = vals.mean(axis=1)
    j = int(np.argmax(scores))
    return float(scores[j]), float(phases[j])


def estimate_tempo(env, prior_bpm):
    # 1) barrido grueso 80–190 BPM
    grid = np.arange(80, 190, 0.25)
    sc = np.array([comb_score(env, b)[0] for b in grid])
    # prior log-gaussiano suave para resolver mitades/dobles
    prior = np.exp(-0.5 * (np.log2(grid / prior_bpm) / 0.35) ** 2)
    weighted = sc * (0.6 + 0.4 * prior)
    coarse = float(grid[int(np.argmax(weighted))])
    # 2) afinado ±0,6 BPM con paso 0,01
    fine = np.arange(coarse - 0.6, coarse + 0.6, 0.01)
    best = max(((comb_score(env, b)[0], b) for b in fine))
    bpm = best[1]
    # Redondeo a .0/.5 si está muy cerca (producción electrónica suele ser entera)
    for target in (round(bpm), round(bpm * 2) / 2):
        if abs(bpm - target) < 0.06:
            bpm = float(target)
            break
    score, phase = comb_score(env, bpm, phases=np.arange(0, 60 * FR / bpm, 0.25))
    confidence = float(score / (np.mean(sc) + 1e-9))
    return round(bpm, 2), phase / FR, confidence


def band_energy(S, lo, hi):
    freqs = np.fft.rfftfreq(2048, 1 / SR)
    m = (freqs >= lo) & (freqs < hi)
    return S[:, m].sum(axis=1)


def beat_features(S, beat_times):
    """Energía media por tiempo en bandas (graves, medios, agudos) y total."""
    bands = [band_energy(S, 30, 150), band_energy(S, 150, 2000), band_energy(S, 2000, 11000)]
    fidx = (np.asarray(beat_times) * FR).astype(int)
    feats = []
    for a, b in zip(fidx[:-1], fidx[1:]):
        b = max(b, a + 1)
        feats.append([float(x[a:b].mean()) for x in bands])
    return np.array(feats)


def analyze(path: Path, prior_bpm, force_bpm=None, half_beat=False):
    y = decode_mono(path)
    dur = len(y) / SR
    S = stft_mag(y)
    env = onset_envelope(S)
    bpm, first_beat, conf = estimate_tempo(env, prior_bpm)
    if force_bpm:
        # Tempo impuesto (p. ej. DnB detectado a medio tiempo): rehacer fase y rejilla al tempo real
        bpm = float(force_bpm)
        _, phase = comb_score(env, bpm, phases=np.arange(0, 60 * FR / bpm, 0.25))
        first_beat = phase / FR
    spb = 60 / bpm
    if half_beat:
        # El bombo cae medio tiempo después de la fase del peine: se mueve la rejilla (y con ella compás y cues)
        first_beat = (first_beat + spb / 2) % spb
    beat_times = np.arange(first_beat, dur, spb)
    feats = beat_features(S, beat_times)  # (beats-1, 3)
    nb = len(feats)
    # Downbeat: los inicios de compás concentran más novedad tímbrica entre tiempos.
    logf = np.log1p(feats)
    nov = np.concatenate([[0], np.abs(np.diff(logf, axis=0)).sum(axis=1)])
    bass = logf[:, 0]
    best_r, best_v = 0, -1
    for r in range(4):
        v = nov[r::4].mean() + 0.35 * (bass[r::4].mean() - bass.mean())
        if v > best_v:
            best_r, best_v = r, v
    bar_offset = float(beat_times[best_r])
    # Energía por compás (4 tiempos)
    total = feats.sum(axis=1)
    bars = []
    for i in range(best_r, nb - 3, 4):
        bars.append(float(np.mean(total[i:i + 4])))
    bars = np.array(bars) if bars else np.array([1.0])
    e = bars / (np.percentile(bars, 95) + 1e-9)
    e = np.clip(e, 0, 1)
    spbar = 4 * spb
    bar_time = lambda i: round(bar_offset + i * spbar, 3)
    # mixIn: primer compás (alineado a 8) con energía ≥ 0,6
    mix_in_bar = next((i for i in range(len(e)) if e[i] >= 0.6), 0)
    mix_in_bar = (mix_in_bar // 8) * 8 if mix_in_bar >= 8 else mix_in_bar
    # drops: subida brusca de energía tras una sección más baja
    drops = []
    for i in range(4, len(e)):
        prev = e[max(0, i - 4):i].mean()
        if e[i] >= 0.8 and prev < 0.62 and (not drops or i - drops[-1] >= 16):
            drops.append(i)
    # outro: último compás con energía alta antes del final
    hi = [i for i in range(len(e)) if e[i] >= 0.7]
    outro_bar = hi[-1] + 1 if hi else len(e) - 8
    # zonas calientes: compases con energía ≥ 0,8 (para sprints)
    hot = [i for i in range(len(e)) if e[i] >= 0.8]
    return {
        "duration": round(dur, 3),
        "bpm": bpm,
        "confidence": round(conf, 2),
        "beatOffset": round(first_beat, 3),
        "barOffset": round(bar_offset, 3),
        "bars": len(e),
        "energy": [round(float(x), 2) for x in e],
        "cues": {
            "mixIn": bar_time(mix_in_bar),
            "drops": [bar_time(i) for i in drops],
            "outro": bar_time(max(outro_bar, mix_in_bar + 8)),
            "hotBars": hot,
        },
    }


def tier_for(bpm):
    for name, lo, hi in TIER_RANGES:
        if lo <= bpm < hi:
            return name
    return "sprint"


def track_id(title, artist):
    """Id estable «título-artista» (≤ 48 caracteres); si no cabe, se recorta el título y se conserva el artista."""
    tid = slugify(f"{title}-{artist}")
    a = re.sub(r"[^a-z0-9]+", "-", artist.lower()).strip("-")
    full = re.sub(r"[^a-z0-9]+", "-", f"{title}-{artist}".lower()).strip("-")
    if len(full) > 48 and a and len(a) < 30:
        t = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:47 - len(a)].strip("-")
        tid = f"{t}-{a}"
    return tid


def build_entry(src, tier, title, artist, page, force, prior_bpm=None, tid=None):
    tid = tid or slugify(f"{title}-{artist}")
    dst = OUT / f"{tid}.m4a"
    if force or not dst.exists():
        normalize_encode(src, dst)
    forced = FORCE_BPM.get(tid)
    half = tid in HALF_BEAT_SHIFT
    prior = prior_bpm or TIER_PRIOR[tier]
    a = analyze(dst, prior, force_bpm=forced, half_beat=half)
    bpm = a["bpm"]
    # DnB/hard: si el detector cae en la mitad (≈85–95) y se eligió para sprint, doblar y rehacer la rejilla.
    if not forced and tier == "sprint" and bpm < 100:
        a = analyze(dst, prior, force_bpm=round(bpm * 2, 2), half_beat=half)
        bpm = a["bpm"]
    entry = {
        "id": tid,
        "file": f"audio/music/{tid}.m4a",
        "title": title,
        "artist": artist,
        "source": "Pixabay",
        "page": page,
        "license": "Pixabay Content License",
        "curatedTier": tier,
        "tier": tier_for(bpm),
        "sizeBytes": dst.stat().st_size,
        **a,
    }
    if forced:
        entry["forcedBpm"] = True
    if half:
        entry["gridShift"] = "half-beat"
    return entry


def log_entry(e, extra=""):
    print(f"{e['curatedTier']:6s} → {e['tier']:6s} {e['bpm']:7.2f} BPM conf {e['confidence']:4.2f}  "
          f"{e['duration']:6.1f}s  bar {e['barOffset']:5.2f}  mixIn {e['cues']['mixIn']:6.1f}  "
          f"drops {e['cues']['drops'][:3]}  outro {e['cues']['outro']:6.1f}  {e['title']} · {e['artist']}{extra}",
          flush=True)


def main_new():
    """Modo incremental: library.json actual + pistas de nuevas/manifest.json."""
    force = "--force" in sys.argv
    only = None
    for arg in sys.argv[1:]:
        if arg.startswith("--only="):
            only = {x.strip() for x in arg.split("=", 1)[1].split(",") if x.strip()}
    lib_path = OUT / "library.json"
    lib = json.loads(lib_path.read_text()) if lib_path.exists() else {"version": 1, "tracks": []}
    tracks = list(lib.get("tracks", []))
    by_id = {t["id"]: i for i, t in enumerate(tracks)}
    manifest = json.loads(NEW_MANIFEST.read_text())
    seen = set()
    for m in manifest:
        tid = track_id(m["title"], m["artist"])
        tier = TIER_OVERRIDE.get(tid, m["tier"])
        if tid in seen:
            raise SystemExit(f"id repetido en el manifiesto: {tid}")
        seen.add(tid)
        if only is not None and tid not in only:
            continue
        if only is None and tid in by_id and not force:
            continue
        src = NEW_MANIFEST.parent / m["file"]
        stated = m.get("stated_bpm")
        e = build_entry(src, tier, m["title"], m["artist"], m["url"], force,
                        prior_bpm=float(stated) if stated else None, tid=tid)
        if stated:
            e["statedBpm"] = float(stated)
        if tid in by_id:
            tracks[by_id[tid]] = e
        else:
            by_id[tid] = len(tracks)
            tracks.append(e)
        log_entry(e, f"  (declarado {stated})" if stated else "")
        # Guardado tras cada pista: si se corta, lo hecho no se pierde
        _write_library(tracks, lib_path)
    _write_library(tracks, lib_path)
    total = sum(t["sizeBytes"] for t in tracks)
    print(f"\n{len(tracks)} pistas · {total/1e6:.1f} MB · audio/music/library.json")


def _write_library(tracks, lib_path):
    # Orden estable: por tramo curado (calma → sprint) y, dentro de cada uno, en el orden de alta
    order = {k: i for i, k in enumerate(TIER_ORDER)}
    ranked = sorted(enumerate(tracks), key=lambda p: (order.get(p[1].get("curatedTier"), 9), p[0]))
    out = {"version": 1, "generated": "tools/music/analyze.py", "lufs": -14, "tracks": [t for _, t in ranked]}
    tmp = lib_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    tmp.replace(lib_path)


def main():
    if "--new" in sys.argv:
        return main_new()
    force = "--force" in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    rows = [l.rstrip("\n").split("\t") for l in (SRC / "picks.tsv").read_text().splitlines() if l.strip()]
    tracks = []
    for tier, title, artist, _sec, url, page in rows:
        fname = re.search(r"filename=([^&]+)", url).group(1)
        src = SRC / fname
        tid = slugify(f"{title}-{artist}")
        dst = OUT / f"{tid}.m4a"
        if force or not dst.exists():
            lufs_in = normalize_encode(src, dst)
        else:
            lufs_in = None
        a = analyze(dst, TIER_PRIOR[tier])
        bpm = a["bpm"]
        # DnB/hard: si el detector cae en la mitad (≈85–95) y se eligió para sprint, doblar y rehacer la rejilla.
        if tier == "sprint" and bpm < 100:
            a = analyze(dst, TIER_PRIOR[tier], force_bpm=round(bpm * 2, 2))
            bpm = a["bpm"]
        measured_tier = tier_for(bpm)
        tracks.append({
            "id": tid,
            "file": f"audio/music/{tid}.m4a",
            "title": title,
            "artist": artist,
            "source": "Pixabay",
            "page": page,
            "license": "Pixabay Content License",
            "curatedTier": tier,
            "tier": measured_tier,
            "sizeBytes": dst.stat().st_size,
            **a,
        })
        print(f"{tier:6s} → {measured_tier:6s} {bpm:7.2f} BPM conf {a['confidence']:4.2f}  "
              f"{a['duration']:6.1f}s  mixIn {a['cues']['mixIn']:6.1f}  drops {a['cues']['drops'][:3]}  {title} · {artist}")
    lib = {"version": 1, "generated": "tools/music/analyze.py", "lufs": -14, "tracks": tracks}
    (OUT / "library.json").write_text(json.dumps(lib, ensure_ascii=False, indent=1))
    total = sum(t["sizeBytes"] for t in tracks)
    print(f"\n{len(tracks)} pistas · {total/1e6:.1f} MB · audio/music/library.json")


if __name__ == "__main__":
    main()
