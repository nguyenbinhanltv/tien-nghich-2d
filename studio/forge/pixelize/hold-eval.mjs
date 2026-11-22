#!/usr/bin/env node
// Evidence for the colour hold: pixelise one import with and without it, count what the flicker gate flags, and draw the
// before/after contact sheet, a map of the flickering pixels and a picture of which pixels the hold changed.
// usage: node studio/forge/pixelize/hold-eval.mjs --import dir --project root --profile name [--marks marks.json]
//          [--margins 16,32,48] [--max-chroma-gain n] [--out pictures-dir] [--background r,g,b] [--scale 4]
// Poses and facings come from the import's own cell records, in layout order, played as one looping clip named "sheet". The gate is the production flicker gate
// (more than 10 interior pixels that change for one key and revert, over the closed loop).
import fs from 'node:fs';
import path from 'node:path';
import { loadPack } from '../../core/pack.mjs';
import { blit, createImage, encodePng, readImport, pixelizeImport, resolveMarks, settingsFromPack } from '../index.mjs';
import { flicker } from '../gates/index.mjs';
import { drawText } from '../sheet/font.mjs';

const opts = {};
for (let i = 2; i < process.argv.length; i += 2) opts[process.argv[i].slice(2)] = process.argv[i + 1];
const need = n => opts[n] ?? (() => { throw new Error(`missing --${n}`); })();
const root = path.resolve(opts.project ?? '.');
const pack = await loadPack(root), settings = await settingsFromPack(pack, root, need('profile'));
const imported = await readImport(need('import'));
const marks = resolveMarks(opts.marks ? JSON.parse(fs.readFileSync(opts.marks, 'utf8')) : [], settings.palette);
const cells = imported.record.cells;
const poses = [...new Set(cells.map(c => c.pose))], facings = [...new Set(cells.map(c => c.facing))];
const [W, H] = settings.profile.nativePx, S = Number(opts.scale ?? 4), bg = (opts.background ?? '122,124,132').split(',').map(Number).concat(255);
const ink = settings.outline.color;
const key = (f, p) => `${p}_${f}`;
const palette = {outline: ink};

const plain = pixelizeImport(imported, settings, {marks, hold: false});
const clips = {schema: 'forge.poseclips', version: 1, clips: {sheet: {keys: poses, loop: true}}};
// The held frames as a cell map, so the measures below read plain and held sets the same way.
const viewOf = r => ({...r, cells: new Map([...r.held].map(([k, v]) => { const [, f, i] = k.split('/'); return [key(f, poses[Number(i)]), v]; }))});
const maxGain = opts['max-chroma-gain'] !== undefined ? {maxChromaGain: Number(opts['max-chroma-gain'])} : {};
const same = (a, b, i) => a.pixels[i] === b.pixels[i] && a.pixels[i + 1] === b.pixels[i + 1] && a.pixels[i + 2] === b.pixels[i + 2];

function measure(result) {
  const per = {}, flags = {};
  let flagged = 0, total = 0, sum = 0, differ = 0, opaque = 0, motion = 0, motionPlain = 0;
  for (const f of facings) {
    const frames = poses.map(p => result.cells.get(key(f, p)).native);
    const counts = Array(frames.length).fill(0);
    for (const x of flicker({clip: 'x', facing: f, loop: true, frames}, {palette}, {maxPixels: 0})) counts[x.frame] = x.measured;
    per[f] = counts;
    counts.forEach(n => { total++; sum += n; if (n > 10) flagged++; });
    const changes = set => frames.reduce((n, _, k) => {
      const a = set.cells.get(key(f, poses[k])).native, b = set.cells.get(key(f, poses[(k + 1) % poses.length])).native;
      for (let i = 0; i < a.pixels.length; i += 4) if (a.pixels[i + 3] === 255 && b.pixels[i + 3] === 255 && !same(a, b, i)) n++;
      return n;
    }, 0);
    motion += changes(result); motionPlain += changes(plain);
    for (const p of poses) {
      const a = result.cells.get(key(f, p)).native, b = plain.cells.get(key(f, p)).native;
      for (let i = 0; i < a.pixels.length; i += 4) if (a.pixels[i + 3] === 255) { opaque++; if (!same(a, b, i)) differ++; }
    }
  }
  const held = (result.record.held ?? []).map(h => h.held);
  const markKeys = marks.length ? [...result.cells.values()].filter(c => marks.some(m => { for (let i = 0; i < c.native.pixels.length; i += 4) if (c.native.pixels[i + 3] === 255 && c.native.pixels[i] === m.rgb[0] && c.native.pixels[i + 1] === m.rgb[1] && c.native.pixels[i + 2] === m.rgb[2]) return true; return false; })).length : null;
  return {flagged: `${flagged}/${total}`, flickerPixels: sum, maxPerFrame: Math.max(...Object.values(per).flat()), perFrame: per, held, heldTotal: held.reduce((a, b) => a + b, 0),
    differFromPlain: `${differ}/${opaque}`, interframeChanges: `${motion}/${motionPlain}`, keysWithMark: markKeys};
}

