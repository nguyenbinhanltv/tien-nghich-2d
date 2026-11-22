// A frame as text: one character per pixel, one line per pixel row. The read form of studio_frame_read and the
// write form of studio_frame_patch share this module, so what an agent reads is what it can write back.
//
//   .  transparent        ?  opaque pixel whose colour is not in the palette        ~  partly transparent pixel
//   any other character is one palette colour. The character of a colour is fixed by its place in the project
//   palette, so the same id is the same character in every frame, every call and every asset.
import { framePath } from '../../core/assets.mjs';
import { readInside } from '../../core/files.mjs';
import { sha256 } from '../../core/fsutil.mjs';
import { headPng } from '../../core/revisions.mjs';
import { ToolError } from '../registry.mjs';
import { decode } from './patch.mjs';

export const TRANSPARENT = '.', OFF_PALETTE = '?', PARTIAL = '~';
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=@^';
const RESERVED = new Set([TRANSPARENT, OFF_PALETTE, PARTIAL, ' ']);

const hexInt = (hex) => parseInt(hex.slice(1), 16);

/** Character tables for a project palette file ({colors: [{id, hex}]}). */
export function glyphTable(paletteFile) {
  const colors = paletteFile.colors;
  if (colors.length > ALPHABET.length) throw new ToolError(`the palette has ${colors.length} colours; the text form has characters for ${ALPHABET.length}.`);
  const charOf = new Map(), idOf = new Map(), hexOf = new Map(), idOfInt = new Map();
  colors.forEach((c, i) => {
    charOf.set(c.id, ALPHABET[i]); idOf.set(ALPHABET[i], c.id); hexOf.set(c.id, c.hex.toLowerCase()); idOfInt.set(hexInt(c.hex), c.id);
  });
  return { charOf, idOf, hexOf, idOfInt };
}

/**
 * Read a region of an image as rows. Returns {rows, present: Map id -> pixels, off: {pixels, colors: [{hex, pixels}]}, partial}.
 * region {x, y, w, h}; counts cover the region only.
 */
export function imageToRows(image, table, region) {
  const { x, y, w, h } = region;
  const rows = [], present = new Map(), offColors = new Map();
  let offPixels = 0, partial = 0;
  for (let py = y; py < y + h; py++) {
    let line = '';
    for (let px = x; px < x + w; px++) {
      const k = (py * image.width + px) * 4, a = image.pixels[k + 3];
      if (a === 0) { line += TRANSPARENT; continue; }
      if (a !== 255) { line += PARTIAL; partial++; continue; }
      const id = table.idOfInt.get((image.pixels[k] << 16) | (image.pixels[k + 1] << 8) | image.pixels[k + 2]);
      if (id === undefined) {
        line += OFF_PALETTE; offPixels++;
        const hex = `#${((image.pixels[k] << 16) | (image.pixels[k + 1] << 8) | image.pixels[k + 2]).toString(16).padStart(6, '0')}`;
        offColors.set(hex, (offColors.get(hex) ?? 0) + 1);
        continue;
      }
      line += table.charOf.get(id);
      present.set(id, (present.get(id) ?? 0) + 1);
    }
    rows.push(line);
  }
  return {
    rows, present, partial,
    off: { pixels: offPixels, colors: [...offColors].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 8).map(([hex, pixels]) => ({ hex, pixels })) },
  };
}

/** Legend entries for the colours that occur: [{char, id, hex, pixels}] in palette order. */
export function legendOf(present, table) {
  return [...table.charOf.keys()].filter((id) => present.has(id)).map((id) => ({ char: table.charOf.get(id), id, hex: table.hexOf.get(id), pixels: present.get(id) }));
}

/**
 * The current pixels of a frame as the tools see them: the newest revision when the frame has a history, else the
 * file. Returns null when the frame has no file at the stage. hash identifies exactly these pixels.
 */
export async function currentFrame(ws, asset, addr, stage) {
  const rel = framePath(asset, stage, addr.clip, addr.direction, addr.n);
  const bytes = rel ? await readInside(ws.root, rel).catch(() => null) : null;
  if (!bytes) return null;
  const key = asset.layout.keyOf(addr.clip, addr.direction, addr.n);
  const head = await headPng(ws, key, bytes);
  const png = head ?? bytes;
  return { image: decode(png), hash: sha256(png), revisioned: head !== null, rel };
}

