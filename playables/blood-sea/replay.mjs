// One base-36 character per active simulation tick, including hitstop.
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
const storageKey = 'tien-nghich.blood-sea.best-inputs.v1';
let tabTrace = '';

export function encodeInput({x, y, attack, dodge}) {
  return alphabet[(x + 1) + 3 * (y + 1) + 9 * Number(!!attack) + 18 * Number(!!dodge)];
}

export function decodeInput(character) {
  const value = alphabet.indexOf(character);
  return {x: value % 3 - 1, y: Math.floor(value / 3) % 3 - 1,
    attack: Math.floor(value / 9) % 2 === 1, dodge: value >= 18};
}

function matches(trace, best) {
  return typeof trace === 'string' && trace.length > 0 &&
    Math.round(trace.length * 100 / 60) === best && !/[^0-9a-z]/.test(trace);
}

export function rememberReplay(trace, best) {
  if (!matches(trace, best)) return;
  tabTrace = trace;
  try { localStorage.setItem(storageKey, trace); } catch { /* The replay remains available in this tab. */ }
}

export function bestReplay(best) {
  if (matches(tabTrace, best)) return tabTrace;
  try {
    const saved = localStorage.getItem(storageKey);
    if (matches(saved, best)) return saved;
  } catch { /* Storage can be unavailable or full. */ }
  return '';
}

export function forgetReplay(trace) {
  if (tabTrace === trace) tabTrace = '';
  try {
    if (localStorage.getItem(storageKey) === trace) localStorage.removeItem(storageKey);
  } catch { /* An unavailable storage backend needs no cleanup. */ }
}
