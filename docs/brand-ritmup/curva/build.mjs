#!/usr/bin/env node
// RITMUP · «Curva» pulida. Genera el logotipo, el símbolo, los iconos y js/ui/intro-logo.js.
//   node docs/brand-ritmup/curva/build.mjs
// Construcción: altura x = 100 (y=0 arriba, y=100 línea base), asta = 30, horizontales = 26 (adelgazado óptico).
// La «r» es una curva de pista: haz de 30 = calle exterior 13 | línea 4 | calle interior 13, todo concéntrico
// a un solo centro (familia de radios 50/20, la misma de los arcos de la m y la panza de la p).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const EMBER = '#FF5A1F';
const f = (n) => { const v = Math.round(n * 100) / 100; return Object.is(v, -0) ? '0' : String(v); };

/* ── medidas maestras ── */
const S = 30;          // asta (vertical)
const HZ = 26;         // horizontales (adelgazado óptico)
const ASC = 44;        // ascendente de la t = descendente de la p = altura del punto de la i
const OV = 1.8;        // rebase óptico de las partes redondas

/* ── r: curva de pista ── */
const R = { Rb: 50, arm: 68, H: 100, laneO: 14.5, line: 4, laneI: 14.5, cut: 1.5, gap: 4 };
const SR = R.laneO + R.line + R.laneI;   // 33: el haz es algo más ancho que el asta para igualar la tinta (29 vs 30)
const rI = R.Rb - SR;                    // 17 bordillo
const rL1 = rI + R.laneI;                // 33 borde exterior de la calle interior
const rL2 = rL1 + R.line;                // 37 borde interior de la calle exterior
const C = [R.Rb, R.Rb];
const at = (rho, t) => {
  if (t <= 1) return [C[0] - rho, R.H + (C[1] - R.H) * t];
  if (t <= 2) { const ph = Math.PI + (t - 1) * Math.PI / 2; return [C[0] + rho * Math.cos(ph), C[1] + rho * Math.sin(ph)]; }
  return [C[0] + (R.arm - C[0]) * (t - 2), C[1] - rho];
};
const lens = (rho) => [R.H - C[1], rho * Math.PI / 2, R.arm - C[0]];
const tWalk = (rho, t, d) => {
  const L = lens(rho);
  let s0 = 0; const k = Math.min(2, Math.floor(t)); for (let j = 0; j < k; j++) s0 += L[j]; s0 += L[k] * (t - k);
  let s1 = s0 + d; let j = 0; while (j < 2 && s1 > L[j]) { s1 -= L[j]; j++; }
  return j + Math.max(0, s1) / L[j];
};
const runB = (rho, ta, tb) => {
  const dir = tb >= ta ? 1 : -1; const cuts = [ta];
  for (const k of [1, 2]) if ((k - ta) * (k - tb) < 0) cuts.push(k);
  cuts.push(tb); cuts.sort((p, q) => dir * (p - q));
  let d = '';
  for (let n = 1; n < cuts.length; n++) {
    const tm = (cuts[n - 1] + cuts[n]) / 2, [x, y] = at(rho, cuts[n]);
    d += tm > 1 && tm < 2 ? `A${f(rho)} ${f(rho)} 0 0 ${dir > 0 ? 1 : 0} ${f(x)} ${f(y)}` : `L${f(x)} ${f(y)}`;
  }
  return d;
};
const seg = (ro, ri, ta, tb) => { const [x, y] = at(ro, ta), [xi, yi] = at(ri, tb); return `M${f(x)} ${f(y)}${runB(ro, ta, tb)}L${f(xi)} ${f(yi)}${runB(ri, tb, ta)}Z`; };
const spine = (rho, ta, tb) => { const [x, y] = at(rho, ta); return `M${f(x)} ${f(y)}${runB(rho, ta, tb)}`; };
const rm1 = (rI + rL1) / 2;
// corte de la calle interior: hueco de caras PARALELAS (mismo ancho que la línea de calle), centrado en el radio a 45°
const phi0 = Math.PI * (1 + (R.cut - 1) / 2);
const tCut = (rho, d) => 1 + (phi0 + Math.asin(d / rho) - Math.PI) / (Math.PI / 2);
const segX = (ro, ri, tao, tbo, tai, tbi) => { const [x, y] = at(ro, tao), [xi, yi] = at(ri, tbi); return `M${f(x)} ${f(y)}${runB(ro, tao, tbo)}L${f(xi)} ${f(yi)}${runB(ri, tbi, tai)}Z`; };
const h = R.gap / 2;
const rWhite = seg(R.Rb, rL2, 0, 3) + segX(rL1, rI, tCut(rL1, h), 3, tCut(rI, h), 3);
const rEmber = segX(rL1, rI, 0, tCut(rL1, -h), 0, tCut(rI, -h));
const rSpine = spine(R.Rb - SR / 2, 0, 3);
const rEmberSpine = spine(rm1, 0, R.cut);

