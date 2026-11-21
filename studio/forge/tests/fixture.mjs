// Synthetic second project for the forge: its own pack, palette, profile and green-key sheet.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createImage, cellRect } from '../index.mjs';
import { fileURLToPath } from 'node:url';

export const forgeDir = fileURLToPath(new URL('../', import.meta.url));
const real = JSON.parse(await fs.readFile(new URL('../../../studio.project.json', import.meta.url), 'utf8'));

export const palette = {
  name: 'second-eight', outline: '#101820',
  colors: [['edge', '#101820'], ['moss', '#2e5a3a'], ['leaf', '#5fa05b'], ['sand', '#d9c27a'], ['clay', '#a8543a'],
    ['rose', '#e0788a'], ['sky', '#4a8fd6'], ['mark', '#ffe066']].map(([id, hex]) => ({id, hex})),
};
export const profile = {native_px: [48, 40], pivot_px: [24, 34], directions: ['front', 'side', 'back']};

/** Write a pack, palette and design manifest for another project into a fresh temp dir. */
export async function makeProject() {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'forge-second-'));
  const pack = structuredClone(real);
  pack.id = 'second-game'; pack.name = 'Second Game';
  pack.palette.file = 'pal.json';
  pack.catalog.sources = [{id: 'main', kind: 'design-manifest', file: 'design.json'}];
  pack.editable = {overlay: 'approved.json', groups: []};
  pack.rules.outline = {mode: 'silhouette', color: 'palette', borderIsEdge: false};
  await fs.writeFile(path.join(dir, 'studio.project.json'), JSON.stringify(pack));
  await fs.writeFile(path.join(dir, 'pal.json'), JSON.stringify(palette));
  await fs.writeFile(path.join(dir, 'design.json'), JSON.stringify({profiles: {critter: profile}, assets: []}));
  return dir;
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));

/**
 * Draw a figure on a template image inside the given layout cell: a body block with a head, two feet
 * touching groundY, an optional bright mark on the head and a one-pixel blended fringe, like a
 * generated drawing's anti-aliased edge. Returns the figure's pixel box for assertions.
 */
export function drawFigure(img, layout, cellId, {width, height, body, head, mark, key = layout.key.rgb}) {
  const cell = layout.cells.find(c => c.id === cellId);
  const [x0, y0, x1, y1] = cellRect(cell, img.width, img.height);
  const ground = y0 + Math.round((y1 - y0) * layout.ground.fraction);
  const cx = x0 + Math.round((layout.landmarkBasis === 'cell_width' ? x1 - x0 : y1 - y0) * cell.landmarks.centerX);
  const put = (x, y, rgb) => img.data.set([...rgb, 255], (y * img.width + x) * 4);
  const left = cx - Math.floor(width / 2), top = ground - height;
  for (let y = top; y < ground; y++) for (let x = left; x < left + width; x++) {
    const edge = x === left || x === left + width - 1 || y === top;
    const feetGap = y >= ground - Math.round(height * 0.15) && Math.abs(x - cx) < width * 0.12;
    if (feetGap) continue;
    put(x, y, edge ? mix(body, key, 0.35) : body);
  }
  const hs = Math.round(width * 0.5);
  for (let y = top - hs; y < top; y++) for (let x = cx - hs / 2; x < cx + hs / 2; x++) put(Math.round(x), y, head);
  if (mark) for (let y = top - hs + 4; y < top - hs + 4 + 40; y++) for (let x = cx - 20; x < cx + 20; x++) put(x, y, mark);
  return [left, top - hs, left + width, ground];
}
