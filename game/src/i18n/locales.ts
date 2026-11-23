// The whole string set: UI strings (game/locale, lane C) + content names (game/content/locale, lane B), VI and EN only.
// Owner decision 2026-11-23: no IP switch, canon names stay. Where a key exists in both files the UI file wins, and a test
// requires the two values to be equal so the rule never hides a mismatch.
import { I18n } from './i18n.ts';
import type { Locale, Strings } from './i18n.ts';
import uiEn from '../../locale/en.json';
import uiVi from '../../locale/vi.json';
import contentEn from '../../content/locale/en.json';
import contentVi from '../../content/locale/vi.json';

export const UI_TABLES: Record<Locale, Strings> = { vi: uiVi, en: uiEn };
export const CONTENT_TABLES: Record<Locale, Strings> = { vi: contentVi, en: contentEn };
export const ALL_TABLES: Record<Locale, Strings> = {
  vi: { ...contentVi, ...uiVi },
  en: { ...contentEn, ...uiEn },
};
export const LOCALES: readonly Locale[] = ['vi', 'en'];

/** `en`, `en-US`... give English; anything else, or nothing, gives Vietnamese (the default of the game). */
export const localeFrom = (tag: string | null | undefined): Locale => (tag?.toLowerCase().startsWith('en') ? 'en' : 'vi');

/** A saved choice (profile.settings.locale) beats the browser language. */
export function resolveLocale(saved: string | null | undefined, browser: string | null | undefined): Locale {
  return saved === 'vi' || saved === 'en' ? saved : localeFrom(browser);
}

export const createI18n = (locale: Locale): I18n => new I18n(ALL_TABLES, locale);

/** Switch language on an existing instance (menus keep their reference). */
export function setLocale(i18n: I18n, locale: Locale): void {
  i18n.locale = locale;
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}
