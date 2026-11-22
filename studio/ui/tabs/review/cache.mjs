// A small async cache for the Review routes. Three rules, all about not making a person wait twice:
//   1. Concurrent callers share one load (a slow poll never starts a second copy of the same work).
//   2. A value older than `ttlMs` but younger than `staleMs` is handed out at once while one background load replaces it.
//   3. A failed load is never kept; a later call tries again (a stale value survives a failed background refresh until `staleMs`).
// `version(key)` counts completed loads, so a caller can tell whether the value changed since it last looked.
export function createCache({ttlMs, staleMs = ttlMs * 4, now = Date.now} = {}) {
  const entries = new Map();

  function entryOf(key) {
    let e = entries.get(key);
    if (!e) entries.set(key, e = {has: false, value: undefined, at: 0, version: 0, pending: null});
    return e;
  }

  function load(key, e, loader) {
    e.pending = Promise.resolve().then(loader).then(value => {
      e.value = value; e.has = true; e.at = now(); e.version++; e.pending = null; return value;
    }, error => {
      e.pending = null;
      if (!e.has) entries.delete(key);
      throw error;
    });
    return e.pending;
  }

  return {
    get(key, loader) {
      const e = entryOf(key);
      const age = now() - e.at;
      if (e.has && age < ttlMs) return Promise.resolve(e.value);
      const pending = e.pending ?? load(key, e, loader);
      if (e.has && age < staleMs) { pending.catch(() => {}); return Promise.resolve(e.value); }
      return pending;
    },
    version(key) { return entries.get(key)?.version ?? 0; },
    clear() { entries.clear(); }
  };
}
