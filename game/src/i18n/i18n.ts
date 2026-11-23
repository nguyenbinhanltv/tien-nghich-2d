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
  /** Translate and fill `{name}` placeholders. An unknown placeholder is left as written so a missing variable shows up in tests. */
  fmt(key: string, vars: Record<string, string | number> = {}): string {
    return this.t(key).replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  }
  has(key: string): boolean { return key in this.tables[this.locale] || key in this.tables.en; }
}
