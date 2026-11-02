#!/usr/bin/env node
// RITMUP · horneado de un escenario de CIUDAD REAL a partir de OpenStreetMap (prototipo «ciudad», oculto).
// Lee un extracto de Overpass (edificios, partes de edificio, calles y parques; consulta en tools/ciudad/<ciudad>.overpassql)
// y escribe assets/world/ciudad/<salida>/ (route.json + trozos c<k>.json): el RECORRIDO (polilínea suavizada, en metros, con sus marcas: km, meta,
// monumentos) y la ciudad a su alrededor (huellas de los edificios con su altura, calles con su ancho y zonas verdes).
// Todo en metros locales: x = este, z = sur, origen en ORIGIN. Coordenadas redondeadas a 0,1 m.
//
//   1) curl -A 'RITMUP' https://overpass-api.de/api/interpreter --data-urlencode data@tools/ciudad/berlin.overpassql -o berlin-osm.json
//      (y el árbol/farola: node["natural"="tree"] y node["highway"="street_lamp"] en el mismo recuadro → berlin-nodes.json)
//   2) node tools/ciudad/bake.mjs berlin berlin-osm.json [berlin-nodes.json]      (o madrid, con madrid*.overpassql:
//      Madrid son dos extractos, el centro y el oeste; se juntan quitando duplicados por tipo e id antes de hornear)
//
// Datos © colaboradores de OpenStreetMap, licencia ODbL 1.0: el JSON horneado es una base de datos derivada, se
// publica con la misma licencia y la escena muestra «© OpenStreetMap».
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Cada ciudad: puntos clave del recorrido en orden ('graph' = por las calles de OSM, camino más corto entre los dos
// puntos; 'line' = recto, para plazas y pasos), la marca de cada uno y los monumentos (nombre de OSM → color fijo;
// noWin = sin ventanas, p. ej. una puerta monumental; sus partes heredan el color).
const CITIES = {
  // Maratón de Berlín · los últimos ~3,4 km: Leipziger Straße → Markgrafenstraße (Gendarmenmarkt) → Behrenstraße →
  // Charlottenstraße → Unter den Linden → Pariser Platz → Puerta de Brandeburgo → meta en la Straße des 17. Juni.
  berlin: {
    out: 'berlin-final',
    name: 'Berlín · el final del maratón',
    origin: [52.516276, 13.377705],              // centro de la Puerta de Brandeburgo
    kmAtEnd: 42.195,                             // el último punto del recorrido es la meta oficial
    defaultH: 18,                                // la «Traufhöhe» del centro ronda los 22 m
    keys: [
      { ll: [52.50959, 13.37677], label: 'Potsdamer Platz' },
      { ll: [52.50972, 13.37948], via: 'graph' },
      { ll: [52.51072, 13.39374], via: 'graph', label: 'Markgrafenstraße' },
      { ll: [52.51410, 13.39318], via: 'graph', label: 'Gendarmenmarkt' },
      { ll: [52.51588, 13.39287], via: 'graph' },
      { ll: [52.51576, 13.39091], via: 'graph' },
      { ll: [52.51699, 13.39070], via: 'graph', label: 'Unter den Linden' },
      { ll: [52.51629, 13.37980], via: 'graph' },
      { ll: [52.51636, 13.37880], via: 'line', label: 'Pariser Platz' },
      { ll: [52.516276, 13.377705], via: 'line', label: 'Puerta de Brandeburgo' },
      { ll: [52.51612, 13.37520], via: 'line' },
      { ll: [52.51582, 13.37030], via: 'graph', label: 'Meta' },   // a la altura de la Yitzhak-Rabin-Straße
    ],
    landmarks: [{ re: /Brandenburger Tor/, c: '#efe3c6', noWin: true }],
    keep: 420,                                   // m alrededor del recorrido que se hornean
  },
  // Maratón de Madrid (2026) · los últimos ~3,7 km: glorieta de Pirámides → Paseo de las Acacias → glorieta de
  // Embajadores → Ronda de Valencia → Ronda de Atocha →
  // glorieta de Carlos V (Atocha) → Paseo del Prado (Neptuno) → Cibeles → meta en el Paseo de Recoletos, a la altura de
  // la calle Almirante. Orden de calles según la prensa del 26-IV-2026 (sin trazado oficial con km): revisarlo.
  madrid: {
    out: 'madrid-final',
    chunk: 1250,                                 // en trozos (prueba del cargador con una ruta corta)
    name: 'Madrid · el final del maratón',
    origin: [40.41930, -3.69310],                // la fuente de Cibeles
    kmAtEnd: 42.195,
    defaultH: 19,                                // centro de Madrid: 5–6 plantas
    keys: [
      { ll: [40.40094, -3.71405], label: 'Pirámides' },
      { ll: [40.40513, -3.70230], via: 'graph', label: 'Embajadores' },   // por el Paseo de las Acacias
      { ll: [40.40588, -3.69936], via: 'graph', label: 'Ronda de Atocha' },
      { ll: [40.40798, -3.69304], via: 'graph', label: 'Atocha' },
      { ll: [40.40892, -3.69170], via: 'graph' },
      { ll: [40.41270, -3.69345], via: 'graph', label: 'Paseo del Prado' },
      { ll: [40.41540, -3.69400], via: 'graph', label: 'Neptuno' },
      { ll: [40.41900, -3.69377], via: 'graph', label: 'Cibeles' },
      { ll: [40.41951, -3.69328], via: 'graph' },
      { ll: [40.42229, -3.69168], via: 'graph', label: 'Meta' },   // Paseo de Recoletos a la altura de la calle Almirante
    ],
    landmarks: [
      { re: /Palacio de (Cibeles|Comunicaciones)/, c: '#f1ece2' },
      { re: /Banco de España/, c: '#e9e0cf' },
      { re: /Museo (Nacional )?del Prado|Edificio Villanueva/, c: '#d9a98a' },
      { re: /Puerta de Alcalá/, c: '#ece3cf', noWin: true },
      { re: /Palacio de Buenavista|Cuartel General del Ejército/, c: '#efe4cf' },
      { re: /Real Jardín Botánico/, c: '#e8dcc4' },
      { re: /Estación de (Madrid-)?(Puerta de )?Atocha/, c: '#c98e6c' },
    ],
    // fuentes que OSM no tiene como fuente (centro de la glorieta, radio del pilón en m)
    fountains: [
      { ll: [40.41930, -3.69310], r: 11, name: 'Cibeles' },
      { ll: [40.41532, -3.69408], r: 9, name: 'Neptuno' },
    ],
    keep: 420,
  },
};

// Berlín · los últimos ~10 km (km 32 → meta), para clases de 50–60 min: Hohenzollerndamm → Konstanzer Straße →
// Kurfürstendamm (Olivaer Platz, Gedächtniskirche) → Tauentzienstraße (KaDeWe) → Wittenbergplatz → Kleiststraße →
// Nollendorfplatz → Bülowstraße → Potsdamer Straße → Potsdamer Platz y el final de siempre. Orden de calles según
// Marathon Handbook y berlin.de (2026); sin km oficiales por calle. Trozos de 2 km.
CITIES.berlin10k = {
  ...CITIES.berlin,
  out: 'berlin-10k',
  name: 'Berlín · los últimos 10 km del maratón',
  chunk: 2000,
  keys: [
    { ll: [52.48774, 13.30008], label: 'Hohenzollerndamm' },
    { ll: [52.48862, 13.30804], via: 'graph' },
    { ll: [52.49351, 13.31012], via: 'graph', label: 'Konstanzer Straße' },
    { ll: [52.49925, 13.31263], via: 'graph' },
    { ll: [52.50047, 13.31260], via: 'graph', label: 'Kurfürstendamm' },
    { ll: [52.50441, 13.33568], via: 'graph', label: 'Gedächtniskirche' },
    { ll: [52.50202, 13.34222], via: 'graph', label: 'KaDeWe' },
    { ll: [52.50165, 13.34378], via: 'graph', label: 'Wittenbergplatz' },
    { ll: [52.49985, 13.35392], via: 'graph', label: 'Nollendorfplatz' },
    { ll: [52.49781, 13.36202], via: 'graph', label: 'Potsdamer Straße' },
    { ll: [52.50943, 13.37560], via: 'graph' },
    { ...CITIES.berlin.keys[0], via: 'graph' },
    ...CITIES.berlin.keys.slice(1),
  ],
};

const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'pedestrian', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link']);
const ROAD_W = { motorway: 16, trunk: 14, primary: 13, secondary: 11, tertiary: 9, unclassified: 7, residential: 7, living_street: 6,
  pedestrian: 8, primary_link: 6, secondary_link: 6, tertiary_link: 6, trunk_link: 6, service: 4.5 };

const [cityId, src, nodesSrc] = process.argv.slice(2);
const CITY = CITIES[cityId];
if (!CITY || !src) { console.error(`Uso: node tools/ciudad/bake.mjs <${Object.keys(CITIES).join('|')}> <extracto.json> [nodos.json]`); process.exit(1); }
const osm = JSON.parse(readFileSync(src, 'utf8'));

const [LAT0, LON0] = CITY.origin;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110574;
const P = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
const r1 = (v) => Math.round(v * 10) / 10;
const num = (v) => { const m = /-?\d+(\.\d+)?/.exec(String(v ?? '')); return m ? Number(m[0]) : null; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ── grafo de calles (sin sentido único: en carrera las calles están cortadas) ──
const nodes = new Map();   // id → [x, z]
const adj = new Map();     // id → [[id, m]]
for (const e of osm.elements) {
  if (e.type !== 'way' || !e.tags?.highway || !DRIVE.has(e.tags.highway) || !e.geometry) continue;
  if (e.tags.tunnel === 'yes' || Number(e.tags.layer) < 0) continue;   // pasos subterráneos fuera
  for (let i = 0; i < e.nodes.length; i++) {
    const g = e.geometry[i];
    nodes.set(e.nodes[i], P(g.lat, g.lon));
    if (i) {
      const a = e.nodes[i - 1]; const b = e.nodes[i];
      const m = dist(nodes.get(a), nodes.get(b));
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push([b, m]); adj.get(b).push([a, m]);
    }
  }
}
// solo la red principal (la componente conexa más grande): sin islas de calles sueltas a las que no se puede llegar
const mainNet = new Set();
{
  const seen = new Set();
  for (const id of adj.keys()) {
    if (seen.has(id)) continue;
    const comp = []; const stack = [id]; seen.add(id);
    while (stack.length) { const u = stack.pop(); comp.push(u); for (const [v] of adj.get(u)) if (!seen.has(v)) { seen.add(v); stack.push(v); } }
    if (comp.length > mainNet.size) { mainNet.clear(); for (const u of comp) mainNet.add(u); }
  }
}
function nearestNode(p) {
  let best = null; let bd = Infinity;
  for (const id of mainNet) { const d = dist(p, nodes.get(id)); if (d < bd) { bd = d; best = id; } }
  return best;
}
function shortest(a, b) {
  const D = new Map([[a, 0]]); const prev = new Map(); const done = new Set();
  const open = [[0, a]];
  while (open.length) {
    open.sort((x, y) => x[0] - y[0]);
    const [d, u] = open.shift();
    if (done.has(u)) continue;
    done.add(u);
    if (u === b) break;
    for (const [v, m] of adj.get(u) || []) {
      const nd = d + m;
      if (nd < (D.get(v) ?? Infinity)) { D.set(v, nd); prev.set(v, u); open.push([nd, v]); }
    }
  }
  const path = [b];
  while (path[0] !== a) { const p = prev.get(path[0]); if (p == null) throw new Error('Sin camino entre dos puntos clave'); path.unshift(p); }
  return path.map((id) => nodes.get(id));
}

// ── recorrido: tramos por calles o rectos, remuestreado cada metro y suavizado (curvas de ~12 m de radio) ──
let raw = [];
const keyAt = [];
CITY.keys.forEach((k, i) => {
  const p = P(...k.ll);
  if (!i) { raw.push(p); keyAt.push(0); return; }
  if (k.via === 'graph') {
    const seg = shortest(nearestNode(raw[raw.length - 1]), nearestNode(p));
    raw.push(...seg.slice(1));
  } else raw.push(p);
  keyAt.push(raw.length - 1);
});
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i]; const L = dist(a, b);
    let s = step - carry;
    while (s <= L) { out.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]); s += step; }
    carry = L - (s - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const keyPts = keyAt.map((i) => raw[i]);
let route = resample(raw, 1);
for (let pass = 0; pass < 4; pass++) {
  const w = 12;
  route = route.map((p, i) => {
    if (i < w || i >= route.length - w) return p;
    let x = 0; let z = 0;
    for (let k = -w; k <= w; k++) { x += route[i + k][0]; z += route[i + k][1]; }
    return [x / (2 * w + 1), z / (2 * w + 1)];
  });
}
route = resample(route, 2);
const cum = [0];
for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + dist(route[i - 1], route[i]));
const L = cum[cum.length - 1];
const sOf = (p) => { let bi = 0; let bd = Infinity; route.forEach((q, i) => { const d = dist(p, q); if (d < bd) { bd = d; bi = i; } }); return cum[bi]; };
const marks = [];
CITY.keys.forEach((k, i) => { if (k.label) marks.push({ s: r1(sOf(keyPts[i])), label: k.label }); });
const kmStart = CITY.kmAtEnd - L / 1000;
for (let km = Math.ceil(kmStart); km < CITY.kmAtEnd; km++) marks.push({ s: r1((km - kmStart) * 1000), km });
marks.sort((a, b) => a.s - b.s);

