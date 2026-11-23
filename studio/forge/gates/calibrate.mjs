#!/usr/bin/env node
// Calibration of the drawn-clip gates on the clips that are really in the repo.
// usage: node studio/forge/gates/calibrate.mjs --project . --profile <name> [--json]
//          [--shipped <dir of <asset>/<clip>/<facing>/frame_NNN.png>] [--flat set=dir ...] [--poses set=dir:key,key,..]
//   --flat set=dir[:clip,clip] takes a directory of <clip>_<facing>_<n>.png; --poses a directory of <pose>_<facing>.png cells with the keys in clip order.
//
// It measures, per clip and facing and for every set below: the identity-drift pair numbers (worst share of the shared interior
// that changes colour, worst move of the colour mix), the A-B-A flicker count of the worst key, and the lowest opaque row against
// the profile pivot. docs/FORGE_BAKEOFF.md ("Drawn-clip gates: calibration") holds the table and the reasons for the limits;
// studio/forge/tests/calibration.test.mjs keeps the limits below the numbers it measured and the fixture sets in agreement.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openForgeProject } from '../pipeline/index.mjs';
import { readFrame } from '../image.mjs';
import { flicker } from './index.mjs';
import { identityDrift } from '../pipeline/drift.mjs';
import { groundRow } from './ground.mjs';

/** Clip frames in `<clip>_<facing>_<n>.png` files of one directory -> units. */
export function unitsFromFlatDir(dir, {loop = true, only} = {}) {
  const found = new Map();
  for (const name of fs.readdirSync(dir)) {
    const m = /^([a-z]+)_(south|west|north|east)_(\d+)\.png$/.exec(name);
    if (!m || (only && !only.includes(m[1]))) continue;
    const key = `${m[1]}/${m[2]}`;
    (found.get(key) ?? found.set(key, []).get(key)).push([Number(m[3]), path.join(dir, name)]);
  }
  return [...found].map(([key, files]) => {
    const [clip, facing] = key.split('/');
    return {clip, facing, loop, frames: files.sort((a, b) => a[0] - b[0]).map(([, f]) => readFrame(f))};
  });
}

/** Pose-sheet cells `<pose>_<facing>.png` played in the given key order -> units (one looping clip per facing). */
export function unitsFromPoseCells(dir, keys, clip = 'walk') {
  return ['south', 'west', 'north', 'east'].map(facing => ({clip, facing, loop: true, frames: keys.map(k => readFrame(path.join(dir, `${k}_${facing}.png`)))}));
}

/** Shipped clips of a directory: `<asset>/<clip>/<facing>/frame_NNN.png`, locomotion clips only, 32x32 canvases only. */
export function shippedUnits(base, clips = ['walk', 'follow', 'advance']) {
  const out = [];
  for (const asset of fs.readdirSync(base).sort()) {
    for (const clip of clips) {
      const cdir = path.join(base, asset, clip);
      if (!fs.existsSync(cdir) || !fs.statSync(cdir).isDirectory()) continue;
      for (const facing of fs.readdirSync(cdir).sort()) {
        const fdir = path.join(cdir, facing);
        if (!fs.statSync(fdir).isDirectory()) continue;
        const files = fs.readdirSync(fdir).filter(f => /^frame_\d+\.png$/.test(f)).sort();
        const frames = files.map(f => readFrame(path.join(fdir, f)));
        if (files.length >= 3 && frames.every(f => f.width === 32 && f.height === 32)) out.push({set: 'shipped', asset, clip, facing, loop: true, frames});
      }
    }
  }
  return out;
}

/** The numbers of one unit. `ink` is the palette outline colour ([r, g, b]). */
export function unitMetrics(unit, ink, pivot) {
  const palette = {outline: ink};
  const drift = identityDrift(unit, {palette}, {maxInteriorChange: null, maxColorShift: null}).metrics;
  const counts = Array(unit.frames.length).fill(0);
  for (const f of flicker(unit, {palette}, {maxPixels: 0})) counts[f.frame] = f.measured;
  const rows = unit.frames.map(groundRow);
  return {interiorChange: drift.interiorChange, colorShift: drift.colorShift, flickerWorst: Math.max(...counts), flickerTotal: counts.reduce((a, b) => a + b, 0),
    lowestRows: rows, groundSpread: Math.max(...rows) - Math.min(...rows), pivotGap: pivot ? pivot[1] - Math.max(...rows) : null};
}

const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
export function distribution(values) {
  const s = [...values].sort((a, b) => a - b);
  return {n: s.length, min: s[0] ?? null, median: quantile(s, 0.5), p90: quantile(s, 0.9), max: s[s.length - 1] ?? null};
}

/** Group units into sets and summarise each metric. */
export function summarize(rows) {
  const bySet = {};
  for (const r of rows) (bySet[r.set] ??= []).push(r);
  return Object.fromEntries(Object.entries(bySet).map(([set, list]) => [set, {
    units: list.length,
    interiorChange: distribution(list.map(r => r.interiorChange)), colorShift: distribution(list.map(r => r.colorShift)),
    flickerWorst: distribution(list.map(r => r.flickerWorst)), groundSpread: distribution(list.map(r => r.groundSpread)),
    pivotGap: distribution(list.map(r => r.pivotGap).filter(v => v !== null)),
  }]));
}

async function main() {
  const args = {}, multi = {flat: [], poses: []};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const name = argv[i].slice(2), value = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    if (multi[name]) multi[name].push(value); else args[name] = value;
  }
  const project = await openForgeProject(path.resolve(args.project === undefined || args.project === true ? '.' : args.project), args.profile);
  const ink = project.settings.outline.color, pivot = project.settings.profile.pivotPx;
  const units = [];
  if (typeof args.shipped === 'string') units.push(...shippedUnits(path.resolve(args.shipped)));
  for (const spec of multi.flat) { const [set, rest] = spec.split('='), [dir, only] = rest.split(':'); units.push(...unitsFromFlatDir(path.resolve(dir), {only: only?.split(',')}).map(u => ({set, ...u}))); }
  for (const spec of multi.poses) { const [set, rest] = spec.split('='), [dir, keys] = rest.split(':'); units.push(...unitsFromPoseCells(path.resolve(dir), keys.split(',')).map(u => ({set, ...u}))); }
  const rows = units.map(u => ({set: u.set, asset: u.asset, clip: u.clip, facing: u.facing, frames: u.frames.length, ...unitMetrics(u, ink, pivot)}));
  console.log(JSON.stringify(args.json ? {pivot, summary: summarize(rows), rows} : summarize(rows), null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