/* ── letras (origen propio en x=0) ── */
// i: asta + punto cuadrado de esquinas apenas suavizadas (eco de los cortes rectos de las calles)
const rr = (x, y, w, h, k) => `M${f(x + k)} ${f(y)}L${f(x + w - k)} ${f(y)}A${k} ${k} 0 0 1 ${f(x + w)} ${f(y + k)}L${f(x + w)} ${f(y + h - k)}A${k} ${k} 0 0 1 ${f(x + w - k)} ${f(y + h)}L${f(x + k)} ${f(y + h)}A${k} ${k} 0 0 1 ${f(x)} ${f(y + h - k)}L${f(x)} ${f(y + k)}A${k} ${k} 0 0 1 ${f(x + k)} ${f(y)}Z`;
const DOT = 30, DOTGAP = 14;
const L_i = { d: `M0 0L${S} 0L${S} 100L0 100Z` + rr(0, -DOTGAP - DOT, S, DOT, 3), w: S };

// t: asta con pie de curva (radios 44/14) y travesaño en la línea de la altura x
const T = { barL: 11, barR: 33, Rf: 44, rf: 14 };
const L_t = (() => {
  const x0 = T.barL, xs = x0 + S, xe = xs + T.barR;
  const cxi = xs + T.rf, cyi = 100 - HZ - T.rf;
  const d = `M${f(x0)} ${-ASC}L${f(xs)} ${-ASC}L${f(xs)} 0L${f(xe)} 0L${f(xe)} ${HZ}L${f(xs)} ${HZ}` +
    `L${f(xs)} ${f(cyi)}A${T.rf} ${T.rf} 0 0 0 ${f(cxi)} ${100 - HZ}L${f(xe)} ${100 - HZ}L${f(xe)} 100L${f(x0 + T.Rf)} 100A${T.Rf} ${T.Rf} 0 0 1 ${f(x0)} ${f(100 - T.Rf)}` +
    `L${f(x0)} ${HZ}L0 ${HZ}L0 0L${f(x0)} 0Z`;
  return { d, w: xe };
})();

// m: dos medias vueltas (radios 50,5/20,5 — la familia de la r), con rebase óptico arriba
const L_m = (() => {
  const wm = 172, sm = S, s = S, sh = HZ, ov = OV;
  const xm = (wm - sm) / 2;
  const R1 = (xm + sm) / 2, c1 = R1, R2 = (wm - xm) / 2, c2 = xm + R2;
  const r1 = (xm - s) / 2, y1 = sh + r1, r2 = (wm - s - (xm + sm)) / 2, y2 = sh + r2;
  const ya = (X) => R1 - (R1 + ov) * Math.sqrt(Math.max(0, 1 - ((X - c1) / R1) ** 2));
  const yb = (X) => R2 - (R2 + ov) * Math.sqrt(Math.max(0, 1 - ((X - c2) / R2) ** 2));
  let lo = c1, hi = c2, X = (lo + hi) / 2;
  for (let it = 0; it < 80; it++) { X = (lo + hi) / 2; if (ya(X) > yb(X)) hi = X; else lo = X; }
  const Y = ya(X);
  const d = `M0 100L0 ${f(R1)}A${f(R1)} ${f(R1 + ov)} 0 0 1 ${f(X)} ${f(Y)}A${f(R2)} ${f(R2 + ov)} 0 0 1 ${f(wm)} ${f(R2)}L${f(wm)} 100L${f(wm - s)} 100L${f(wm - s)} ${f(y2)}` +
    `A${f(r2)} ${f(r2)} 0 0 0 ${f(xm + sm)} ${f(y2)}L${f(xm + sm)} 100L${f(xm)} 100L${f(xm)} ${f(y1)}A${f(r1)} ${f(r1)} 0 0 0 ${f(s)} ${f(y1)}L${f(s)} 100Z`;
  return { d, w: wm };
})();

