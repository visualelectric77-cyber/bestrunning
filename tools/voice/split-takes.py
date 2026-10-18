#!/usr/bin/env python3
"""BestRunning · recorta tomas largas de ElevenLabs en clips del pack de voz y los verifica con whisper.

Cada toma (audio/packs/_takes/<parte>.take1.mp3 / .take2.mp3) contiene, en orden, las frases de
audio/packs/_takes/order.json[<parte>].
  1. Alineación: programación dinámica sobre los silencios detectados + duración esperada por sílabas.
  2. Recorte fino: márgenes dentro de las pausas y detección precisa de inicio/fin de voz (sin comerse
     consonantes suaves del arranque).
  3. Verificación: cada candidato de cada toma se transcribe con whisper (es) y se compara con la frase;
     se elige la toma que coincide mejor (desempate: duración esperada).
Salida: audio/packs/eva/<id>.mp3 + index.json + packs.json y audio/packs/_takes/informe.txt.

Uso: python3 tools/voice/split-takes.py [parte ...]
"""
import difflib
import json
import math
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TAKES = ROOT / "audio" / "packs" / "_takes"
CAND = TAKES / "_cand"
OUT = ROOT / "audio" / "packs" / "eva"
WHISPER_MODEL = Path.home() / ".cache" / "hyperframes" / "whisper" / "models" / "ggml-small.bin"
SR = 22050
HOP = 0.01

STRONG = set("aeoáéíóú")


# ───────────── texto ─────────────
def syllables(text):
    t = re.sub(r"\[[^\]]*\]", " ", text.lower())
    n = 0
    for w in re.findall(r"[a-záéíóúüñ]+", t):
        for g in re.findall(r"[aeiouáéíóúü]+", w):
            n += 1 + sum(1 for a, b in zip(g, g[1:]) if a in STRONG and b in STRONG)
    return max(1, n)


def weight(text):
    inner = text.strip().rstrip(".!¡?…")
    return syllables(text) + 1.6 * len(re.findall(r"[,:;.!?…]", inner)) + 0.6


UNITS = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce",
         "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno",
         "veintidos", "veintitres", "veinticuatro", "veinticinco", "veintiseis", "veintisiete", "veintiocho", "veintinueve"]
TENS = {30: "treinta", 40: "cuarenta", 50: "cincuenta", 60: "sesenta", 70: "setenta", 80: "ochenta", 90: "noventa"}


def int_es(n):
    if n < 30:
        return UNITS[n]
    if n < 100:
        t, u = divmod(n, 10)
        return TENS[t * 10] + ("" if u == 0 else " y " + UNITS[u])
    return str(n)


def norm(s):
    s = s.lower()
    s = re.sub(r"(\d+)[,.](\d)\b", lambda m: f"{int_es(int(m.group(1)))} coma {int_es(int(m.group(2)))}", s)
    s = re.sub(r"\d+", lambda m: int_es(int(m.group(0))), s)
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"\bun\b", "uno", s)
    s = re.sub(r"[^a-zñ ]+", " ", s)
    return " ".join(s.split())


def similarity(heard, expected):
    a, b = norm(heard).replace(" ", ""), norm(expected).replace(" ", "")
    if not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


# ───────────── audio ─────────────
def decode(path):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32)


