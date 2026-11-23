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