const report = {off: measure(plain)};
const margins = (opts.margins ?? settings.hold?.margin ?? '').toString().split(',').filter(Boolean).map(Number);
const sets = {plain};
for (const margin of margins) {
  const result = viewOf(pixelizeImport(imported, settings, {marks, hold: {margin, ...maxGain}, poseClips: clips}));
  sets[`hold${margin}`] = result;
  report[`hold ${margin}`] = measure(result);
}
console.log(JSON.stringify(report, null, 2));

if (opts.out) {
  fs.mkdirSync(opts.out, {recursive: true});
  const block = frameOf => {
    const img = createImage(poses.length * (W * S + 2), facings.length * (H * S + 2), bg);
    facings.forEach((f, r) => poses.forEach((p, c) => {
      const fr = frameOf(f, p, c);
      for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
        const si = ((y / S | 0) * W + (x / S | 0)) * 4;
        if (fr.pixels[si + 3] === 255) img.pixels.set(fr.pixels.subarray(si, si + 4), ((r * (H * S + 2) + y) * img.width + c * (W * S + 2) + x) * 4);
      }
    }));
    return img;
  };
  const dim = fr => { const out = {width: fr.width, height: fr.height, pixels: Buffer.from(fr.pixels)}; for (let i = 0; i < out.pixels.length; i += 4) if (out.pixels[i + 3] === 255) { const l = (out.pixels[i] + out.pixels[i + 1] + out.pixels[i + 2]) / 3 * 0.5 + 60; out.pixels.set([l, l, l], i); } return out; };
  const flickerMap = set => block((f, p, c) => {
    const frames = poses.map(q => set.cells.get(key(f, q)).native), n = frames.length, cur = frames[c], b = frames[(c + n - 1) % n], a = frames[(c + 1) % n], fr = dim(cur);
    const solid = (q, i) => q.pixels[i + 3] === 255 && !(q.pixels[i] === ink[0] && q.pixels[i + 1] === ink[1] && q.pixels[i + 2] === ink[2]);
    for (let i = 0; i < cur.pixels.length; i += 4) if (solid(b, i) && solid(cur, i) && solid(a, i) && same(b, a, i) && !same(cur, b, i)) fr.pixels.set([255, 40, 160, 255], i);
    return fr;
  });
  const changed = set => block((f, p) => {
    const a = plain.cells.get(key(f, p)).native, b = set.cells.get(key(f, p)).native, fr = dim(a);
    for (let i = 0; i < a.pixels.length; i += 4) if (a.pixels[i + 3] === 255 && !same(a, b, i)) fr.pixels.set([255, 40, 160, 255], i);
    return fr;
  });
  const compose = (blocks, labels, file) => {
    const left = 4, top = 12, g = 14, w = blocks[0].width;
    const img = createImage(left + blocks.length * (w + g), top + blocks[0].height + 2, [236, 232, 224, 255]);
    blocks.forEach((b, i) => { blit(img, b, left + i * (w + g), top); drawText(labels[i], left + i * (w + g), 3, 1, (x, y) => img.pixels.set([20, 16, 26, 255], (y * img.width + x) * 4)); });
    fs.writeFileSync(path.join(opts.out, file), encodePng(img));
  };
  const names = Object.keys(sets), chosen = sets[`hold${settings.hold?.margin}`] ? `hold${settings.hold.margin}` : names.at(-1);
  compose(names.map(n => block((f, p) => sets[n].cells.get(key(f, p)).native)), names.map(n => n === 'plain' ? 'PLAIN SNAP' : `HOLD ${n.slice(4)}`), 'contact_before_after.png');
  compose([flickerMap(plain), flickerMap(sets[chosen])], ['FLICKER PIXELS PLAIN', `FLICKER PIXELS ${chosen.toUpperCase().replace('HOLD', 'HOLD ')}`], 'flicker_pixels.png');
  compose([changed(sets[chosen])], [`PIXELS ${chosen.toUpperCase().replace('HOLD', 'HOLD ')} CHANGED`], 'difference.png');
}