def frame_db(y):
    hop = int(SR * HOP)
    win = hop * 2
    n = max(1, (len(y) - win) // hop)
    idx = np.arange(win)[None, :] + hop * np.arange(n)[:, None]
    return 20 * np.log10(np.sqrt(np.mean(y[idx] ** 2, axis=1) + 1e-12) + 1e-9)


def silences(db, min_len=0.07):
    ref = np.percentile(db, 95)
    sil = db < max(ref - 30, -50)
    runs, i, n = [], 0, len(sil)
    while i < n:
        if sil[i]:
            j = i
            while j < n and sil[j]:
                j += 1
            runs.append((i * HOP, j * HOP))
            i = j
        else:
            i += 1
    lead = runs[0][1] if runs and runs[0][0] == 0 else 0.0
    tail = runs[-1][0] if runs and runs[-1][1] >= (n - 1) * HOP else n * HOP
    cands = [(a, b) for a, b in runs if b - a >= min_len and a > lead + 0.05 and b < tail - 0.05]
    return lead, tail, cands


def align(weights, lead, tail, cands, beta=0.55):
    """Devuelve [(ini, fin, sil_prev, sil_next)] por clip; sil_* = (a, b) del silencio usado o None."""
    N, M = len(weights), len(cands)
    if M < N - 1:
        raise ValueError(f"solo {M} silencios para {N} clips")
    w = np.array(weights, dtype=float)
    gaps = sorted((b - a for a, b in cands), reverse=True)[: N - 1]
    exp = (tail - lead - sum(gaps)) * w / w.sum()
    starts = [lead] + [b for a, b in cands]
    ends = [a for a, b in cands] + [tail]
    glen = [b - a for a, b in cands]
    INF = 1e18
    prev = [INF] * (M + 1)
    for k in range(M + 1):
        d = ends[k] - lead
        if d > 0.05:
            prev[k] = math.log(d / exp[0]) ** 2 - (beta * math.log(1 + glen[k] / 0.12) if k < M else 0)
    back = [None]
    for i in range(1, N):
        cur = [INF] * (M + 1)
        bk = [-1] * (M + 1)
        last = i == N - 1
        for k in ([M] if last else range(i, M)):
            best, arg = INF, -1
            for j in range(i - 1, k):
                if prev[j] >= INF:
                    continue
                d = ends[k] - starts[j + 1]
                if d <= 0.05:
                    continue
                c = prev[j] + math.log(d / exp[i]) ** 2
                if c < best:
                    best, arg = c, j
            if arg >= 0:
                cur[k] = best - (0 if last else beta * math.log(1 + glen[k] / 0.12))
                bk[k] = arg
        back.append(bk)
        prev = cur
    if prev[M] >= INF:
        raise ValueError("sin alineación válida")
    cuts, k = [], M
    for i in range(N - 1, 0, -1):
        j = back[i][k]
        cuts.append(j)
        k = j
    cuts.reverse()
    segs, s, sp = [], lead, None
    for j in cuts:
        segs.append((s, ends[j], sp, cands[j]))
        s, sp = starts[j + 1], cands[j]
    segs.append((s, tail, sp, None))
    return segs, exp, float(prev[M]) / N


def whisper_words(path):
    """Palabras reconocidas en la toma completa: [(palabra_normalizada, ini, fin)]."""
    if not WHISPER_MODEL.exists() or not shutil.which("whisper-cli"):
        return []
    wav = CAND / (path.stem + ".full.wav")
    base = CAND / (path.stem + ".full")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(path), "-ar", "16000", "-ac", "1",
                    str(wav)], check=True)
    subprocess.run(["whisper-cli", "-m", str(WHISPER_MODEL), "-l", "es", "-ml", "1", "-sow", "-oj", "-of", str(base),
                    "-np", "-f", str(wav)], capture_output=True)
    words = []
    try:
        data = json.loads(Path(str(base) + ".json").read_text())
        for seg in data.get("transcription", []):
            toks = norm(seg.get("text", "")).split()
            a, b = seg["offsets"]["from"] / 1000, seg["offsets"]["to"] / 1000
            for k, t in enumerate(toks):  # números que se expanden a varias palabras
                words.append((t, a + (b - a) * k / len(toks), a + (b - a) * (k + 1) / len(toks)))
    except Exception:
        words = []
    wav.unlink(missing_ok=True)
    return words


def align_words(clips, words, lead, tail, cands):
    """Cortes guiados por palabras reconocidas; None si la coincidencia es pobre."""
    exp_tok, owner = [], []
    for i, c in enumerate(clips):
        for t in norm(re.sub(r"\[[^\]]*\]", " ", c["text"])).split():
            exp_tok.append(t)
            owner.append(i)
    rec_tok = [w[0] for w in words]
    sm = difflib.SequenceMatcher(None, exp_tok, rec_tok, autojunk=False)
    match = {}
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            match[blk.a + k] = blk.b + k
    if len(match) < 0.6 * len(exp_tok):
        return None
    N = len(clips)
    first, last = [None] * N, [None] * N
    for ei, ri in sorted(match.items()):
        i = owner[ei]
        if first[i] is None:
            first[i] = words[ri][1]
        last[i] = words[ri][2]
    bounds = []  # silencio (a, b) o instante entre clip i e i+1
    floor = lead + 0.15
    for i in range(N - 1):
        te = last[i] if last[i] is not None else (first[i + 1] if first[i + 1] is not None else None)
        ts = first[i + 1] if first[i + 1] is not None else te
        if te is None:
            return None
        lo, hi = min(te, ts) - 0.35, max(te, ts) + 0.35
        best = None
        for a, b in cands:
            if a < floor:
                continue
            if b >= lo and a <= hi:
                score = (b - a) - 0.6 * abs((a + b) / 2 - (te + ts) / 2)
                if best is None or score > best[0]:
                    best = (score, (a, b))
        if best:
            bnd = best[1]
        else:
            mid = max((te + ts) / 2, floor + 0.01)
            bnd = (mid - 0.01, mid + 0.01)
        if bnd[0] < floor or bnd[1] > tail - 0.15:
            return None
        bounds.append(bnd)
        floor = bnd[1] + 0.15
    segs, s0, sp = [], lead, None
    for i in range(N):
        sn = bounds[i] if i < N - 1 else None
        e0 = sn[0] if sn else tail
        segs.append((s0, e0, sp, sn))
        if sn:
            s0, sp = sn[1], sn
    return segs