// u: media vuelta hacia abajo, simétrica a los arcos de la m; el fondo rebasa la línea base
const L_u = (() => {
  const w = 101, Ro = w / 2, ri = Ro - S, cyo = 100 - Ro, cyi = 100 - HZ - ri; // = la m girada: radios 50,5 / 20,5
  const d = `M0 0L${S} 0L${S} ${f(cyi)}A${f(ri)} ${f(ri)} 0 0 0 ${w - S} ${f(cyi)}L${w - S} 0L${w} 0L${w} ${f(cyo)}A${f(Ro)} ${f(Ro + OV)} 0 0 1 0 ${f(cyo)}Z`;
  return { d, w };
})();

// p: panza de media pista (radio 50, el de la r) con rebase lateral; descendente = ascendente de la t
const L_p = (() => {
  const xb = 60, Ro = 50, ri = 24, xi = 55, OVp = 1; // rebase lateral menor: el lado redondo ya engorda
  const d = `M0 0L${xb} 0A${f(Ro + OVp)} ${Ro} 0 0 1 ${f(xb + Ro + OVp)} 50A${f(Ro + OVp)} ${Ro} 0 0 1 ${xb} 100L${S} 100L${S} ${100 + ASC}L0 ${100 + ASC}Z` +
    `M${S} ${HZ}L${S} ${100 - HZ}L${xi} ${100 - HZ}A${ri} ${ri} 0 0 0 ${xi + ri} 50A${ri} ${ri} 0 0 0 ${xi} ${HZ}Z`;
  return { d, w: xb + Ro + OVp };
})();

/* ── espaciado (a ojo, sobre render grande) ── */
const K = { ri: 8, it: 8, tm: 9, mu: 13, up: 13 }; // r-i se aprieta bajo el brazo; t-m abre lo que cierra el pie
const xs = {};
xs.i = R.arm + K.ri;
xs.t = xs.i + L_i.w + K.it;
xs.m = xs.t + L_t.w + K.tm;
xs.u = xs.m + L_m.w + K.mu;
xs.p = xs.u + L_u.w + K.up;
const W = xs.p + L_p.w;
const VB = [0, -ASC, +f(W), 100 + 2 * ASC];
const letters = [
  { ch: 'i', d: L_i.d, x: xs.i }, { ch: 't', d: L_t.d, x: xs.t }, { ch: 'm', d: L_m.d, x: xs.m },
  { ch: 'u', d: L_u.d, x: xs.u }, { ch: 'p', d: L_p.d, x: xs.p },
];

/* ── piezas ── */
const g = (fg) =>
  `<path fill="${fg}" fill-rule="evenodd" d="${rWhite}"/><path fill="${EMBER}" d="${rEmber}"/>` +
  letters.map((l) => `<path fill="${fg}" fill-rule="evenodd" transform="translate(${f(l.x)} 0)" d="${l.d}"/>`).join('');
const svg = (vb, body, label = 'ritmup') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(f).join(' ')}" role="img" aria-label="${label}"><title>${label}</title>${body}</svg>\n`;
const markBody = (fg) => `<path fill="${fg}" fill-rule="evenodd" d="${rWhite}"/><path fill="${EMBER}" d="${rEmber}"/>`;

const out = (name, s) => writeFileSync(join(HERE, name), s);
out('wordmark.svg', svg(VB, g('currentColor')).replace('<svg ', '<svg color="#FFFFFF" '));
out('wordmark-black.svg', svg(VB, g('#000000')));
out('wordmark-white.svg', svg(VB, g('#FFFFFF')));
out('mark.svg', svg([0, 0, R.arm, 100], markBody('#FFFFFF'), 'r'));
out('mark-black.svg', svg([0, 0, R.arm, 100], markBody('#000000'), 'r'));