// distancia al recorrido (rejilla de 20 m para que sea rápido)
const GRID = 20;
const grid = new Map();
route.forEach((p, i) => { const k = `${Math.floor(p[0] / GRID)},${Math.floor(p[1] / GRID)}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
function nearRoute(p, R) {
  const gx = Math.floor(p[0] / GRID); const gz = Math.floor(p[1] / GRID); const n = Math.ceil(R / GRID);
  let bd = Infinity;
  for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) {
    for (const i of grid.get(`${gx + dx},${gz + dz}`) || []) bd = Math.min(bd, dist(p, route[i]));
  }
  return bd;
}

/** Punto del recorrido (m) más cercano a p, buscando hasta R m (null si no hay ninguno). */
function nearestS(p, R) {
  const gx = Math.floor(p[0] / GRID); const gz = Math.floor(p[1] / GRID); const n = Math.ceil(R / GRID);
  let bd = Infinity; let bi = -1;
  for (let dx = -n; dx <= n; dx++) for (let dz = -n; dz <= n; dz++) {
    for (const i of grid.get(`${gx + dx},${gz + dz}`) || []) { const d = dist(p, route[i]); if (d < bd) { bd = d; bi = i; } }
  }
  return bi < 0 ? null : cum[bi];
}

// ── anillos de polígonos (vías cerradas y multipolígonos: se cosen las piezas por sus extremos) ──
function ringsOf(e) {
  if (e.type === 'way') return e.geometry ? { outer: [e.geometry.map((g) => P(g.lat, g.lon))], inner: [] } : null;
  if (e.type !== 'relation' || !e.members) return null;
  const stitch = (role) => {
    const parts = e.members.filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => m.geometry.map((g) => P(g.lat, g.lon)));
    const rings = [];
    while (parts.length) {
      let ring = parts.shift();
      let grew = true;
      while (grew && dist(ring[0], ring[ring.length - 1]) > 0.05) {
        grew = false;
        for (let i = 0; i < parts.length; i++) {
          const q = parts[i]; const end = ring[ring.length - 1];
          if (dist(end, q[0]) < 0.05) ring = ring.concat(q.slice(1));
          else if (dist(end, q[q.length - 1]) < 0.05) ring = ring.concat(q.slice(0, -1).reverse());
          else continue;
          parts.splice(i, 1); grew = true; break;
        }
      }
      if (ring.length >= 4) rings.push(ring);
    }
    return rings;
  };
  return { outer: stitch('outer'), inner: stitch('inner') };
}
function inside(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]; const b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
const centroid = (ring) => { let x = 0; let z = 0; for (const p of ring) { x += p[0]; z += p[1]; } return [x / ring.length, z / ring.length]; };
const flat = (ring) => { const o = []; for (const p of ring.slice(0, -1)) o.push(r1(p[0]), r1(p[1])); return o; };
function colour(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const named = { white: '#e8e4dc', grey: '#8f8f8c', gray: '#8f8f8c', beige: '#d6c7a6', brown: '#7a5a43', red: '#9a4a3a', yellow: '#d8c27a',
    black: '#2a2a2a', sandstone: '#cdb48a', silver: '#b8bcc0', blue: '#5a7088', green: '#5b7a5a', tan: '#c9ad86', lightgrey: '#bdbdb8' };
  return named[s] || null;
}

// ── edificios y partes (regla de Simple 3D Buildings: si un edificio tiene partes, se dibujan las partes) ──
const blds = []; const parts = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  const isPart = !!t['building:part'] && t['building:part'] !== 'no';
  const isBld = !!t.building && t.building !== 'no';
  if (!isPart && !isBld) continue;
  if (t.location === 'underground' || t.layer && Number(t.layer) < 0 || t.building === 'roof' && !isPart) { /* tejadillos sueltos: fuera */ }
  const rg = ringsOf(e);
  if (!rg || !rg.outer.length) continue;
  const lv = num(t['building:levels']);
  let h = num(t.height) ?? (lv != null ? lv * 3.3 + (num(t['roof:levels']) ?? 0) * 2.5 : null);
  const mh = num(t.min_height) ?? (num(t['building:min_level']) != null ? num(t['building:min_level']) * 3.3 : 0);
  if (h == null) h = t.building === 'roof' ? 5 : isPart ? 12 : CITY.defaultH;
  if (h - mh < 0.5) continue;
  const item = { rg, h, mh, c: colour(t['building:colour']), rc: colour(t['roof:colour']), name: t.name || null, id: e.id };
  (isPart ? parts : blds).push(item);
}
const partC = parts.map((p) => centroid(p.rg.outer[0]));
// monumentos: las partes dentro del contorno de la Puerta de Brandeburgo llevan su color (arenisca) y no tienen ventanas
const lmOf = (name) => (name ? CITY.landmarks.find((l) => l.re.test(name)) || null : null);
const landmarks = blds.filter((b) => lmOf(b.name)).map((b) => ({ ring: b.rg.outer[0], lm: lmOf(b.name) }));
for (const [i, p] of parts.entries()) p.lmDef = lmOf(p.name) || landmarks.find((l) => inside(partC[i], l.ring))?.lm || null;
const out = { b: [] };
let skippedOutline = 0; let skippedRoute = 0;
for (const [list, isPart] of [[blds, false], [parts, true]]) {
  for (const b of list) {
    const ring = b.rg.outer[0];
    const c = centroid(ring);
    if (nearRoute(c, CITY.keep + 200) > CITY.keep && ring.every((p) => nearRoute(p, CITY.keep) > CITY.keep)) continue;
    if (!isPart && partC.some((pc) => inside(pc, ring))) { skippedOutline++; continue; }
    // ningún edificio a ras de suelo puede tapar el recorrido (pasajes y arcos con min_height ≥ 4 m sí)
    if (b.mh < 4 && route.some((p) => inside(p, ring))) { skippedRoute++; continue; }
    const o = { p: flat(ring), h: r1(b.h) };
    if (b.mh) o.mh = r1(b.mh);
    if (b.rg.inner.length) o.in = b.rg.inner.map(flat);
    if (b.c) o.c = b.c;
    if (b.rc) o.rc = b.rc;
    const lm = b.lmDef || lmOf(b.name);
    if (lm) { o.c = lm.c; if (lm.noWin) o.lm = 1; }
    out.b.push(o);
  }
}

// ── fuentes (Cibeles, Neptuno…): pilón de piedra con agua y un pedestal en el centro que sugiere el grupo escultórico ──
const circle = (c, r, n = 20) => { const o = []; for (let k = 0; k <= n; k++) o.push([c[0] + r * Math.cos((k * 2 * Math.PI) / n), c[1] + r * Math.sin((k * 2 * Math.PI) / n)]); return o; };
const fountainRings = [
  ...osm.elements.filter((e) => e.tags?.amenity === 'fountain' && e.type === 'way' && e.geometry).map((e) => e.geometry.map((g) => P(g.lat, g.lon))),
  ...(CITY.fountains || []).map((f) => circle(P(...f.ll), f.r)),
];
for (const ring of fountainRings) {
  const c = centroid(ring);
  if (nearRoute(c, CITY.keep) > CITY.keep || route.some((p) => inside(p, ring))) continue;
  out.b.push({ p: flat(ring), h: 0.7, c: '#cfc6b4', rc: '#3f6478', lm: 1 });
  let R = Infinity; for (const p of ring) R = Math.min(R, dist(p, c));
  if (R > 3) {
    const r = Math.min(2.2, R * 0.25); const oct = [];
    for (let k = 0; k < 8; k++) oct.push(r1(c[0] + r * Math.cos((k * Math.PI) / 4)), r1(c[1] + r * Math.sin((k * Math.PI) / 4)));
    out.b.push({ p: oct, h: Math.min(7, 2.5 + R * 0.25), c: '#e4ddcc', lm: 1 });
  }
}

// ── calles (cintas de asfalto) y zonas verdes ──
const roads = []; const areas = [];
for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'way' && t.highway && (DRIVE.has(t.highway) || t.highway === 'service') && e.geometry && t.area !== 'yes') {
    const pts = e.geometry.map((g) => P(g.lat, g.lon));
    if (pts.every((p) => nearRoute(p, CITY.keep) > CITY.keep)) continue;
    if (t.tunnel === 'yes' || t.layer && Number(t.layer) < 0) continue;
    const lanes = num(t.lanes);
    let w = num(t.width) ?? (lanes ? lanes * 3.2 + 1 : ROAD_W[t.highway] ?? 6);
    if (t.oneway === 'yes' && !lanes && !num(t.width)) w *= 0.6;
    const o = []; for (const p of pts) o.push(r1(p[0]), r1(p[1]));
    roads.push({ p: o, w: r1(w), k: t.highway === 'pedestrian' || t.highway === 'living_street' ? 'ped' : 'road' });
  }
  const green = t.leisure === 'park' || t.leisure === 'garden' ? 'park' : t.landuse === 'grass' ? 'grass' : t.natural === 'wood' ? 'wood' : null;
  if (green) {
    const rg = ringsOf(e);
    if (!rg) continue;
    for (const ring of rg.outer) {
      if (ring.every((p) => nearRoute(p, CITY.keep * 2) > CITY.keep * 2)) continue;
      areas.push({ p: flat(ring), k: green });
    }
  }
}

// ── árboles y farolas reales (nodos de OSM; Berlín tiene su catastro de árboles importado) ──
const trees = []; const lamps = [];
if (nodesSrc) {
  for (const e of JSON.parse(readFileSync(nodesSrc, 'utf8')).elements) {
    if (e.type !== 'node') continue;
    const p = P(e.lat, e.lon);
    const t = e.tags || {};
    const d = nearRoute(p, 90);
    if (d < 2.5) continue;   // nada plantado en tu línea (plazas y pasos de la Puerta)
    if (t.natural === 'tree' && d <= 90) {
      const h = num(t.height); const cr = num(t.diameter_crown);
      trees.push(r1(p[0]), r1(p[1]), r1(Math.min(30, Math.max(5, h ?? 14))), r1(Math.min(20, Math.max(3, cr ?? (h ?? 14) * 0.55))));
    } else if (t.highway === 'street_lamp' && d <= 60) lamps.push(r1(p[0]), r1(p[1]));
  }
}

// árboles de los parques y bulevares que OSM no tiene uno a uno (Salón del Prado, Tiergarten…): rejilla de ~10 m con
// desplazamiento, solo dentro de las zonas verdes a menos de 120 m del recorrido y lejos de calles, edificios y árboles reales
{
  const rnd = (() => { let x = 12345; return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  const segs = [];
  for (const r of roads) for (let i = 0; i + 3 < r.p.length; i += 2) segs.push([r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3], r.w / 2 + 2]);
  const segDist = (p, s) => {
    const vx = s[2] - s[0]; const vz = s[3] - s[1]; const L2 = vx * vx + vz * vz || 1;
    const k = Math.max(0, Math.min(1, ((p[0] - s[0]) * vx + (p[1] - s[1]) * vz) / L2));
    return Math.hypot(p[0] - s[0] - k * vx, p[1] - s[1] - k * vz);
  };
  const real = []; for (let i = 0; i < trees.length; i += 4) real.push([trees[i], trees[i + 1]]);
  const bRings = out.b.map((b) => { const r = []; for (let i = 0; i < b.p.length; i += 2) r.push([b.p[i], b.p[i + 1]]); return r; });
  let added = 0;
  for (const a of areas) {
    if (a.k !== 'park' || added > 900) continue;
    const ring = []; for (let i = 0; i < a.p.length; i += 2) ring.push([a.p[i], a.p[i + 1]]);
    ring.push(ring[0]);
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (const p of ring) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let x = x0 + 5; x < x1; x += 10) for (let z = z0 + 5; z < z1; z += 10) {
      const p = [x + (rnd() - 0.5) * 6, z + (rnd() - 0.5) * 6];
      if (!inside(p, ring)) continue;
      const d = nearRoute(p, 120);
      if (d > 120 || d < 9) continue;
      if (real.some((q) => dist(p, q) < 6)) continue;
      if (segs.some((s) => Math.abs(s[0] - p[0]) < 60 && Math.abs(s[1] - p[1]) < 60 && segDist(p, s) < s[4])) continue;
      if (bRings.some((r) => Math.abs(r[0][0] - p[0]) < 150 && inside(p, r))) continue;
      const h = 11 + rnd() * 9;
      trees.push(r1(p[0]), r1(p[1]), r1(h), r1(h * (0.5 + rnd() * 0.2)));
      added++;
    }
  }
  console.log(`árboles añadidos en parques y bulevares: ${added}`);
}

const r2 = (v) => Math.round(v * 100) / 100;   // el recorrido, al centímetro (0,1 m en pasos de 2 m = quiebros de 3°)
const routeFlat = []; for (const p of route) routeFlat.push(r2(p[0]), r2(p[1]));
// ── salida: assets/world/ciudad/<out>/route.json (recorrido y lista de trozos) + c<k>.json, un trozo cada CITY.chunk m
//    de recorrido. Cada elemento va al trozo de su punto más cercano del recorrido; calles y zonas verdes, a todos los
//    trozos que tocan (un parque grande como el Tiergarten se ve desde cualquiera). El escenario carga los trozos
//    cercanos a ti y suelta los de atrás: la memoria es la de ~4 km aunque la ruta tenga 10 o 42.
const CH = CITY.chunk || Infinity;
const nCh = Number.isFinite(CH) ? Math.max(1, Math.ceil(L / CH)) : 1;
const chunkOf = (sv) => Math.min(nCh - 1, Math.max(0, Math.floor(sv / CH)));
const parts_ = Array.from({ length: nCh }, (_, k) => ({ s0: Number.isFinite(CH) ? k * CH : 0, s1: Number.isFinite(CH) ? Math.min(L, (k + 1) * CH) : L, buildings: [], roads: [], areas: [], trees: [], lamps: [] }));
const touched = (pts, R) => { const set = new Set(); for (let i = 0; i < pts.length; i += 2) { const sv = nearestS([pts[i], pts[i + 1]], R); if (sv != null) set.add(chunkOf(sv)); } return set; };
for (const b of out.b) {
  let x = 0; let z = 0; const n = b.p.length / 2; for (let i = 0; i < b.p.length; i += 2) { x += b.p[i]; z += b.p[i + 1]; }
  const sv = nearestS([x / n, z / n], CITY.keep + 250);
  parts_[chunkOf(sv ?? 0)].buildings.push(b);
}
for (const r of roads) for (const k of touched(r.p, CITY.keep + 60)) parts_[k].roads.push(r);
for (const a of areas) {
  const set = touched(a.p, CITY.keep * 2);
  const ring = []; for (let i = 0; i < a.p.length; i += 2) ring.push([a.p[i], a.p[i + 1]]);
  for (let i = 0; i < route.length; i += 25) if (inside(route[i], ring)) set.add(chunkOf(cum[i]));   // la ruta lo atraviesa
  for (const k of set) parts_[k].areas.push(a);
}
for (let i = 0; i < trees.length; i += 4) parts_[chunkOf(nearestS([trees[i], trees[i + 1]], 200) ?? 0)].trees.push(trees[i], trees[i + 1], trees[i + 2], trees[i + 3]);
for (let i = 0; i < lamps.length; i += 2) parts_[chunkOf(nearestS([lamps[i], lamps[i + 1]], 200) ?? 0)].lamps.push(lamps[i], lamps[i + 1]);

const dir = join(ROOT, 'assets/world/ciudad', CITY.out);
mkdirSync(dir, { recursive: true });
let bytes = 0;
const chunkList = parts_.map((c, k) => {
  const txt = JSON.stringify({ s0: r1(c.s0), s1: r1(c.s1), buildings: c.buildings, roads: c.roads, areas: c.areas, trees: c.trees, lamps: c.lamps });
  writeFileSync(join(dir, `c${k}.json`), txt);
  bytes += txt.length;
  return { f: `c${k}.json`, s0: r1(c.s0), s1: r1(c.s1), b: c.buildings.length };
});
const json = {
  name: CITY.name,
  credits: '© colaboradores de OpenStreetMap (ODbL 1.0)',
  origin: CITY.origin,
  route: { step: 2, length: r1(L), kmAtEnd: CITY.kmAtEnd, p: routeFlat, marks },
  chunks: chunkList,
};
const file = join(dir, 'route.json');
writeFileSync(file, JSON.stringify(json));
bytes += JSON.stringify(json).length;
console.log(`recorrido ${L.toFixed(0)} m (km ${kmStart.toFixed(2)} → ${CITY.kmAtEnd}) · ${out.b.length} edificios/partes `
  + `(${skippedOutline} contornos con partes, ${skippedRoute} sobre el recorrido) · ${roads.length} calles · ${areas.length} zonas verdes · ${trees.length / 4} árboles · ${lamps.length / 2} farolas`);
console.log('marcas:', marks.map((m) => `${m.s}m ${m.label || `km ${m.km}`}`).join(' · '));
console.log(`→ ${dir}/ · ${nCh} trozo(s): ${chunkList.map((c) => `${c.f} ${c.s0}–${c.s1} m, ${c.b} edif.`).join(' · ')} · ${(bytes / 1024).toFixed(0)} KB`);