def refine(y, db, seg, total, preroll=0.04):
    """Amplía dentro de las pausas y busca el inicio/fin real de la voz con umbral fino."""
    s, e, sp, sn = seg
    lo = (sp[0] + 0.3 * (sp[1] - sp[0])) if sp else max(0.0, s - 0.25)
    hi = (sn[1] - 0.3 * (sn[1] - sn[0])) if sn else min(total, e + 0.3)
    lo = max(lo, s - 0.22)
    hi = min(hi, e + 0.22)
    i0, i1 = int(lo / HOP), max(int(lo / HOP) + 1, int(hi / HOP))
    win = db[i0:i1]
    if len(win) == 0:
        return s, e
    thr = win.max() - 40
    voiced = np.where(win > thr)[0]
    if len(voiced) == 0:
        return s, e
    a = lo + voiced[0] * HOP - preroll
    b = lo + (voiced[-1] + 1) * HOP + 0.07
    return max(lo, a), min(hi, b)


def export(src, a, b, out, kind):
    tail = 0.16 if kind == "carrier" else 0.06
    dur = b - a
    p = subprocess.run(["ffmpeg", "-hide_banner", "-ss", f"{a:.3f}", "-t", f"{dur:.3f}", "-i", str(src),
                        "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    m = re.search(r"mean_volume:\s*(-?[\d.]+)", p.stderr)
    gain = max(-12.0, min(14.0, -17.0 - (float(m.group(1)) if m else -20.0)))
    af = (f"highpass=f=70,volume={gain:.2f}dB,alimiter=limit=0.89:attack=3:release=40,"
          f"afade=t=in:d=0.012,areverse,afade=t=in:d=0.03,areverse,adelay=8,apad=pad_dur={tail},"
          f"aformat=sample_fmts=s16p")
    subprocess.run(["ffmpeg", "-hide_banner", "-y", "-ss", f"{a:.3f}", "-t", f"{dur:.3f}", "-i", str(src),
                    "-af", af, "-ac", "1", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "96k",
                    "-map_metadata", "-1", str(out)], capture_output=True, check=True)


def transcribe(files):
    """Transcribe una lista de mp3 con whisper-cli; devuelve {ruta: texto}."""
    if not WHISPER_MODEL.exists() or not shutil.which("whisper-cli"):
        return {}
    wavs = []
    for f in files:
        w = f.with_suffix(".wav")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(f), "-af", "apad=pad_dur=0.4",
                        "-ar", "16000", "-ac", "1", str(w)], check=True)
        wavs.append(w)
    out = {}
    for i in range(0, len(wavs), 60):
        chunk = wavs[i:i + 60]
        args = ["whisper-cli", "-m", str(WHISPER_MODEL), "-l", "es", "-nt", "-np"]
        for w in chunk:
            args += ["-f", str(w)]
        p = subprocess.run(args, capture_output=True, text=True)
        lines = [l.strip() for l in p.stdout.splitlines() if l.strip()]
        # whisper-cli imprime una transcripción por archivo, en orden
        if len(lines) == len(chunk):
            for w, l in zip(chunk, lines):
                out[w.with_suffix(".mp3")] = l
        else:  # por si alguna sale vacía: uno a uno
            for w in chunk:
                q = subprocess.run(["whisper-cli", "-m", str(WHISPER_MODEL), "-l", "es", "-nt", "-np", "-f", str(w)],
                                   capture_output=True, text=True)
                out[w.with_suffix(".mp3")] = " ".join(l.strip() for l in q.stdout.splitlines() if l.strip())
    for w in wavs:
        w.unlink(missing_ok=True)
    return out


