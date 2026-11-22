// The colour hold: hysteresis on a constructed sequence, determinism, outline and alpha untouched, and "off" reproducing the plain snap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadPack } from '../../../core/pack.mjs';
import { createImage, decodePng, effectiveLoops, encodePng, importSheet, pixelizeImport, renderTemplate, runPipeline, settingsFromPack, snapPalette, turnaroundLayout } from '../../index.mjs';
import { resolveHold, snapHeld } from '../hold.mjs';
import { drawFigure, makeProject, palette } from '../../tests/fixture.mjs';

const A = [100, 100, 100], B = [120, 100, 100], C = [100, 100, 130];
const frame = (rgb, alpha = 255) => { const img = createImage(2, 1); img.pixels.set([...rgb, alpha], 0); img.pixels.set([...rgb, alpha], 4); return img; };
const px = (img, i = 0) => [...img.pixels.subarray(i * 4, i * 4 + 4)];

test('a pixel keeps its previous entry while the new colour is within the margin of the best distance', () => {
  const prev = frame(A);
  // Source (112,100,100): B is nearest (8 away), A is 12 away: 4 worse than the best.
  const source = frame([112, 100, 100]);
  assert.deepEqual(px(snapPalette(source, [A, B])), [...B, 255]);
  const held = snapHeld(source, [A, B], prev, {margin: 4});
  assert.deepEqual(px(held.image), [...A, 255]);
  assert.equal(held.held, 2);
  const free = snapHeld(source, [A, B], prev, {margin: 3.9});
  assert.deepEqual(px(free.image), [...B, 255]);
  assert.equal(free.held, 0);
  // A source that is clearly nearer another entry leaves the hold.
  assert.deepEqual(px(snapHeld(frame([121, 100, 100]), [A, B], prev, {margin: 4}).image), [...B, 255]);
  // No previous frame, or a previous colour outside the palette: plain snap.
  assert.deepEqual(px(snapHeld(source, [A, B], null, {margin: 99}).image), [...B, 255]);
  assert.deepEqual(px(snapHeld(source, [A, B], frame([1, 2, 3]), {margin: 99}).image), [...B, 255]);
});

test('a chain of slowly changing frames holds one entry instead of switching back and forth', () => {
  const colours = [[108, 100, 100], [112, 100, 100], [109, 100, 100], [113, 100, 100]];
  const plain = colours.map(c => px(snapPalette(frame(c), [A, B]))[0]);
  assert.deepEqual(plain, [100, 120, 100, 120], 'the plain snap flips between the two entries');
  let prev = null; const out = [];
  for (const c of colours) { prev = snapHeld(frame(c), [A, B], prev, {margin: 6}).image; out.push(px(prev)[0]); }
  assert.deepEqual(out, [100, 100, 100, 100].map((v, i) => (i === 0 ? plain[0] : v)));
});

test('alpha is never changed and transparent pixels stay untouched', () => {
  const src = createImage(2, 1); src.pixels.set([112, 100, 100, 255, 7, 8, 9, 0]);
  const prev = createImage(2, 1); prev.pixels.set([...A, 255, ...A, 255]);
  const {image} = snapHeld(src, [A, B], prev, {margin: 50});
  assert.deepEqual(px(image, 0), [...A, 255]);
  assert.deepEqual(px(image, 1), [7, 8, 9, 0]);
});

test('the chroma guard stops a held entry from dulling or sharpening a colour', () => {
  const grey = [100, 100, 100], red = [140, 90, 90];
  const source = frame([128, 92, 92]); // nearest: red; grey is further
  const prev = frame(grey);
  assert.deepEqual(px(snapHeld(source, [grey, red], prev, {margin: 60}).image), [...grey, 255]);
  assert.deepEqual(px(snapHeld(source, [grey, red], prev, {margin: 60, maxChromaGain: 10}).image), [...red, 255]);
});

test('the search shift lines a moved figure up before holding', () => {
  const two = (a, b) => { const img = createImage(4, 1); img.pixels.set([...a, 255, ...b, 255, ...a, 255, ...a, 255]); return img; };
  const prev = two(A, B); // B at x=1
  const src = createImage(4, 1); src.pixels.set([...A, 255, ...A, 255, ...B, 255, ...A, 255]); // B moved to x=2
  assert.deepEqual(snapHeld(src, [A, B], prev, {margin: 0, search: 1}).offset, [1, 0]);
  assert.deepEqual(snapHeld(src, [A, B], prev, {margin: 0, search: 0}).offset, [0, 0]);
});

