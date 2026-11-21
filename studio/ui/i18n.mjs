// Language handling: JSON string files, a persisted choice, {name} interpolation.
export const storageKey = 'studio.lang';

export function pickLanguage(supported, stored, navigatorLanguages = []) {
  if (supported.includes(stored)) return stored;
  for (const tag of navigatorLanguages) {
    const base = String(tag).toLowerCase().split('-')[0];
    if (supported.includes(base)) return base;
  }
  return supported[0];
}

export function interpolate(text, vars = {}) {
  return text.replace(/\{(\w+)\}/g, (match, name) => name in vars ? String(vars[name]) : match);
}

/** Text lookup: first scope that has the key wins, then English, then the key itself. */
export function translator(lang, tables) {
  return (key, vars) => {
    for (const table of tables) {
      const value = table[lang]?.[key] ?? table.en?.[key];
      if (typeof value === 'string') return interpolate(value, vars);
    }
    return key;
  };
}

/** Pick a localised label {en, vi}: current language, then English, then any value. */
export function localize(label, lang) {
  if (typeof label === 'string') return label;
  return label?.[lang] ?? label?.en ?? Object.values(label ?? {})[0] ?? '';
}

export async function loadTable(fetchJson, base, languages) {
  const table = {};
  for (const lang of languages) {
    try { table[lang] = await fetchJson(`${base}/${lang}.json`); }
    catch { table[lang] = {}; }
  }
  return table;
}
