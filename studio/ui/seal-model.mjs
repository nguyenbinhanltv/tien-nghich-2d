// The seal's rules without any DOM, so they can be tested: the setting, reduced motion, the pixels and the "only after the server said yes" order.
export const SEAL_KEY = 'studio.review.seal';
export const TOAST_MS = 6000;

/** 'on' unless the person switched it off. A broken or missing storage counts as the default. */
export function sealSetting(storage) {
  try { return storage?.getItem(SEAL_KEY) === 'off' ? 'off' : 'on'; } catch { return 'on'; }
}
export function setSealSetting(storage, value) {
  try { storage?.setItem(SEAL_KEY, value === 'off' ? 'off' : 'on'); } catch { /* private mode: the choice lasts until reload */ }
  return value === 'off' ? 'off' : 'on';
}

/** True when the system asks for less motion. `win` is window (or a stand-in with matchMedia). */
export const reducedMotion = win => { try { return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** The seal plays only when it is switched on AND the system does not ask for less motion. */
export const sealAllowed = (storage, win) => sealSetting(storage) === 'on' && !reducedMotion(win);

const valid = rows => Array.isArray(rows) && rows.length === 12 && rows.every(r => typeof r === 'string' && /^[.#]{12}$/.test(r));
/** The pack's 12x12 grid, or a solid block with a one-pixel margin when the pack has none. */
export const sealRows = rows => (valid(rows) ? rows : Array.from({length: 12}, (_, y) => (y === 0 || y === 11 ? '.'.repeat(12) : '.' + '#'.repeat(10) + '.')));

/** A few gold specks as fixed offsets (no randomness: the same stamp every time, easy to capture). */
export const sealParticles = () => [[-46, -34, 4], [44, -40, 4], [-54, 6, 3], [52, 2, 3], [-30, 38, 4], [34, 40, 3]].map(([dx, dy, size]) => ({dx, dy, size}));

/**
 * Run `send` (the request that records the decision); only when it resolved call `stamp`. A rejection skips the stamp and is rethrown
 * for the caller to show. `stamp` is never awaited-for-its-animation: it returns at once and nothing waits on it.
 */
export async function approveThenStamp(send, stamp) {
  const result = await send();
  try { stamp(result); } catch { /* the stamp is decoration; a failure in it must not undo or hide a recorded decision */ }
  return result;
}
