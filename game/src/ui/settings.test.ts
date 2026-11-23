import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_BINDINGS, DEFAULT_SETTINGS, keyLabel, loadSettings, parseSettings, rebind, saveSettings, STORAGE_KEY } from './settings.ts';
import type { KeyValueStore } from './settings.ts';

const mem = (): KeyValueStore & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }; };

describe('parseSettings', () => {
  it('garbage gives the defaults, per field', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
    const s = parseSettings({ master: 5, music: -1, sfx: 'loud', shake: 0.25, flash: 'yes', locale: 'fr' });
    expect(s).toMatchObject({ master: 1, music: 0, sfx: 1, shake: 0.25, flash: true, locale: 'auto' });
  });
  it('drops forbidden or malformed key codes and caps at two per action', () => {
    const s = parseSettings({ bindings: { dash: ['Tab', 'KeyK', 'KeyL', 'KeyM'], up: [], left: 7 } });
    expect(s.bindings.dash).toEqual(['KeyK', 'KeyL']);
    expect(s.bindings.up).toEqual(DEFAULT_BINDINGS.up);
    expect(s.bindings.left).toEqual(DEFAULT_BINDINGS.left);
  });
  it('a key shared by two actions in saved data is not kept twice', () => {
    const s = parseSettings({ bindings: { dash: ['KeyJ'], counter: ['KeyJ'] } });
    const all = ACTIONS.flatMap((a) => s.bindings[a]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('storage', () => {
  it('round-trips and survives broken JSON or a missing store', () => {
    const st = mem();
    saveSettings(st, { ...DEFAULT_SETTINGS, music: 0.2, flash: false });
    expect(loadSettings(st)).toMatchObject({ music: 0.2, flash: false });
    st.data.set(STORAGE_KEY, '{not json');
    expect(loadSettings(st)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(null, DEFAULT_SETTINGS)).not.toThrow();
  });
});

describe('rebind', () => {
  it('makes the new key primary and keeps the old primary as secondary', () => {
    const b = rebind(DEFAULT_BINDINGS, 'dash', 'KeyK')!;
    expect(b.dash).toEqual(['KeyK', 'Space']);
  });
  it('takes a key from another action and never leaves an action without a key', () => {
    const b = rebind({ ...DEFAULT_BINDINGS, counter: ['KeyJ'] }, 'dash', 'KeyJ')!;
    expect(b.dash[0]).toBe('KeyJ');
    expect(b.counter.length).toBeGreaterThan(0);
    for (const a of ACTIONS) expect(b[a].length).toBeGreaterThan(0);
    const all = ACTIONS.flatMap((a) => b[a]);
    expect(new Set(all).size).toBe(all.length);
  });
  it('refuses Tab and Escape (except for pause), and does not mutate the input', () => {
    const before = JSON.stringify(DEFAULT_BINDINGS);
    expect(rebind(DEFAULT_BINDINGS, 'dash', 'Tab')).toBeNull();
    expect(rebind(DEFAULT_BINDINGS, 'dash', 'Escape')).toBeNull();
    expect(rebind(DEFAULT_BINDINGS, 'pause', 'Escape')).not.toBeNull();
    expect(JSON.stringify(DEFAULT_BINDINGS)).toBe(before);
  });
});

describe('keyLabel', () => { it('shows short labels', () => { expect(keyLabel('KeyW')).toBe('W'); expect(keyLabel('ArrowUp')).toBe('↑'); expect(keyLabel('Space')).toBe('Space'); }); });