def main():
    order = json.loads((TAKES / "order.json").read_text())
    parts = sys.argv[1:] or [p for p in order if (TAKES / f"{p}.take1.mp3").exists()]
    OUT.mkdir(parents=True, exist_ok=True)
    CAND.mkdir(parents=True, exist_ok=True)
    report, rows = [], []
    for part in parts:
        clips = order[part]
        weights = [weight(c["text"]) for c in clips]
        for t in (1, 2):
            f = TAKES / f"{part}.take{t}.mp3"
            if not f.exists():
                continue
            y = decode(f)
            db = frame_db(y)
            lead, tail, cands = silences(db)
            segs, exp, score = align(weights, lead, tail, cands)
            wsegs = align_words(clips, whisper_words(f), lead, tail, cands)
            if wsegs:
                segs = wsegs
            report.append(f"{part} toma {t}: {len(cands)} silencios, coste DP {score:.3f}, "
                          f"{'alineación por palabras' if wsegs else 'alineación por duraciones'}")
            total = len(y) / SR
            for i, c in enumerate(clips):
                a, b = refine(y, db, segs[i], total, preroll=0.09 if c["kind"] == "number" else 0.05)
                out = CAND / f"{c['id']}.take{t}.mp3"
                export(f, a, b, out, c["kind"])
                rows.append({"id": c["id"], "text": c["text"], "kind": c["kind"], "take": t, "file": out,
                             "dur": b - a, "exp": float(exp[i])})
    carrier = next((r["file"] for r in rows if r["id"] == "set_1"), None)
    ctx_files = {}
    if carrier:
        for r in rows:
            if r["kind"] == "number":
                cf = r["file"].with_name(r["file"].stem + ".ctx.mp3")
                subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(carrier), "-i", str(r["file"]),
                                "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1", "-ac", "1", str(cf)], check=True)
                ctx_files[r["file"]] = cf
    heard = transcribe([ctx_files.get(r["file"], r["file"]) for r in rows])
    for r in rows:
        if r["file"] in ctx_files:
            r["ctx"] = True
            heard[r["file"]] = heard.get(ctx_files[r["file"]], "")
    by_id = {}
    for r in rows:
        r["heard"] = heard.get(r["file"], "")
        expected = ("Pon la cinta a " + r["text"]) if r.get("ctx") else r["text"]
        r["sim"] = similarity(r["heard"], expected) if r["heard"] else None
        by_id.setdefault(r["id"], []).append(r)
    bad = 0
    for cid, opts in by_id.items():
        def key(o):
            sim = o["sim"] if o["sim"] is not None else 0.5
            return (-round(sim, 2), abs(math.log(max(o["dur"], 0.05) / o["exp"])))
        opts.sort(key=key)
        best = opts[0]
        shutil.copyfile(best["file"], OUT / f"{cid}.mp3")
        ok = best["sim"] is None or best["sim"] >= 0.8
        bad += 0 if ok else 1
        alts = " | ".join(f"t{o['take']} {o['sim'] if o['sim'] is None else round(o['sim'], 2)} «{o['heard']}»" for o in sorted(opts, key=lambda o: o['take']))
        report.append(f"{'  ' if ok else '⚠️'} {cid:16s} → toma {best['take']}  «{best['text']}»  ::  {alts}")
    present = sorted(p.stem for p in OUT.glob("*.mp3") if not p.name.startswith("._"))
    index = {"id": "eva", "name": "Eva Dorado · ElevenLabs", "voiceId": "RgXx32WYOGrd7gFNifSf",
             "model": "eleven_v3", "format": "mp3", "clips": present}
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    plist = ROOT / "audio" / "packs" / "packs.json"
    try:
        packs = json.loads(plist.read_text())
    except Exception:
        packs = []
    packs = [p for p in packs if p.get("id") != "eva"]
    packs.append({"id": "eva", "name": "Eva Dorado · ElevenLabs", "voiceId": "RgXx32WYOGrd7gFNifSf",
                  "model": "eleven_v3", "count": len(present)})
    plist.write_text(json.dumps(packs, ensure_ascii=False, indent=1))
    report.append(f"\nPack eva: {len(present)} clips · dudosos: {bad}")
    (TAKES / "informe.txt").write_text("\n".join(report))
    print("\n".join(report))


if __name__ == "__main__":
    main()