/** Does `region` {x, y, w, h} fit a width x height frame? Returns the region or throws. */
export function checkRegion(region, width, height) {
  const { x, y, w, h } = region;
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || x < 0 || y < 0 || x + w > width || y + h > height) {
    throw new ToolError(`region ${JSON.stringify(region)} must be integers with w, h at least 1, inside the ${width}x${height} frame (x + w <= ${width}, y + h <= ${height}).`);
  }
  return region;
}

/**
 * Text rows plus a legend, to a frame's pixel changes. The rows are the WHOLE region: '.' makes a pixel
 * transparent, a legend character paints it, '?' or '~' keep a pixel that already is off-palette or partly transparent.
 * Returns {ops: [set op] | [], changes: [{x, y, from, to}], width, height}; changes use ids, '.' and '?'.
 * Refuses unknown characters, colours outside the palette and rows that do not form a rectangle inside the frame.
 */
export function rowsToChanges({ rows, legend, at = [0, 0], image, table, label }) {
  if (!Array.isArray(rows) || !rows.length || rows.some((r) => typeof r !== 'string')) throw new ToolError(`${label}: rows must be a list of strings, one per pixel row.`);
  const lines = rows.map((r) => [...r]);
  const w = lines[0].length;
  const ragged = lines.findIndex((l) => l.length !== w);
  if (!w || ragged >= 0) throw new ToolError(`${label}: every row must have the same width (row ${ragged < 0 ? 0 : ragged} has ${lines[ragged < 0 ? 0 : ragged].length}, row 0 has ${w}).`);
  checkRegion({ x: at[0], y: at[1], w, h: lines.length }, image.width, image.height);
  const map = new Map();
  for (const [ch, id] of Object.entries(legend ?? {})) {
    if ([...ch].length !== 1 || RESERVED.has(ch)) throw new ToolError(`${label}: legend key "${ch}" must be one character other than . ? ~ and space ('.' is always transparent).`);
    if (!table.hexOf.has(id)) throw new ToolError(`${label}: legend maps "${ch}" to "${id}", which is not a colour of the project palette (studio_project_info lists them).`);
    map.set(ch, id);
  }
  const changes = [], pixels = [];
  lines.forEach((line, dy) => line.forEach((ch, dx) => {
    const x = at[0] + dx, y = at[1] + dy, k = (y * image.width + x) * 4, a = image.pixels[k + 3];
    const now = a === 0 ? TRANSPARENT : a !== 255 ? PARTIAL
      : (table.idOfInt.get((image.pixels[k] << 16) | (image.pixels[k + 1] << 8) | image.pixels[k + 2]) ?? OFF_PALETTE);
    if (ch === OFF_PALETTE || ch === PARTIAL) {
      if ((ch === OFF_PALETTE && now !== OFF_PALETTE) || (ch === PARTIAL && now !== PARTIAL)) {
        throw new ToolError(`${label}: "${ch}" at (${x}, ${y}) marks a ${ch === OFF_PALETTE ? 'colour outside the palette' : 'partly transparent pixel'}, but that pixel is not one. Write a palette character or '.'.`);
      }
      return; // keep the pixel as it is
    }
    let to;
    if (ch === TRANSPARENT) to = null;
    else if (map.has(ch)) to = map.get(ch);
    else throw new ToolError(`${label}: row ${dy} column ${dx} uses "${ch}", which the legend does not define ('.' is transparent). Add it to legend as {"${ch}": "<palette id>"}.`);
    if ((to ?? TRANSPARENT) === now) return;
    pixels.push([x, y, to]);
    changes.push({ x, y, from: now, to: to ?? TRANSPARENT });
  }));
  return { ops: pixels.length ? [{ op: 'set', pixels }] : [], changes, width: w, height: lines.length };
}

/** Pixel-by-pixel difference of two same-size images: {count, changes: [{x, y, from, to}], truncated}; from and to are ids, '.', '?' or '~'. */
export function diffImages(before, after, table, cap = 400) {
  const at = (img, k) => {
    const a = img.pixels[k + 3];
    if (a === 0) return TRANSPARENT;
    if (a !== 255) return PARTIAL;
    return table.idOfInt.get((img.pixels[k] << 16) | (img.pixels[k + 1] << 8) | img.pixels[k + 2]) ?? OFF_PALETTE;
  };
  const changes = [];
  let count = 0;
  for (let y = 0; y < after.height; y++) for (let x = 0; x < after.width; x++) {
    const k = (y * after.width + x) * 4;
    const from = at(before, k), to = at(after, k);
    if (from === to && before.pixels.compare(after.pixels, k, k + 4, k, k + 4) === 0) continue;
    count++;
    if (changes.length < cap) changes.push({ x, y, from, to });
  }
  return { count, changes, truncated: count > changes.length };
}
