import { describe, expect, it } from 'vitest';
import { createUiI18n, uiTables } from './strings.ts';

describe('ui strings', () => {
  it('vi and en have exactly the same keys, none empty', () => {
    expect(Object.keys(uiTables.en).sort()).toEqual(Object.keys(uiTables.vi).sort());
    for (const t of [uiTables.vi, uiTables.en]) for (const v of Object.values(t)) expect(v.trim()).not.toBe('');
  });
  it('picks English for en-*, Vietnamese otherwise', () => {
    expect(createUiI18n('en-US').t('ui.dodge')).toBe('Dodge');
    expect(createUiI18n('vi-VN').t('ui.dodge')).toBe('Né');
    expect(createUiI18n(undefined).locale).toBe('vi');
  });
  it('keeps Vietnamese diacritics intact', () => { expect(uiTables.vi['ui.rotate.title']).toBe('Xoay ngang thiết bị'); });
});

describe('placeholders', () => {
  it('fmt fills {name} and keeps unknown ones visible', () => {
    const i = createUiI18n('en');
    expect(i.fmt('abode.chest.count', { stone: 4, pill: 1, blank: 2 })).toBe('Store: 4 spirit stones, pills 1, blanks 2.');
    expect(i.fmt('abode.chest.count', { stone: 4 })).toContain('{pill}');
  });
  it('vi and en use the same placeholders in every string', () => {
    const ph = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of Object.keys(uiTables.vi)) expect(ph(uiTables.vi[k as keyof typeof uiTables.vi]), k).toBe(ph(uiTables.en[k as keyof typeof uiTables.en]));
  });
});
