// RITMUP · marcador del box (mundo «box de CrossFit» de las AMRAP; estilos en css/hud-box.css, laboratorio en tools/hud-box-lab/).
// Una sola placa arriba, con el lenguaje del marcador de retransmisión del Estadio (.bc), pensada para leerse sobre las
// tres luces del box (ámbar, azul con niebla, rojo): todo va sobre placa oscura, ningún número baja de 30 px y la franja
// central queda libre para el mundo. Dos mitades:
//   boxHudModel(estado del motor, extras) → modelo de texto puro (sin DOM; se prueba en tools/test-hud-box.mjs)
//   mountBoxHud(raíz) → { update(modelo), destroy() }  (crea el DOM una vez y solo toca lo que cambia)
import { ZONES } from '../training/levels.js';
import { amrapResultText } from '../training/amrap.js';

const kmh = (v) => (Number(v) || 0).toFixed(1).replace('.', ',');
const clock = (sec) => { const s = Math.max(0, Math.ceil((Number(sec) || 0) - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const zc = (z) => ZONES[z]?.color || '#FFFFFF';
const zshort = (z) => (ZONES[z]?.short || ZONES[z]?.name || '').toUpperCase();
const HR_COLORS = ['#64D2FF', '#30D158', '#FFD60A', '#FF9F0A', '#FF375F'];

/** Último minuto del tope: el marcador se pone en rojo. */
export const LAST_SEC = 60;

/**
 * Modelo del marcador a partir de engine.getState().
 * extras: { title (nombre de la clase), hr (ppm o null), hrZone (1…5 o null), result ({ rounds, extraM, cap } | null: el
 * bloque AMRAP recién acabado), record ('new' | null), recordText (el récord anterior, «5 rondas + 120 m»), first (no
 * había marca anterior) }.
 */
export function boxHudModel(s, { title = '', hr = null, hrZone = null, result = null, record = null, recordText = '', first = false } = {}) {
  const a = s && s.status !== 'finished' ? s.amrap : null;
  const seg = s?.segment || null;
  const pulse = Number(hr) > 0 ? String(Math.round(hr)) : '—';
  const pz = Number(hr) > 0 && hrZone >= 1 && hrZone <= 5 ? { text: `Z${hrZone}`, color: HR_COLORS[hrZone - 1] } : null;
  const base = { title: String(title || '').toUpperCase(), pulse, pulseZone: pz };

  if (!a && result) {
    const n = Math.max(0, Math.round(Number(result.rounds) || 0));
    const m = Math.max(0, Math.round(Number(result.extraM) || 0));
    return {
      ...base, mode: 'result', live: 'TIEMPO', isRecord: record === 'new',
      resLabel: `AMRAP ${Math.round((Number(result.cap) || 0) / 60)}′ · RESULTADO`,
      resN: String(n), resText: `${n === 1 ? 'RONDA' : 'RONDAS'}${m > 0 ? ` + ${m} M` : ''}`,
      resSub: record === 'new' ? `¡NUEVO RÉCORD!${recordText ? ` · antes ${recordText}` : ''}` : recordText ? `Récord: ${recordText}` : first ? 'Primera vez: esta es tu marca' : '',
      plain: amrapResultText(result),
    };
  }

  if (a) {
    const work = a.phase === 'work';
    const last = a.capLeft <= LAST_SEC;
    const byM = a.phaseLeftM != null;
    const restTxt = a.restSec > 0 ? clock(a.restSec) : a.restM > 0 ? `${a.restM} M` : '';
    return {
      ...base, mode: 'amrap', phase: work ? 'work' : 'rest', last,
      live: last ? 'ÚLTIMO MINUTO' : 'EN DIRECTO',
      zc: zc(a.zone), nc: zc(a.nextZone),
      speed: kmh(a.speed),
      zoneTag: work ? `TRABAJO · ${a.workM} M` : `RECUPERA${restTxt ? ` · ${restTxt}` : ''}`,
      // («RONDAS HECHAS» no cabe junto a «RECUPERA · 1:15» en Chrome a 375 pt: la etiqueta corta deja sitio a la fase)
      roundLabel: work ? 'RONDA' : a.rounds === 1 ? 'HECHA' : 'HECHAS',
      round: String(work ? a.round : a.rounds),
      leftLabel: 'QUEDAN',
      left: byM ? String(Math.max(0, Math.ceil(a.phaseLeftM - 1e-6))) : clock(a.phaseLeftSec),
      leftUnit: byM ? 'M' : '',
      capLabel: 'TOPE', cap: clock(a.capLeft),
      progress: byM ? 1 - a.phaseLeftM / Math.max(1, a.phaseM) : 1 - a.phaseLeftSec / Math.max(1, a.phaseSecTotal || a.phaseLeftSec),
      // (el último minuto ya lo dicen la cabecera y el tope en rojo: aquí siempre lo que viene, que puede ser otra recuperación)
      nextLabel: 'LUEGO',
      next: `${zshort(a.nextZone)} ${kmh(a.nextSpeed)}${a.nextPhase === 'rest' ? (restTxt ? ` · ${restTxt}` : '') : ` · ${a.workM} M`}`,
    };
  }

  // Fuera del bloque AMRAP (calentar, trote, vuelta a la calma): la misma placa con el tramo
  const nx = s?.nextSegment || null;
  return {
    ...base, mode: 'seg', phase: 'seg', last: false, live: s?.status === 'paused' ? 'EN PAUSA' : 'EN DIRECTO',
    zc: zc(seg?.zone), nc: zc(nx?.amrap ? nx.amrap.workZone : nx?.zone),
    speed: kmh(s?.currentSpeed),
    zoneTag: (ZONES[seg?.zone]?.name || '').toUpperCase(),
    roundLabel: 'TRAMO', round: seg ? `${(s.segIndex || 0) + 1}/${s.segCount || 1}` : '',
    leftLabel: 'QUEDA', left: clock(s?.segRemaining), leftUnit: '',
    capLabel: 'CLASE', cap: clock(s?.totalRemaining),
    progress: seg?.sec > 0 ? 1 - (s.segRemaining || 0) / seg.sec : 0,
    nextLabel: nx ? 'LUEGO' : 'FIN', next: nx ? (nx.amrap ? `AMRAP ${Math.round(nx.sec / 60)}′ · ${nx.amrap.workM} M` : `${zshort(nx.zone)} ${kmh(nx.speed)} · ${clock(nx.sec)}`) : 'ÚLTIMO TRAMO',
  };
}

const TPL = `
  <div class="bx-head"><span class="bx-acc"></span><span data-k="logo"></span><span class="bx-live"><i></i><span data-k="live"></span></span><span class="bx-name num" data-k="title"></span></div>
  <div class="bx-main">
    <div class="bx-top">
      <span class="bx-spd num" data-k="speed"></span>
      <span class="bx-unit"><span class="bx-zone" data-k="zoneTag"></span><b>KM/H</b></span>
      <span class="bx-round"><span class="bx-lab" data-k="roundLabel"></span><b class="num" data-k="round"></b></span>
    </div>
    <div class="bx-grid">
      <div class="bx-cell"><div class="bx-lab" data-k="leftLabel"></div><div class="bx-val num is-zc"><span data-k="left"></span><small data-k="leftUnit"></small></div></div>
      <div class="bx-cell"><div class="bx-lab" data-k="capLabel"></div><div class="bx-val num is-cap"><span data-k="cap"></span></div></div>
      <div class="bx-cell"><div class="bx-lab">PULSO</div><div class="bx-val num"><span data-k="pulse"></span><span class="bx-hrz" data-k="pz" hidden></span></div></div>
    </div>
    <div class="bx-bar"><i data-k="fill"></i></div>
  </div>
  <div class="bx-next"><span data-k="nextLabel"></span><i></i><b class="num" data-k="next"></b></div>`;
const RES = `
  <div class="bx-lab" data-k="resLabel"></div>
  <div class="bx-res__row"><span class="bx-res__n num" data-k="resN"></span><span class="bx-res__t" data-k="resText"></span></div>
  <div class="bx-res__sub" data-k="resSub"></div>`;

/** Monta el marcador dentro de `root` (el contenedor de la pantalla de clase). logoHtml: el logotipo oficial (wordmarkSvg). */
export function mountBoxHud(root, { logoHtml = '' } = {}) {
  const doc = root.ownerDocument;
  const bx = doc.createElement('div'); bx.className = 'bx'; bx.innerHTML = TPL;
  const res = doc.createElement('div'); res.className = 'bx-res'; res.hidden = true; res.innerHTML = RES;
  root.append(bx, res);
  const el = {};
  for (const e of [...bx.querySelectorAll('[data-k]'), ...res.querySelectorAll('[data-k]')]) el[e.dataset.k] = e;
  el.logo.innerHTML = logoHtml;
  const last = {};
  const text = (k, v) => { v = v == null ? '' : String(v); if (last[k] !== v) { last[k] = v; el[k].textContent = v; } };
  const attr = (k, node, name, v) => { v = String(v); if (last[k] !== v) { last[k] = v; node.setAttribute(name, v); } };
  const css = (k, node, name, v) => { v = String(v); if (last[k] !== v) { last[k] = v; node.style.setProperty(name, v); } };
  function update(m) {
    if (!m) return;
    const result = m.mode === 'result';
    attr('mode', bx, 'data-mode', m.mode); attr('last', bx, 'data-last', m.last ? '1' : '0');
    if (last.resHidden !== !result) { last.resHidden = !result; res.hidden = !result; }
    text('live', m.live); text('title', m.title);
    if (result) {
      attr('rec', res, 'data-record', m.isRecord ? '1' : '0');
      text('resLabel', m.resLabel); text('resN', m.resN); text('resText', m.resText); text('resSub', m.resSub);
      return;
    }
    css('zc', bx, '--zc', m.zc); css('nc', bx, '--nc', m.nc);
    for (const k of ['speed', 'zoneTag', 'roundLabel', 'round', 'leftLabel', 'left', 'leftUnit', 'capLabel', 'cap', 'pulse', 'nextLabel', 'next']) text(k, m[k]);
    const pz = m.pulseZone;
    if (last.pzOn !== !!pz) { last.pzOn = !!pz; el.pz.hidden = !pz; }
    if (pz) { text('pz', pz.text); css('pzc', el.pz, 'background', pz.color); }
    css('fill', el.fill, 'transform', `scaleX(${Math.min(1, Math.max(0, m.progress || 0)).toFixed(3)})`);
  }
  return { update, destroy() { bx.remove(); res.remove(); }, el: bx, resEl: res };
}
