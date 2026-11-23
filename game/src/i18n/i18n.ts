// Display strings live in content/locale/{vi,en}.json, never in code (owner decision 2 of 2026-11-23:
// canon names are kept; there is no IP switch, but strings are still separated as normal i18n).
export type Locale = 'vi' | 'en';
export type Strings = Record<string, string>;

export class I18n {
  readonly tables: Record<Locale, Strings>;
  locale: Locale;
  constructor(tables: Record<Locale, Strings>, locale: Locale = 'vi') { this.tables = tables; this.locale = locale; }
  t(key: string): string {
    return this.tables[this.locale][key] ?? this.tables.en[key] ?? `[${key}]`;
  }
  has(key: string): boolean { return key in this.tables[this.locale] || key in this.tables.en; }
}
