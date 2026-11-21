// Everything project-specific the pixeliser needs, read from the project pack and the files it names:
// the palette, the outline rule and the size and pivot of a profile. Nothing is defaulted from code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { hexToRgb, rgbToHex } from '../image.mjs';

/** {colors: [{id, hex}], outline: "#rrggbb", outline_id?} -> ordered colours with rgb triples. */
export function parsePaletteColors(data) {
  const colors = data.colors.map((c, i) => ({id: c.id ?? `c${i}`, hex: c.hex.toLowerCase(), rgb: hexToRgb(c.hex)}));
  if (!colors.length) throw new Error('palette has no colours');
  const outlineHex = (data.outline ?? (data.outline_id && colors.find(c => c.id === data.outline_id)?.hex))?.toLowerCase();
  const outline = outlineHex ? {id: colors.find(c => c.hex === outlineHex)?.id ?? null, hex: outlineHex, rgb: hexToRgb(outlineHex)} : null;
  return {name: data.name ?? null, colors, outline};
}

function profileFrom(name, raw) {
  const nativePx = raw?.native_px, pivotPx = raw?.pivot_px;
  const pair = v => Array.isArray(v) && v.length === 2 && v.every(n => Number.isInteger(n) && n > 0);
  if (!pair(nativePx) || !pair(pivotPx)) throw new Error(`profile "${name}" needs native_px and pivot_px as [x, y] integers`);
  if (pivotPx[0] >= nativePx[0] || pivotPx[1] >= nativePx[1]) throw new Error(`profile "${name}": pivot ${pivotPx} lies outside ${nativePx}`);
  return {name, nativePx, pivotPx, directions: raw.directions ?? null, clips: raw.clips ?? null};
}

/**
 * Resolve forge settings for one profile from a loaded pack (see studio/core loadPack) and its root.
 * The profile is looked up in the pack's design-manifest sources ("profiles"). Pass `profile` as an
 * object {nativePx, pivotPx} instead of a name to bypass the lookup (tests, one-off tools).
 */
export async function settingsFromPack(pack, root, profile) {
  const paletteData = JSON.parse(await fs.readFile(path.join(root, pack.palette.file), 'utf8'));
  const palette = parsePaletteColors(paletteData);
  const rule = pack.rules.outline;
  let outline = null;
  if (rule.mode !== 'none') {
    outline = rule.color === 'palette' ? palette.outline : {id: null, hex: rule.color.toLowerCase(), rgb: hexToRgb(rule.color)};
    if (!outline) throw new Error('the pack asks for the palette outline colour but the palette file names none');
  }
  let resolved;
  if (typeof profile === 'object') resolved = profileFrom(profile.name ?? 'custom', {native_px: profile.nativePx, pivot_px: profile.pivotPx, directions: profile.directions});
  else {
    for (const source of pack.catalog.sources.filter(s => s.kind === 'design-manifest')) {
      const data = JSON.parse(await fs.readFile(path.join(root, source.file), 'utf8'));
      if (data.profiles?.[profile]) { resolved = profileFrom(profile, data.profiles[profile]); break; }
    }
    if (!resolved) throw new Error(`no profile "${profile}" in the pack's design manifests`);
  }
  return {palette, outline: {mode: rule.mode, color: outline?.rgb ?? null, hex: outline?.hex ?? null, borderIsEdge: rule.borderIsEdge},
    alpha: pack.rules.alpha, profile: resolved};
}

/**
 * Marks are palette colours (an id or a hex that is in the palette) kept out of ordinary snapping and preserved where the source shows them:
 * {color, minRgb: [r, g, b] (required), blueOverGreen?: n, minCoverage?: 0..1, keepOnOutline?: bool}. With `minCoverage` a native
 * pixel also becomes a mark when that share of its source footprint matched the detector at full resolution (small notches
 * that the area filter would average away); `keepOnOutline` keeps such pixels as the mark colour when the outline is rebuilt. A source pixel is a mark pixel
 * when each channel reaches minRgb and blue exceeds green by blueOverGreen (the prototype's lavender test).
 */
export function resolveMarks(marks = [], palette) {
  return marks.map(mark => {
    const key = String(mark.color).toLowerCase();
    const entry = palette.colors.find(c => c.id === mark.color || c.hex === key);
    if (!entry) throw new Error(`mark colour "${mark.color}" is not in the palette`);
    const min = mark.minRgb;
    if (!Array.isArray(min) || min.length !== 3 || !min.every(v => Number.isInteger(v) && v >= 0 && v <= 255))
      throw new Error(`mark "${mark.color}": minRgb is required and must be three 0-255 integers`);
    if (mark.blueOverGreen !== undefined && !Number.isInteger(mark.blueOverGreen)) throw new Error(`mark "${mark.color}": blueOverGreen must be an integer`);
    if (mark.minCoverage !== undefined && !(mark.minCoverage > 0 && mark.minCoverage <= 1)) throw new Error(`mark "${mark.color}": minCoverage must be in (0, 1]`);
    return {id: entry.id, hex: entry.hex, rgb: entry.rgb, minRgb: min, blueOverGreen: mark.blueOverGreen ?? -255,
      ...(mark.minCoverage !== undefined ? {minCoverage: mark.minCoverage} : {}), keepOnOutline: mark.keepOnOutline === true};
  });
}

export const describeColor = rgb => rgbToHex(rgb);
