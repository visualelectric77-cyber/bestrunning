// RITMUP · TIEMPO REAL en los escenarios (opción, apagada por defecto: Ajustes › Pantalla de entreno › «Tiempo del
// escenario»). Con «Tiempo real» el escenario toma la hora del día (posición del sol, calculada aquí) y el tiempo que
// hace ahora (nubes, lluvia, nieve, niebla) en TU ubicación o en una ciudad elegida (Madrid, Nueva York…).
// El tiempo lo da Open-Meteo (open-meteo.com: gratis, sin clave ni cuenta). Solo se le manda la ciudad elegida o tu
// posición REDONDEADA a 0,1° (unos 10 km); se guarda 15 min en el iPhone.
// LA HORA DEL DÍA NUNCA DEPENDE DE LA RED: la posición del sol se calcula aquí. Si Open-Meteo falla (sin red, o
// «service overloaded», como el 2 nov 2026), se usa el último tiempo guardado (hasta 6 h) o cielo despejado; si no
// hay permiso de ubicación, la zona aproximada de tu zona horaria (Europe/Madrid ⇒ Madrid…).
// Funciones puras (posición del sol, traducción del tiempo) probadas en Node: tools/test-weather-live.mjs.

export const WEATHER_KEY = 'ritmup.weather';      // 'scene' (por defecto) · 'here' · 'city:<id>'
const CACHE_KEY = 'ritmup.weather.cache';
const CACHE_MS = 15 * 60 * 1000;
const STALE_MS = 6 * 60 * 60 * 1000;     // con el servicio caído, el último tiempo conocido vale hasta 6 h

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

function readCache(key, maxAge = CACHE_MS) {
  try {
    const c = JSON.parse(globalThis.localStorage?.getItem(CACHE_KEY) || 'null');
    if (c && c.key === key && Date.now() - c.at < maxAge) return c.cur;
  } catch { /* nada */ }
  return null;
}

/** Zona horaria del iPhone → ciudad aproximada (respaldo sin permiso de ubicación). */
const TZ_CITY = {
  'Europe/Madrid': 'madrid', 'Europe/London': 'londres', 'Europe/Paris': 'paris', 'America/New_York': 'nueva-york',
  'Asia/Tokyo': 'tokio', 'Australia/Sydney': 'sidney',
};
export function cityFromTimeZone(tz = null) {
  let z = tz;
  try { z = z || Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { z = null; }
  if (z === 'Atlantic/Canary') return { id: 'canarias', name: 'Canarias', lat: 28.1, lon: -15.4 };
  return cityById(TZ_CITY[z] || 'madrid');
}
function writeCache(key, cur) {
  try { globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify({ key, at: Date.now(), cur })); } catch { /* nada */ }
}

function here() {
  return new Promise((resolve, reject) => {
    const g = globalThis.navigator?.geolocation;
    if (!g) { reject(new Error('sin geolocalización')); return; }
    g.getCurrentPosition((p) => {
      const pos = { lat: round1(p.coords.latitude), lon: round1(p.coords.longitude) };
      try { globalThis.localStorage?.setItem(LAST_HERE, JSON.stringify(pos)); } catch { /* nada */ }
      resolve(pos);
    }, reject,
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
    if (pref.mode === 'city') { pos = { lat: pref.city.lat, lon: pref.city.lon }; place = pref.city.name; } else {
      try { pos = await here(); place = 'Aquí'; } catch {
        const c = cityFromTimeZone();            // sin permiso o sin GPS: tu zona horaria
        pos = { lat: c.lat, lon: c.lon }; place = `${c.name} (aprox.)`;
      }
    }
    const key = `${pos.lat},${pos.lon}`;
    let cur = readCache(key);
    let offline = false;
    if (!cur) {
      try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}`
          + '&current=temperature_2m,cloud_cover,precipitation,rain,showers,snowfall,weather_code,is_day&timezone=auto';
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const t = setTimeout(() => ctl?.abort(), 6000);
        const r = await fetch(url, { signal: ctl?.signal, cache: 'no-store' });
        clearTimeout(t);
        const j = r.ok ? await r.json() : null;
        cur = j && !j.error && j.current ? j.current : null;
        if (cur) writeCache(key, cur);
      } catch { cur = null; }
      if (!cur) { cur = readCache(key, STALE_MS) || { cloud_cover: 0, weather_code: 0 }; offline = true; }
    }
    const st = weatherState(cur, sunElevation(pos.lat, pos.lon, new Date()), place);
    if (offline) { st.offline = true; st.label = `${place} · sin datos del tiempo ahora · hora real`; }
    return st;
  } catch {
    return null;
  }
}

const LAST_HERE = 'ritmup.weather.here';   // última posición (redondeada) de «aquí», para el estado inmediato

/**
 * Estado INMEDIATO, sin red ni permisos (síncrono): la hora real por la posición del sol en la ciudad elegida, tu última
 * posición conocida o tu zona horaria, con el último tiempo guardado (hasta 6 h) o despejado. El escenario lo usa desde
 * el primer fotograma; fetchLiveWeather lo afina en cuanto llega. null con «El del escenario».
 */
export function quickLiveWeather() {
  const pref = weatherPref();
  if (pref.mode === 'scene') return null;
  let pos = null; let place = '';
  if (pref.mode === 'city') { pos = { lat: pref.city.lat, lon: pref.city.lon }; place = pref.city.name; } else {
    try { pos = JSON.parse(globalThis.localStorage?.getItem(LAST_HERE) || 'null'); } catch { pos = null; }
    place = 'Aquí';
    if (!pos) { const c = cityFromTimeZone(); pos = { lat: c.lat, lon: c.lon }; place = `${c.name} (aprox.)`; }
  }
  const cur = readCache(`${pos.lat},${pos.lon}`, STALE_MS) || { cloud_cover: 0, weather_code: 0 };
  return weatherState(cur, sunElevation(pos.lat, pos.lon, new Date()), place);
}
