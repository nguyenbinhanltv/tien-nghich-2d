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

import { DEFAULT_PAD, padButtonAllowed, padLabel, rebindPad } from './settings.ts';
describe('gamepad bindings', () => {
  it('defaults match the old fixed layout and survive garbage', () => {
    expect(parseSettings(null).padBindings).toEqual(DEFAULT_PAD);
    const s = parseSettings({ padBindings: { dash: [9, 99, 'x', 3.5, 5], counter: 'no' } });
    expect(s.padBindings.dash).toEqual([5]);
    expect(s.padBindings.counter).toEqual(DEFAULT_PAD.counter);
  });
  it('one button never serves two actions in saved data', () => {
    const s = parseSettings({ padBindings: { dash: [2], counter: [2, 7] } });
    const all = [...s.padBindings.dash, ...s.padBindings.counter];
    expect(new Set(all).size).toBe(all.length);
    expect(s.padBindings.counter.length).toBeGreaterThan(0);
  });
  it('Start, the D-pad and back/guide buttons cannot be bound', () => {
    for (const n of [9, 12, 13, 14, 15, 8, 16, -1, 17]) expect(padButtonAllowed(n), String(n)).toBe(false);
    for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 10, 11]) expect(padButtonAllowed(n), String(n)).toBe(true);
    expect(rebindPad(DEFAULT_PAD, 'dash', 9)).toBeNull();
  });
  it('rebinding makes the button primary, takes it from the other action and keeps that one usable', () => {
    const b = rebindPad(DEFAULT_PAD, 'dash', 2)!;
    expect(b.dash[0]).toBe(2);
    expect(b.counter).not.toContain(2);
    expect(b.counter.length).toBeGreaterThan(0);
    const all = [...b.dash, ...b.counter];
    expect(new Set(all).size).toBe(all.length);
    const lone = rebindPad({ dash: [0], counter: [2] }, 'dash', 2)!;
    expect(lone.counter.length).toBe(1);
    expect(lone.counter[0]).not.toBe(2);
    expect(JSON.stringify(DEFAULT_PAD)).toBe('{"dash":[0,6],"counter":[2,1,7]}');
  });
  it('labels the standard buttons', () => { expect(padLabel(0)).toBe('A'); expect(padLabel(7)).toBe('RT'); expect(padLabel(10)).toBe('L3'); });
});
