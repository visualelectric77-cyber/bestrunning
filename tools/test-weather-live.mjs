// RITMUP · tests del tiempo real de los escenarios (js/player/weather-live.js): posición del sol y traducción del
// tiempo de Open-Meteo a lo que pintan los escenarios. Uso: node tools/test-weather-live.mjs
import { sunElevation, weatherState, CITIES, cityById, weatherPref, WEATHER_KEY } from '../js/player/weather-live.js';

let failures = 0;
let passes = 0;
function ok(cond, msg) {
  if (cond) { passes++; return; }
  failures++;
  process.stderr.write(`  ✗ ${msg}\n`);
}
function section(name, fn) {
  process.stdout.write(`• ${name}\n`);
  try { fn(); } catch (err) { failures++; process.stderr.write(`  ✗ excepción: ${err?.stack || err}\n`); }
}

section('posición del sol', () => {
  const md = cityById('madrid');
  // solsticio de verano, mediodía solar en Madrid (~12:15 UTC): 90 − 40,4 + 23,44 ≈ 73°
  const noon = sunElevation(md.lat, md.lon, new Date(Date.UTC(2026, 5, 21, 12, 15)));
  ok(Math.abs(noon - 73) < 1.5, `mediodía de junio en Madrid ≈ 73° (${noon.toFixed(1)}°)`);
  // solsticio de invierno: 90 − 40,4 − 23,44 ≈ 26°
  const win = sunElevation(md.lat, md.lon, new Date(Date.UTC(2026, 11, 21, 12, 15)));
  ok(Math.abs(win - 26.2) < 1.5, `mediodía de diciembre en Madrid ≈ 26° (${win.toFixed(1)}°)`);
  const night = sunElevation(md.lat, md.lon, new Date(Date.UTC(2026, 10, 2, 1, 0)));
  ok(night < -30, `madrugada en Madrid: sol bajo el horizonte (${night.toFixed(1)}°)`);
  const ny = cityById('nueva-york');
  const nyNoon = sunElevation(ny.lat, ny.lon, new Date(Date.UTC(2026, 10, 2, 16, 45)));
  const nyNight = sunElevation(ny.lat, ny.lon, new Date(Date.UTC(2026, 10, 2, 5, 0)));
  ok(nyNoon > 25 && nyNoon < 40, `mediodía de noviembre en Nueva York (${nyNoon.toFixed(1)}°)`);
  ok(nyNight < -20, `noche en Nueva York cuando en Madrid amanece (${nyNight.toFixed(1)}°)`);
  const syd = cityById('sidney');
  ok(sunElevation(syd.lat, syd.lon, new Date(Date.UTC(2026, 11, 21, 2, 0))) > 70, 'verano austral: sol alto en Sídney en diciembre');
});

section('tiempo de Open-Meteo → escenario', () => {
  const clear = weatherState({ cloud_cover: 5, rain: 0, showers: 0, snowfall: 0, weather_code: 0, temperature_2m: 21.4 }, 45, 'Madrid');
  ok(clear.day === 1 && clear.cloud < 0.1 && clear.rain === 0 && clear.snow === 0, 'despejado de día');
  ok(clear.label === 'Madrid · 21° · despejado · de día', `etiqueta: «${clear.label}»`);
  const night = weatherState({ cloud_cover: 0, weather_code: 0 }, -20, 'Madrid');
  ok(night.day === 0 && night.golden === 0, 'de noche: day 0');
  const dawn = weatherState({ cloud_cover: 20, weather_code: 1 }, -2, 'Madrid');
  ok(dawn.golden > 0.5 && dawn.day > 0.1 && dawn.day < 0.6, `amanecer: luz dorada y medio día (${dawn.golden.toFixed(2)}, ${dawn.day.toFixed(2)})`);
  const rain = weatherState({ cloud_cover: 100, rain: 2.4, showers: 0, weather_code: 63 }, 20, 'Bilbao');
  ok(rain.rain > 0.7 && rain.cloud === 1 && rain.label.includes('lluvia'), `lluvia moderada: ${rain.rain.toFixed(2)} «${rain.label}»`);
  const drizzle = weatherState({ cloud_cover: 90, rain: 0, weather_code: 51 }, 20, 'Londres');
  ok(drizzle.rain >= 0.3 && drizzle.rain < 0.5, 'llovizna sin milímetros: lluvia fina igualmente');
  const snow = weatherState({ cloud_cover: 100, snowfall: 0.8, weather_code: 73 }, 10, 'Nueva York');
  ok(snow.snow > 0.5 && snow.rain === 0 && snow.label.includes('nieve'), 'nieve: sin lluvia');
  const fog = weatherState({ cloud_cover: 100, weather_code: 45 }, 5, 'Madrid');
  ok(fog.mist === 1 && fog.label.includes('niebla'), 'niebla');
  const empty = weatherState(null, 10);
  ok(Number.isFinite(empty.day) && empty.rain === 0, 'sin datos: valores neutros, sin NaN');
});

section('preferencia', () => {
  ok(CITIES.length >= 8 && CITIES.every((c) => c.id && c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon)), 'ciudades completas');
  ok(cityById('madrid')?.name === 'Madrid' && cityById('nueva-york')?.name === 'Nueva York', 'Madrid y Nueva York');
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  ok(weatherPref().mode === 'scene', 'por defecto: el del escenario');
  store.set(WEATHER_KEY, 'city:nueva-york');
  ok(weatherPref().mode === 'city' && weatherPref().city.id === 'nueva-york', 'ciudad elegida');
  store.set(WEATHER_KEY, 'city:atlantida');
  ok(weatherPref().mode === 'scene', 'ciudad desconocida → el del escenario');
  store.set(WEATHER_KEY, 'here');
  ok(weatherPref().mode === 'here', 'aquí');
});

process.stdout.write(`\n${failures ? '✗' : '✓'} tiempo real: ${passes} comprobaciones, ${failures} fallos\n`);
process.exit(failures ? 1 : 0);
