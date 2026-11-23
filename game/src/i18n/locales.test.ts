import { describe, expect, it } from 'vitest';
import { ALL_TABLES, CONTENT_TABLES, createI18n, LOCALES, localeFrom, resolveLocale, UI_TABLES } from './locales.ts';
import { missingChars } from '../ui/pixel-font.ts';

const keys = (t: Record<string, string>): string[] => Object.keys(t).sort();
const ph = (s: string): string => (s.match(/\{\w+\}/g) ?? []).sort().join();

describe('E8.2 locales', () => {
  it('content names have the same keys in vi and en, none empty', () => {
    expect(keys(CONTENT_TABLES.vi)).toEqual(keys(CONTENT_TABLES.en));
    for (const l of LOCALES) for (const [k, v] of Object.entries(CONTENT_TABLES[l])) expect(v.trim(), `${l}:${k}`).not.toBe('');
  });
  it('a key present in both files has the same value, so "UI wins" hides nothing', () => {
    for (const l of LOCALES) for (const k of Object.keys(UI_TABLES[l])) if (k in CONTENT_TABLES[l]) expect(UI_TABLES[l][k], `${l}:${k}`).toBe(CONTENT_TABLES[l][k]);
  });
  it('the merged tables have identical keys and placeholders in both languages', () => {
    expect(keys(ALL_TABLES.vi)).toEqual(keys(ALL_TABLES.en));
    for (const k of Object.keys(ALL_TABLES.vi)) expect(ph(ALL_TABLES.vi[k]!), k).toBe(ph(ALL_TABLES.en[k]!));
  });
  it('every Vietnamese string can be drawn by the pixel font (content names are HUD text too)', () => {
    for (const [k, v] of Object.entries(ALL_TABLES.vi)) expect(missingChars(v.replace(/\{\w+\}/g, "")), k).toEqual([]);
  });
  it('picks a language: saved choice first, then the browser, Vietnamese by default', () => {
    expect(localeFrom('en-GB')).toBe('en'); expect(localeFrom('fr')).toBe('vi'); expect(localeFrom(undefined)).toBe('vi');
    expect(resolveLocale('en', 'vi-VN')).toBe('en'); expect(resolveLocale('xx', 'en-US')).toBe('en'); expect(resolveLocale(null, null)).toBe('vi');
  });
  it('translates and falls back to English, then to the key in brackets', () => {
    const i = createI18n('vi');
    expect(i.t('boss_ghost_king')).toBe('Oán Hồn Quỷ Vương');
    i.locale = 'en';
    expect(i.t('boss_ghost_king')).toBe('Soul-Devouring Ghost King');
    expect(i.t('nope.key')).toBe('[nope.key]');
  });
});
