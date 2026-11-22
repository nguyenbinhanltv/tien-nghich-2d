// Shared by the tools that run a registered program (studio_generator_run, studio_vfx_build): collect the
// PNG frames it wrote, with limits, and run the same program twice to check that it is deterministic.
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../../core/fsutil.mjs';
import { decodePng } from '../../forge/index.mjs';
import { ToolError } from '../registry.mjs';
import { parseFrameName } from './forge.mjs';

export const MAX_FILES = 128, MAX_FILE_BYTES = 96 * 1024, MAX_TOTAL_BYTES = 8 * 1024 * 1024;

/** PNG files directly in `dir` (one level), named or not. Returns {files: [{name, bytes, sha256}], skipped: [string]}. */
export async function harvestPngs(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return { files: [], skipped: [] }; throw error; }
  const files = [], skipped = [];
  let total = 0;
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isFile() || !e.name.endsWith('.png')) { skipped.push(`${e.name} (not a PNG file)`); continue; }
    const abs = path.join(dir, e.name);
    const { size } = await fs.stat(abs);
    if (size > MAX_FILE_BYTES) throw new ToolError(`${e.name} is ${size} bytes; a frame is limited to ${MAX_FILE_BYTES}.`);
    total += size;
    if (files.length >= MAX_FILES || total > MAX_TOTAL_BYTES) throw new ToolError(`the program wrote more than ${MAX_FILES} frames or ${MAX_TOTAL_BYTES} bytes; refusing it.`);
    const bytes = await fs.readFile(abs);
    files.push({ name: e.name.slice(0, -4), bytes, sha256: sha256(bytes) });
  }
  return { files, skipped };
}

/** Decode harvested files that are named like frames. Returns {frames: {name: image}, unmapped: [{name, reason}]}. */
export function framesOf(files) {
  const frames = {}, unmapped = [];
  for (const f of files) {
    if (!parseFrameName(f.name)) { unmapped.push({ name: f.name, reason: 'not named <clip>_<direction>_<n>' }); continue; }
    try { frames[f.name] = decodePng(f.bytes); }
    catch (error) { unmapped.push({ name: f.name, reason: `not a readable PNG: ${error.message}` }); }
  }
  return { frames, unmapped };
}

/** Same names and same bytes in two harvests? */
export function sameOutput(a, b) {
  return a.length === b.length && a.every((f, i) => f.name === b[i].name && f.sha256 === b[i].sha256);
}
