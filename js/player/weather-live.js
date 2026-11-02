// RITMUP · TIEMPO REAL en los escenarios (opción, apagada por defecto: Ajustes › Pantalla de entreno › «Tiempo del
// escenario»). Con «Tiempo real» el escenario toma la hora del día (posición del sol, calculada aquí) y el tiempo que
// hace ahora (nubes, lluvia, nieve, niebla) en TU ubicación o en una ciudad elegida (Madrid, Nueva York…).
// El tiempo lo da Open-Meteo (open-meteo.com: gratis, sin clave ni cuenta). Solo se le manda la ciudad elegida o tu
// posición REDONDEADA a 0,1° (unos 10 km); se guarda 15 min en el iPhone. Sin red o sin permiso: el escenario sigue
// con su propio tiempo (los escenarios vivos), nunca se rompe nada.
// Funciones puras (posición del sol, traducción del tiempo) probadas en Node: tools/test-weather-live.mjs.

export const WEATHER_KEY = 'ritmup.weather';      // 'scene' (por defecto) · 'here' · 'city:<id>'
const CACHE_KEY = 'ritmup.weather.cache';
const CACHE_MS = 15 * 60 * 1000;

/** Ciudades para elegir (id → nombre y coordenadas). */
export const CITIES = [
  { id: 'madrid', name: 'Madrid', lat: 40.4168, lon: -3.7038 },
  { id: 'barcelona', name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
  { id: 'valencia', name: 'Valencia', lat: 39.4699, lon: -0.3763 },
  { id: 'sevilla', name: 'Sevilla', lat: 37.3891, lon: -5.9845 },
  { id: 'malaga', name: 'Málaga', lat: 36.7213, lon: -4.4214 },
  { id: 'bilbao', name: 'Bilbao', lat: 43.263, lon: -2.935 },
  { id: 'nueva-york', name: 'Nueva York', lat: 40.7128, lon: -74.006 },
  { id: 'londres', name: 'Londres', lat: 51.5072, lon: -0.1276 },
  { id: 'paris', name: 'París', lat: 48.8566, lon: 2.3522 },
  { id: 'tokio', name: 'Tokio', lat: 35.6762, lon: 139.6503 },
  { id: 'sidney', name: 'Sídney', lat: -33.8688, lon: 151.2093 },
];
export const cityById = (id) => CITIES.find((c) => c.id === id) || null;

/** Preferencia guardada: { mode: 'scene' | 'here' | 'city', city }. */
export function weatherPref() {
  let v = 'scene';
  try { v = globalThis.localStorage?.getItem(WEATHER_KEY) || 'scene'; } catch { /* sin almacenamiento */ }
  if (v === 'here') return { mode: 'here', city: null };
  if (v.startsWith('city:') && cityById(v.slice(5))) return { mode: 'city', city: cityById(v.slice(5)) };
  return { mode: 'scene', city: null };
}

/**
 * Elevación del sol (grados) en lat/lon (grados) en el instante `date` (fórmulas compactas del almanaque, error < 1°:
 * de sobra para pintar el cielo).
 */
export function sunElevation(lat, lon, date = new Date()) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;   // días desde J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24 + 24) % 24;
  const ha = (gmst * 15 + lon) * rad - ra;
  const la = lat * rad;
  return Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha)) / rad;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * Tiempo de Open-Meteo (bloque `current`) + elevación del sol → estado para los escenarios:
 * { day 0..1 (de noche a pleno día), golden 0..1 (sol bajo: amanecer/atardecer), cloud 0..1, rain 0..1, snow 0..1,
 *   mist 0..1, temp, code, sunEl, label }.
 */
export function weatherState(cur, sunEl, place = '') {
  const c = cur || {};
  const code = Number(c.weather_code) || 0;
  const rainMm = (Number(c.rain) || 0) + (Number(c.showers) || 0);
  const snowCm = Number(c.snowfall) || 0;
  const isRainCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  const isSnowCode = (code >= 71 && code <= 77) || code === 85 || code === 86;
  const rain = isSnowCode ? 0 : Math.max(clamp01(rainMm / 3), isRainCode ? 0.3 : 0);
  const snow = Math.max(clamp01(snowCm / 1.5), isSnowCode ? 0.35 : 0);
  const mist = code === 45 || code === 48 ? 1 : 0;
  const cloud = clamp01((Number(c.cloud_cover) || 0) / 100);
  const day = sstep(-7, 8, sunEl);
  const golden = sstep(-6, 1, sunEl) * (1 - sstep(4, 16, sunEl));
  const temp = Number.isFinite(Number(c.temperature_2m)) ? Math.round(Number(c.temperature_2m)) : null;
  const what = mist ? 'niebla' : snow > 0.2 ? 'nieve' : rain > 0.6 ? 'lluvia' : rain > 0.05 ? 'llovizna'
    : cloud > 0.75 ? 'nublado' : cloud > 0.35 ? 'algo de nubes' : day > 0.5 ? 'despejado' : 'noche despejada';
  const when = sunEl < -6 ? 'de noche' : golden > 0.5 ? (isMorning() ? 'amaneciendo' : 'atardeciendo') : day > 0.9 ? 'de día' : '';
  function isMorning() { return new Date().getHours() < 14; }
  const label = [place, temp != null ? `${temp}°` : null, what, when].filter(Boolean).join(' · ');
  return { day, golden, cloud, rain, snow, mist, temp, code, sunEl, label };
}

const round1 = (v) => Math.round(v * 10) / 10;

function readCache(key) {
  try {
    const c = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) || 'null');
    if (c && c.key === key && Date.now() - c.at < CACHE_MS) return c.cur;
  } catch { /* nada */ }
  return null;
}
function writeCache(key, cur) {
  try { globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({ key, at: Date.now(), cur })); } catch { /* nada */ }
}

function here() {
  return new Promise((resolve, reject) => {
    const g = globalThis.navigator?.geolocation;
    if (!g) { reject(new Error('sin geolocalización')); return; }
    g.getCurrentPosition((p) => resolve({ lat: round1(p.coords.latitude), lon: round1(p.coords.longitude) }), reject,
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30 * 60 * 1000 });
  });
}

/**
 * Tiempo real según la preferencia. → Promise<estado | null> (null = «el del escenario» o no se pudo). Nunca lanza.
 * opts.pref para forzar una preferencia (Ajustes la usa para la vista previa).
 */
export async function fetchLiveWeather(opts = {}) {
  const pref = opts.pref || weatherPref();
  if (pref.mode === 'scene') return null;
  try {
    let pos; let place;
    if (pref.mode === 'city') { pos = { lat: pref.city.lat, lon: pref.city.lon }; place = pref.city.name; } else { pos = await here(); place = 'Aquí'; }
    const key = `${pos.lat},${pos.lon}`;
    let cur = readCache(key);
    if (!cur) {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}`
        + '&current=temperature_2m,cloud_cover,precipitation,rain,showers,snowfall,weather_code,is_day&timezone=auto';
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const t = setTimeout(() => ctl?.abort(), 6000);
      const r = await fetch(url, { signal: ctl?.signal, cache: 'no-store' });
      clearTimeout(t);
      if (!r.ok) return null;
      cur = (await r.json())?.current || null;
      if (!cur) return null;
      writeCache(key, cur);
    }
    return weatherState(cur, sunElevation(pos.lat, pos.lon, new Date()), place);
  } catch {
    return null;
  }
}