test('resolveHold: off, defaults from the pack, overrides, and nothing assumed in code', () => {
  const pack = {margin: 30, metric: 'rgb', laps: 2};
  assert.equal(resolveHold(false, pack), null);
  assert.equal(resolveHold(undefined, undefined), null, 'no pack block, no hold');
  assert.deepEqual(resolveHold(undefined, pack), {margin: 30, metric: 'rgb', search: 0, laps: 2});
  assert.equal(resolveHold({margin: 5}, pack).margin, 5);
  assert.equal(resolveHold({enabled: false}, pack), null);
  assert.equal(resolveHold(undefined, {...pack, enabled: false}), null);
  assert.equal(resolveHold({margin: 7}, undefined).margin, 7, 'an explicit margin works without a pack block');
  assert.throws(() => resolveHold({margin: -1}, pack));
  assert.throws(() => resolveHold({margin: 1, metric: 'nope'}, pack));
});

// A pose sheet: two facings, three poses whose body colour wanders across the midpoint of two palette entries.
const poses = ['a', 'b', 'c'], facings = ['front', 'side'];
const hexRgb = id => { const hex = palette.colors.find(c => c.id === id).hex; return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); };
async function build(ts = [0.42, 0.58, 0.46]) {
  const dir = await makeProject({clips: {walk: [3, 100]}});
  const pack = await loadPack(dir), settings = await settingsFromPack(pack, dir, 'critter');
  const layout = turnaroundLayout({id: 'hold', facings, poses, size: [900, 1200], heightPx: 26});
  const sheet = renderTemplate(layout);
  layout.cells.forEach((cell, i) => {
    // The body colour sits near the midpoint of two palette entries and wanders across it from pose to pose.
    const t = ts[poses.indexOf(cell.pose)], from = hexRgb('clay'), to = hexRgb('moss');
    drawFigure(sheet, layout, cell.id, {width: 120, height: 160, body: from.map((v, k) => Math.round(v + (to[k] - v) * t)), head: hexRgb('rose')});
  });
  const bytes = Buffer.from(encodePng(sheet));
  return {dir, settings, layout, bytes, imported: importSheet({layout, sheet: decodePng(bytes), sheetBytes: bytes, profile: settings.profile, scaleOptions: {mode: 'facing'}})};
}

const bytesOf = (map) => [...map.entries()].map(([id, c]) => [id, Buffer.from(encodePng(c.native)).toString('base64'), Buffer.from(encodePng(c.indexed)).toString('base64')]);
const sig = (frame) => Buffer.from(encodePng(frame.native)).toString('base64');
const clips = (spec) => ({schema: 'forge.poseclips', version: 1, clips: Object.fromEntries(Object.entries(spec).map(([name, [keys, loop]]) => [name, {keys, facings, ...(loop === undefined ? {} : {loop})}]))});
// Body colour between clay and moss: a just on the clay side, the others clearly moss. The margin is wide enough to hold a
// against moss, too narrow to hold moss against clay.
async function boundary(t, ts = [0.45, 0.7, 0.7]) {
  const made = await build(ts);
  t.after(() => fs.rm(made.dir, {recursive: true, force: true}));
  const D = Math.hypot(...hexRgb('clay').map((v, k) => v - hexRgb('moss')[k]));
  return {...made, withHold: {...made.settings, hold: {margin: 0.15 * D, laps: 2}}};
}

