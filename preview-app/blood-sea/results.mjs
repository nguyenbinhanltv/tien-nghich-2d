// Store only the fastest active fight time for this encounter ruleset.
const bestKey = 'tien-nghich.blood-sea.best-centiseconds.v1';
let sessionBest = null;

export function fightClock(centiseconds) {
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return minutes + ':' + String(seconds).padStart(2, '0') + '.' + String(centiseconds % 100).padStart(2, '0');
}

export function bestTime() {
  let previous = sessionBest;
  try {
    const stored = Number(localStorage.getItem(bestKey));
    if (Number.isSafeInteger(stored) && stored > 0)
      previous = Math.min(previous ?? stored, stored);
  } catch { /* Browser storage may be disabled. The tab still remembers its best. */ }
  return previous;
}

export function finishFight(state) {
  const current = Math.max(1, Math.round(state.elapsed * 100));
  const previous = bestTime();
  const record = state.mode === 'won' && (previous === null || current < previous);
  sessionBest = record ? current : previous;
  if (record) {
    try { localStorage.setItem(bestKey, String(current)); } catch { /* In-memory result remains usable. */ }
  }
  return {current, best: sessionBest, record, first: record && previous === null};
}
