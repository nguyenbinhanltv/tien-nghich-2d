// Interface mode and density: the choice, where it is remembered and how it reaches the page. No DOM at import time, so tests can run it.
//   mode     abode (dark, the default) | ink (high-contrast dark) | paper (light)
//   density  comfortable (the default) | compact
// The colours of a mode are roles of the project pack (ui.theme for abode, ui.themeModes.<mode>.colors for the others, resolved to hex by the server).
// A mode the pack does not declare sets no --theme-* at all, and tokens.css falls back to that mode's neutral defaults.

export const MODES = Object.freeze(['abode', 'ink', 'paper']);
export const DENSITIES = Object.freeze(['comfortable', 'compact']);
export const modeKey = 'studio.theme';
export const densityKey = 'studio.density';

const isMode = v => MODES.includes(v);
const isDensity = v => DENSITIES.includes(v);

/** The stored choice, else the system's: a light preference opens paper, anything else the abode. `prefersLight` is a boolean. */
export function pickMode(stored, prefersLight = false) {
  if (isMode(stored)) return stored;
  return prefersLight ? 'paper' : 'abode';
}
export const pickDensity = stored => (isDensity(stored) ? stored : 'comfortable');

/** True when the person has not chosen yet, so a change of the system preference should still be followed. */
export const isChosen = value => isMode(value);

export function readChoice(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}
export function writeChoice(storage, key, value) {
  try { storage.setItem(key, value); return true; } catch { return false; }   // private mode: the choice just is not remembered
}

const next = (list, value) => list[(list.indexOf(value) + 1) % list.length];
export const nextMode = mode => next(MODES, mode);
export const nextDensity = density => next(DENSITIES, density);

/** The role -> hex map to write as --theme-* for a mode. Abode is ui.theme; the others come from ui.themeModes; a missing mode is {}. */
export function modeRoles(project, mode) {
  const raw = mode === 'abode' ? project?.theme : project?.themeModes?.[mode]?.theme;
  return Object.fromEntries(Object.entries(raw ?? {}).filter(([role, hex]) => /^[A-Za-z]+$/.test(role) && /^#[0-9a-fA-F]{6}$/.test(hex ?? '')));
}

/** The label a project gives a mode (per language), or undefined. */
export function modeLabel(project, mode, lang, localize) {
  const name = project?.themeModes?.[mode]?.name;
  return name ? localize(name, lang) || undefined : undefined;
}

/**
 * Writes the mode and density to the root element: data-theme, data-density, and the pack's colours as --theme-<role>.
 * Every --theme-* written earlier is removed first, so a mode that names fewer roles never keeps the last mode's colours.
 * Returns the names written, to pass back as `previous` next time.
 */
export function applyAppearance(root, {mode, density, roles}, previous = []) {
  for (const name of previous) root.style.removeProperty(name);
  root.dataset.theme = isMode(mode) ? mode : 'abode';
  root.dataset.density = isDensity(density) ? density : 'comfortable';
  const written = [];
  for (const [role, hex] of Object.entries(roles ?? {})) { root.style.setProperty('--theme-' + role, hex); written.push('--theme-' + role); }
  return written;
}