test('cells are always the independent plain snap; off and a pack without a hold block give identical frames; on is deterministic, binary and keeps the outline', async t => {
  const {settings, imported, withHold} = await boundary(t);
  const plain = pixelizeImport(imported, {...settings, hold: null}, {poseClips: clips({walk: [['a', 'b', 'c']]})});
  assert.equal(plain.record.hold, undefined, 'a pack with no hold block records none');
  assert.equal(plain.held.size, 0);
  const on = pixelizeImport(imported, withHold, {poseClips: clips({walk: [['a', 'b', 'c']]})});
  assert.deepEqual(bytesOf(on.cells), bytesOf(plain.cells), 'static cells and one-frame clips never inherit colours');
  assert.deepEqual(bytesOf(pixelizeImport(imported, withHold, {hold: false, poseClips: clips({walk: [['a', 'b', 'c']]})}).cells), bytesOf(plain.cells));
  assert.equal(pixelizeImport(imported, withHold, {hold: false, poseClips: clips({walk: [['a', 'b', 'c']]})}).held.size, 0);
  assert.deepEqual(bytesOf(pixelizeImport(imported, withHold, {poseClips: clips({walk: [['a', 'b', 'c']]})}).held), bytesOf(on.held), 'deterministic');
  assert.equal(on.held.size, 6, 'three keys of two facings');
  assert.deepEqual(on.record.hold, {margin: withHold.hold.margin, metric: 'rgb', search: 0, laps: 2});
  const ink = settings.outline.color;
  for (const [key, frame] of on.held) {
    const [, f, i] = key.split('/'), p = plain.cells.get(`${'abc'[i]}_${f}`).native, n = frame.native;
    for (let k = 0; k < n.pixels.length; k += 4) {
      assert.equal(n.pixels[k + 3], p.pixels[k + 3], `${key}: alpha identical`);
      const wasInk = p.pixels[k + 3] === 255 && ink.every((v, c) => p.pixels[k + c] === v), isInk = n.pixels[k + 3] === 255 && ink.every((v, c) => n.pixels[k + c] === v);
      assert.equal(isInk, wasInk, `${key}: outline is exactly the same pixels`);
    }
  }
});

test('no clips, no hold: a sheet with no sequence information is never held', async t => {
  const {imported, withHold} = await boundary(t);
  const r = pixelizeImport(imported, withHold);
  assert.equal(r.held.size, 0);
  assert.equal(r.record.held.length, 0);
});

test('held frames are per clip, facing and key index: a repeated key in a one-shot, and a pose shared by two clips', async t => {
  const {imported, withHold} = await boundary(t);
  // One-shot a,b,a: the opening a has no predecessor; the closing a follows b and may differ. Neither depends on the other.
  const aba = pixelizeImport(imported, withHold, {poseClips: clips({walk: [['a', 'b', 'a'], false]})});
  const ab = pixelizeImport(imported, withHold, {poseClips: clips({walk: [['a', 'b'], false]})});
  assert.equal(sig(aba.held.get('walk/front/0')), sig(ab.held.get('walk/front/0')), 'the opening frame ignores later keys');
  assert.notEqual(sig(aba.held.get('walk/front/0')), sig(aba.held.get('walk/front/2')), 'the same pose plays twice and is snapped twice');
  // Two clips share pose a: each keeps its own frame, whatever order they are listed in.
  const xy = pixelizeImport(imported, withHold, {poseClips: clips({x: [['a', 'b'], false], y: [['c', 'a'], false]})});
  const yx = pixelizeImport(imported, withHold, {poseClips: clips({y: [['c', 'a'], false], x: [['a', 'b'], false]})});
  assert.notEqual(sig(xy.held.get('x/front/0')), sig(xy.held.get('y/front/1')), 'a after nothing and a after c differ');
  for (const k of ['x/front/0', 'x/front/1', 'y/front/0', 'y/front/1']) assert.equal(sig(xy.held.get(k)), sig(yx.held.get(k)), `${k} does not depend on the listing order`);
  // A pose in no clip is not in the held map at all.
  assert.ok(![...ab.held.keys()].some(k => k.includes('/2')));
});

