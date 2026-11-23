// UI strings (lane C). Separate from game/content/locale (content names, lane B). Canon names stay as they are:
// owner decision 2026-11-23, no IP switch. A test checks that vi and en have the same keys.
import { I18n } from '../i18n/i18n.ts';
import type { Locale } from '../i18n/i18n.ts';
import en from '../../locale/en.json';
import vi from '../../locale/vi.json';

export const uiTables = { vi, en } as const;

export function createUiI18n(preferred: string | undefined): I18n {
  const locale: Locale = preferred?.toLowerCase().startsWith('en') ? 'en' : 'vi';
  return new I18n(uiTables, locale);
}
