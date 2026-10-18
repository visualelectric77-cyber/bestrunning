// BestRunning · "Guardar en Salud" mediante un Atajo de iOS (una web no puede escribir en HealthKit).
// El Atajo recibe un texto JSON { fecha, minutos, km, kcal } y registra el entreno en Salud.

/** Datos que se pasan al Atajo. fecha = inicio en ISO. */
export function healthPayload(session) {
  const s = session || {};
  return {
    fecha: s.startedAt || new Date().toISOString(),
    minutos: Math.round(((Number(s.elapsedSec) || 0) / 60) * 10) / 10,
    km: Math.round((Number(s.distanceKm) || 0) * 100) / 100,
    kcal: Math.round(Number(s.kcal) || 0),
  };
}

export function healthShortcutUrl(session, shortcutName) {
  const name = String(shortcutName || '').trim();
  if (!name) return '';
  const text = JSON.stringify(healthPayload(session));
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}&input=text&text=${encodeURIComponent(text)}`;
}

/** Abre la app Atajos. Devuelve false si no hay nombre de Atajo configurado. */
export function openHealthShortcut(session, shortcutName) {
  const url = healthShortcutUrl(session, shortcutName);
  if (!url) return false;
  try {
    window.location.href = url;
    return true;
  } catch {
    return false;
  }
}