// icono: la r ópticamente centrada (~58 % del alto), degradado casi negro, brillo superior y la calle que «emite»
function icon(round) {
  const h = round ? 1024 * 0.5 : 1024 * 0.58, s = h / 100, w = R.arm * s;
  const x = (1024 - w) / 2 + w * 0.02, y = (1024 - h) / 2 + h * 0.012; // la r pesa arriba-izquierda
  const tf = `translate(${f(x)} ${f(y)}) scale(${f(s * 1000) / 1000})`;
  const bg = round
    ? `<circle cx="512" cy="512" r="512" fill="url(#bg)"/><circle cx="512" cy="512" r="510" fill="none" stroke="url(#hl)" stroke-width="4"/>`
    : `<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#hl2)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="RITMUP"><title>RITMUP</title>
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#141416"/><stop offset="1" stop-color="#000000"/></linearGradient>
<linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="hl2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".012" stop-color="#fff" stop-opacity=".025"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/></linearGradient>
<filter id="glow" x="-1" y="-1" width="3" height="3" filterUnits="objectBoundingBox"><feGaussianBlur stdDeviation="${f(30 / s)}"/></filter>
</defs>
${bg}
<g transform="${tf}"><path fill="${EMBER}" opacity=".35" filter="url(#glow)" d="${rEmber}"/>${markBody('#FFFFFF')}</g>
</svg>
`;
}
out('icon-1024.svg', icon(false));
out('icon-watch.svg', icon(true));

/* ── contrato para la intro ── */
const js = `// Generado por docs/brand-ritmup/curva/build.mjs: no editar a mano.
export const LOGO = {
  viewBox: ${JSON.stringify(VB)},
  ember: '${EMBER}',
  r: {
    white: '${rWhite}',
    ember: '${rEmber}',
    spine: '${rSpine}',
    spineWidth: ${SR + 4},
    emberSpine: '${rEmberSpine}',
  },
  letters: [
${letters.map((l) => `    { ch: '${l.ch}', d: '${l.d}', x: ${f(l.x)} },`).join('\n')}
  ],
};
`;
writeFileSync(join(ROOT, 'js/ui/intro-logo.js'), js);

/* ── lámina de previsualización (SVG, se rasteriza con qlmanage) ── */
const inner = (x) => x.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '');
const wm = (fg, x, y, w) => { const sc = w / VB[2]; return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(sc * 1000) / 1000}) translate(0 ${ASC})">${g(fg)}</g>`; };
const ic = (round, x, y, size, pre) => {
  let b = inner(icon(round)).replace(/id="(\w+)"/g, `id="${pre}$1"`).replace(/url\(#(\w+)\)/g, `url(#${pre}$1)`);
  const clip = round ? `<circle cx="512" cy="512" r="512"/>` : `<rect width="1024" height="1024" rx="230"/>`;
  return `<g transform="translate(${x} ${y}) scale(${size / 1024})"><clipPath id="${pre}c">${clip}</clipPath><g clip-path="url(#${pre}c)">${b}</g></g>`;
};
const PW = 1600, PH = 1600; // cuadrada: qlmanage recorta las miniaturas a cuadrado
const wmW = 1100, wmH = wmW * VB[3] / VB[2];
const font = `font-family="-apple-system, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif"`;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${PH}" width="${PW}" height="${PH}">
<rect width="${PW}" height="${PH}" fill="#0b0b0c"/>
<rect x="40" y="40" width="1520" height="580" rx="28" fill="#000"/>${wm('#fff', (PW - wmW) / 2, 40 + (580 - wmH) / 2, wmW)}
<rect x="40" y="640" width="1520" height="380" rx="28" fill="#fff"/>${wm('#000', (PW - 680) / 2, 640 + (380 - 680 * VB[3] / VB[2]) / 2, 680)}
<rect x="40" y="1040" width="500" height="500" rx="28" fill="#161618"/>${ic(false, 140, 1090, 300, 'a')}
<text x="290" y="1500" ${font} font-size="15" fill="#8a8a8f" text-anchor="middle">icono · 1024</text>
<rect x="550" y="1040" width="500" height="500" rx="28" fill="#161618"/>${ic(false, 770, 1180, 60, 'b')}
<text x="800" y="1265" ${font} font-size="12" font-weight="500" fill="#fff" text-anchor="middle">RITMUP</text>
<text x="800" y="1360" ${font} font-size="40" font-weight="600" letter-spacing="2.4" fill="#fff" text-anchor="middle">RITMUP</text>
<text x="800" y="1500" ${font} font-size="15" fill="#8a8a8f" text-anchor="middle">60 px · SF Pro</text>
<rect x="1060" y="1040" width="500" height="500" rx="28" fill="#161618"/>${ic(true, 1180, 1110, 260, 'w')}
<text x="1310" y="1500" ${font} font-size="15" fill="#8a8a8f" text-anchor="middle">Apple Watch</text>
</svg>
`;
out('preview.svg', sheet);
console.log('ok', { W: f(W), VB, xs });
