// Player settings (E8.3): volumes, shake, flash, language and key bindings. Pure parsing and rebinding so it is unit-tested;
// storage is injected (localStorage in the browser). Anything missing or out of range in saved data falls back per field, so a
// damaged or older save never breaks start-up.
export type Action = 'up' | 'down' | 'left' | 'right' | 'dash' | 'counter' | 'pause';
export const ACTIONS: readonly Action[] = ['up', 'down', 'left', 'right', 'dash', 'counter', 'pause'];
export type Bindings = Record<Action, string[]>;
export type LocalePref = 'auto' | 'vi' | 'en';

export interface Settings { v: 1; master: number; music: number; sfx: number; shake: number; flash: boolean; locale: LocalePref; bindings: Bindings }

export const DEFAULT_BINDINGS: Bindings = {
  up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  dash: ['Space', 'ShiftLeft'], counter: ['KeyJ', 'Enter'], pause: ['Escape', 'KeyP'],
};
export const DEFAULT_SETTINGS: Settings = { v: 1, master: 1, music: 0.7, sfx: 1, shake: 1, flash: true, locale: 'auto', bindings: DEFAULT_BINDINGS };
export const STORAGE_KEY = 'tn2d.settings.v1';
/** Keys that can never be bound to game actions (the browser or the menu owns them). */
const FORBIDDEN = new Set(['Tab', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const clone = (b: Bindings): Bindings => Object.fromEntries(ACTIONS.map((a) => [a, [...b[a]]])) as Bindings;

export function parseSettings(raw: unknown): Settings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bindings = clone(DEFAULT_BINDINGS);
  const rb = (typeof o['bindings'] === 'object' && o['bindings'] !== null ? o['bindings'] : {}) as Record<string, unknown>;
  for (const a of ACTIONS) {
    const v = rb[a];
    if (Array.isArray(v)) {
      const codes = v.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length < 24 && !FORBIDDEN.has(c)).slice(0, 2);
      if (codes.length) bindings[a] = codes;
    }
  }
  // two actions must never share a key: a duplicate in saved data keeps the first action and restores the later one's default
  const seen = new Map<string, Action>();
  for (const a of ACTIONS) {
    for (const c of bindings[a]) if (seen.has(c)) { bindings[a] = [...DEFAULT_BINDINGS[a]].filter((d) => !seen.has(d)); break; }
    for (const c of bindings[a]) seen.set(c, a);
  }
  const locale = o['locale'] === 'vi' || o['locale'] === 'en' ? o['locale'] : 'auto';
  return { v: 1, master: num(o['master'], DEFAULT_SETTINGS.master), music: num(o['music'], DEFAULT_SETTINGS.music), sfx: num(o['sfx'], DEFAULT_SETTINGS.sfx), shake: num(o['shake'], DEFAULT_SETTINGS.shake), flash: typeof o['flash'] === 'boolean' ? o['flash'] : true, locale, bindings };
}

export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }
export function loadSettings(store: KeyValueStore | null): Settings {
  try { const s = store?.getItem(STORAGE_KEY); return parseSettings(s ? JSON.parse(s) : null); } catch { return parseSettings(null); }
}
export function saveSettings(store: KeyValueStore | null, s: Settings): void {
  try { store?.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* private mode or full: settings last for this session only */ }
}

/**
 * Bind `code` to `action` as its primary key (the previous primary becomes the secondary, at most two). A code already used by
 * another action is taken from it; if that leaves the other action with no key it gets its first default that is still free.
 * Returns the new bindings, or null when the key is not allowed.
 */
export function rebind(b: Bindings, action: Action, code: string): Bindings | null {
  if (FORBIDDEN.has(code) || code.length === 0) return null;
  if (code === 'Escape' && action !== 'pause') return null; // Escape always opens the menu
  const next = clone(b);
  for (const a of ACTIONS) if (a !== action) next[a] = next[a].filter((c) => c !== code);
  next[action] = [code, ...next[action].filter((c) => c !== code)].slice(0, 2);
  const used = new Set(ACTIONS.flatMap((a) => next[a]));
  for (const a of ACTIONS) if (next[a].length === 0) {
    const d = DEFAULT_BINDINGS[a].find((c) => !used.has(c));
    if (d) { next[a] = [d]; used.add(d); }
  }
  return ACTIONS.every((a) => next[a].length > 0) ? next : null;
}

/** "KeyW" -> "W", "ArrowUp" -> "↑", "Space" -> "Space". */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const m: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'Shift', ShiftRight: 'Shift', Escape: 'Esc' };
  return m[code] ?? code;
}