test('a loop closes onto its first key and a one-shot does not; the loop resolved from a secondary template is honoured', async t => {
  const {imported, withHold} = await boundary(t);
  const loop = pixelizeImport(imported, withHold, {poseClips: clips({walk: [['a', 'b', 'c'], true]})});
  const once = pixelizeImport(imported, withHold, {poseClips: clips({walk: [['a', 'b', 'c'], false]})});
  assert.notEqual(sig(loop.held.get('walk/front/0')), sig(once.held.get('walk/front/0')));
  assert.equal(once.record.held.find(h => h.key === 0 && h.facing === 'front').held, 0);
  // Omitted loop with a one-shot secondary template: effectiveLoops says false, and that is what the quantiser gets.
  const library = {bodyPlan: 'x', archetypes: {shot: {loop: false, tracks: []}, cycle: {tracks: []}}, templates: {'critter/walk': {use: 'shot'}, 'critter/idle': {use: 'cycle'}}};
  const spec = {schema: 'forge.poseclips', version: 1, clips: {walk: {keys: ['a', 'b', 'c'], facings, secondary: {}}, idle: {keys: ['a', 'b', 'c'], facings, secondary: {}}, own: {keys: ['a', 'b'], facings, loop: true, secondary: {template: 'walk'}}}};
  assert.deepEqual(effectiveLoops(spec, {library, profileName: 'critter'}), {walk: false, idle: true, own: true});
  const omitted = pixelizeImport(imported, withHold, {poseClips: clips({walk: [['a', 'b', 'c']]}), loops: {walk: false}});
  assert.equal(sig(omitted.held.get('walk/front/0')), sig(once.held.get('walk/front/0')), 'an omitted loop that resolves to a one-shot behaves as one');
});

test('the bake consumes the held frames of its own clip, and the pipeline reports them per frame', async t => {
  const {dir, settings, layout, bytes, withHold} = await boundary(t);
  const poseClips = clips({walk: [['a', 'b', 'c'], false]});
  const run = hold => runPipeline({project: {settings: {...settings, hold: withHold.hold}, palette: null}, layout, sheet: {bytes}, poseClips, hold});
  const on = await run(undefined), off = await run(false);
  const heldInfo = on.artifacts.pixelized.record.held, bakeOn = on.summary.stages.bake.frames, bakeOff = off.summary.stages.bake.frames;
  assert.equal(Object.keys(on.summary.stages.pixelize.hold.heldPerFrame).length, 6);
  assert.deepEqual(Object.keys(on.summary.stages.pixelize.hold.heldPerFrame).sort(), ['walk/front/0', 'walk/front/1', 'walk/front/2', 'walk/side/0', 'walk/side/1', 'walk/side/2']);
  for (const h of heldInfo) assert.equal(bakeOn[`walk_${h.facing}_${h.key}`], h.sha256, 'the baked frame is the held frame');
  assert.equal(off.summary.stages.pixelize.hold, undefined);
  for (const f of facings) assert.equal(bakeOff[`walk_${f}_1`], on.artifacts.pixelized.record.cells.find(c => c.id === `b_${f}`).sha256, 'off bakes the plain cells');
  assert.notDeepEqual(bakeOn, bakeOff, 'the hold changed at least one baked frame');
  assert.equal(heldInfo.find(h => h.key === 0 && h.facing === 'front').held, 0, 'a one-shot opens without a predecessor');
});

test('redmean picks the nearest entry by redmean, on the first frame too, and rgb output is unchanged', () => {
  // Source [100,100,100]: rgb prefers [100,113,100]; redmean prefers [115,100,100].
  const G = [100, 113, 100], R = [115, 100, 100], src = frame([100, 100, 100]);
  assert.deepEqual(px(snapHeld(src, [G, R], null, {margin: 0, metric: 'rgb'}).image), [...G, 255]);
  assert.deepEqual(px(snapHeld(src, [G, R], null, {margin: 0, metric: 'redmean'}).image), [...R, 255]);
  assert.deepEqual(px(snapHeld(src, [G, R], frame(G), {margin: 0, metric: 'redmean'}).image), [...R, 255], 'margin 0 never holds a farther entry');
  assert.deepEqual(px(snapHeld(src, [G, R], null, {margin: 0}).image), px(snapPalette(src, [G, R])), 'rgb is the plain snap');
});

test('run forwards --pose-order, pixelise reads --poses (with the rig and library for loop resolution), and the held frames are written to disk', async () => {
  const src = await fs.readFile(new URL('../../cli.mjs', import.meta.url), 'utf8');
  assert.match(src, /poseOrder: opts\['pose-order'\]/);
  assert.match(src, /order: opts\['pose-order'\]\?\.split\(','\), poseClips,/);
  assert.match(src, /held: pixelized\.held, rig, poseRig/);
});
