// Side-by-side comparison of frame sets (a bake directory, or any directory of <clip>_<facing>_<n>.png), so a trial
// needs no helper script: one contact sheet, one row per clip and facing, one block of keys per set.
import fs from 'node:fs/promises';
import path from 'node:path';
import { contactSheet, createFrame, readFrame } from '../image.mjs';
import { readBakeDir, qaStage } from './index.mjs';

const frameName = /^(.+)_([a-z0-9-]+)_(\d+)\.png$/;

/** {name: frames: {"<clip>_<facing>_<n>": frame}, bake?: result} for a bake dir or a plain frame directory. */
export async function loadFrameSet(dir) {
  try { const bake = await readBakeDir(dir); return {frames: bake.frames, bake}; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const frames = {};
  for (const file of (await fs.readdir(dir)).sort()) {
    const m = frameName.exec(file);
    if (m) frames[file.slice(0, -4)] = readFrame(path.join(dir, file));
  }
  if (!Object.keys(frames).length) throw new Error(`${dir} has no <clip>_<facing>_<n>.png frames`);
  return {frames};
}

function rowsOf(frames) {
  const rows = new Map();
  for (const name of Object.keys(frames)) {
    const [, clip, facing, n] = /^(.*)_([^_]+)_(\d+)$/.exec(name);
    const key = `${clip}\0${facing}`;
    rows.set(key, Math.max(rows.get(key) ?? 0, Number(n) + 1));
  }
  return rows;
}

/**
 * Compare sets ({name: dir}). Returns {sheet, rows: [{clip, facing, keys: {set: count}}], sets: {set: {frames, gates?}}}.
 * With `gates` ({settings, palette, rig?, poseRig?, options?}) each set that is a bake directory is also run through the gates
 * and summarised as findings per gate and severity.
 */
export async function compareSets(dirs, {scale = 4, gates} = {}) {
  const loaded = {};
  for (const [name, dir] of Object.entries(dirs)) loaded[name] = await loadFrameSet(dir);
  const order = new Map();
  for (const set of Object.values(loaded)) for (const [key, count] of rowsOf(set.frames)) order.set(key, Math.max(order.get(key) ?? 0, count));
  const any = Object.values(loaded)[0].frames, tile = any[Object.keys(any)[0]];
  const gap = createFrame(tile.width, tile.height);
  const rows = [], layout = [];
  for (const key of order.keys()) {
    const [clip, facing] = key.split('\0');
    const row = [], keys = {};
    Object.entries(loaded).forEach(([name, set], index) => {
      if (index) row.push(gap);
      const frames = Object.keys(set.frames).filter(n => n.startsWith(`${clip}_${facing}_`)).sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()));
      keys[name] = frames.length;
      row.push(...frames.map(n => set.frames[n]));
    });
    rows.push(row); layout.push({clip, facing, keys});
  }
  const sets = {};
  for (const [name, set] of Object.entries(loaded)) {
    sets[name] = {frames: Object.keys(set.frames).length};
    if (gates && set.bake) {
      const result = qaStage(set.bake, gates);
      const by = {};
      for (const f of result.findings) by[`${f.gate}:${f.severity}`] = (by[`${f.gate}:${f.severity}`] ?? 0) + 1;
      sets[name].gates = {pass: result.pass, findings: by};
    }
  }
  return {sheet: contactSheet(rows, {scale}), rows: layout, sets};
}
