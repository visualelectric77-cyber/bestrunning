// RITMUP · guarda en el estado la decisión de enfoque cuando cambia. Si algo falla, el plan sigue siendo el normal.
import { getState, setState } from '../core/store.js';
import { focusUpdate } from './focus.js';

export function syncFocus(now = new Date()) {
  try {
    const patch = focusUpdate(getState(), now);
    if (patch) setState((d) => { d.plan = d.plan || {}; d.plan.focus = patch; });
  } catch (err) {
    console.warn('[focus]', err);
  }
}
