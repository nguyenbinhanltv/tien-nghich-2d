// The colour hold: hysteresis on a constructed sequence, determinism, outline and alpha untouched, and "off" reproducing the plain snap.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { loadPack } from '../../../core/pack.mjs';
import { createImage, decodePng, encodePng, importSheet, pixelizeImport, renderTemplate, runPipeline, settingsFromPack, snapPalette, turnaroundLayout } from '../../index.mjs';
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
  return {dir, settings, imported: importSheet({layout, sheet: decodePng(bytes), sheetBytes: bytes, profile: settings.profile, scaleOptions: {mode: 'facing'}})};
}
const bytesOf = r => [...r.cells.entries()].map(([id, c]) => [id, Buffer.from(encodePng(c.native)).toString('base64'), Buffer.from(encodePng(c.indexed)).toString('base64')]);

test('off reproduces the plain snap byte for byte; on is deterministic and keeps alpha and outline', async t => {
  const {dir, settings, imported} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  assert.ok(settings.hold, 'the fixture project carries the real pack, so its forge.pixelize.hold default applies');
  const bare = {...settings, hold: null}, plain = pixelizeImport(imported, bare);
  assert.equal(plain.record.hold, undefined, 'a pack with no hold block records none');
  assert.deepEqual(bytesOf(pixelizeImport(imported, settings, {hold: false})), bytesOf(plain), 'the option off is today\'s output');
  const withDefaults = {...settings, hold: {margin: 60, metric: 'rgb', laps: 2}};
  assert.deepEqual(bytesOf(pixelizeImport(imported, withDefaults, {hold: false})), bytesOf(plain), 'hold: false beats the pack default');
  const a = pixelizeImport(imported, withDefaults), b = pixelizeImport(imported, withDefaults);
  assert.deepEqual(bytesOf(a), bytesOf(b), 'deterministic');
  assert.deepEqual(a.record.hold, {margin: 60, metric: 'rgb', search: 0, laps: 2});
  assert.ok(a.record.cells.every(c => Number.isInteger(c.held)), 'every cell of a sequence reports its held pixels');
  const ink = settings.outline.color;
  for (const [id, cell] of a.cells) {
    const p = plain.cells.get(id).native, n = cell.native;
    for (let i = 0; i < n.pixels.length; i += 4) {
      assert.equal(n.pixels[i + 3], p.pixels[i + 3], `${id}: alpha is identical to the plain snap`);
      assert.ok(n.pixels[i + 3] === 0 || n.pixels[i + 3] === 255, `${id}: binary alpha`);
      const wasInk = p.pixels[i + 3] === 255 && ink.every((v, k) => p.pixels[i + k] === v);
      const isInk = n.pixels[i + 3] === 255 && ink.every((v, k) => n.pixels[i + k] === v);
      assert.equal(isInk, wasInk, `${id}: the outline is exactly the same pixels`);
    }
  }
});

test('a sequence is the poses of one facing; cells without a pose and a facing with one pose are left alone', async t => {
  const {dir, settings, imported} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const withDefaults = {...settings, hold: {margin: 60, laps: 1}};
  const r = pixelizeImport(imported, withDefaults);
  const first = id => r.record.cells.find(c => c.id === id).held;
  assert.equal(first('a_front'), 0, 'with one lap the first frame has nothing to hold against');
  assert.ok(r.record.cells.some(c => c.held > 0), 'later frames hold');
  const lone = {...imported, record: {...imported.record, cells: imported.record.cells.map(c => ({...c, pose: undefined}))}};
  assert.ok(pixelizeImport(lone, withDefaults).record.cells.every(c => c.held === undefined), 'a turnaround is not a sequence');
  const order = pixelizeImport(imported, withDefaults, {order: ['c', 'b', 'a']});
  assert.equal(order.record.cells.find(c => c.id === 'c_front').held, 0, 'order changes which frame starts the sequence');
});

test('runPipeline reports the hold per frame, and hold: false switches it off', async t => {
  const {dir, settings} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const tpl = turnaroundLayout({id: 'hold', facings, poses, size: [900, 1200], heightPx: 26});
  const sheet = renderTemplate(tpl);
  tpl.cells.forEach(cell => {
    const t = [0.42, 0.58, 0.46][poses.indexOf(cell.pose)], from = hexRgb('clay'), to = hexRgb('moss');
    drawFigure(sheet, tpl, cell.id, {width: 120, height: 160, body: from.map((v, k) => Math.round(v + (to[k] - v) * t)), head: hexRgb('rose')});
  });
  const bytes = Buffer.from(encodePng(sheet));
  const run = hold => runPipeline({project: {settings, palette: null}, layout: tpl, sheet: {bytes}, hold});
  const on = (await run({margin: 60, maxChromaGain: 255})).summary.stages.pixelize, off = (await run(false)).summary.stages.pixelize;
  assert.deepEqual(Object.keys(on.hold.heldPerFrame).sort(), tpl.cells.map(c => c.id).sort());
  assert.ok(Object.values(on.hold.heldPerFrame).some(n => n > 0));
  assert.equal(off.hold, undefined);
});

test('redmean picks the nearest entry by redmean, on the first frame too, and rgb output is unchanged', () => {
  // Source [100,100,100]: rgb prefers [100,113,100]; redmean prefers [115,100,100].
  const G = [100, 113, 100], R = [115, 100, 100], src = frame([100, 100, 100]);
  assert.deepEqual(px(snapHeld(src, [G, R], null, {margin: 0, metric: 'rgb'}).image), [...G, 255]);
  assert.deepEqual(px(snapHeld(src, [G, R], null, {margin: 0, metric: 'redmean'}).image), [...R, 255]);
  assert.deepEqual(px(snapHeld(src, [G, R], frame(G), {margin: 0, metric: 'redmean'}).image), [...R, 255], 'margin 0 never holds a farther entry');
  assert.deepEqual(px(snapHeld(src, [G, R], null, {margin: 0}).image), px(snapPalette(src, [G, R])), 'rgb is the plain snap');
});

test('the hold follows each clip: unrelated poses are untouched and a one-shot does not wrap', async t => {
  // Body colour between clay and moss: a is just on the clay side, b just on the moss side, c clearly moss.
  const {dir, settings, imported} = await build([0.45, 0.55, 0.7]);
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const D = Math.hypot(...hexRgb('clay').map((v, k) => v - hexRgb('moss')[k]));
  const withHold = {...settings, hold: {margin: 0.15 * D, laps: 2}};
  const clip = (keys, loop) => ({schema: 'forge.poseclips', version: 1, clips: {walk: {keys, facings, loop}}});
  const sig = (r, id) => Buffer.from(encodePng(r.cells.get(id).native)).toString('base64');
  const ab = pixelizeImport(imported, withHold, {poseClips: clip(['a', 'b'], true)});
  assert.equal(ab.record.cells.find(c => c.id === 'c_front').held, undefined, 'a pose outside every clip is not held');
  const plain = pixelizeImport(imported, withHold, {hold: false});
  assert.equal(sig(ab, 'c_front'), sig(plain, 'c_front'), 'and is snapped exactly as before');
  // a and b do not depend on c unless the clip plays it.
  const abc = pixelizeImport(imported, withHold, {poseClips: clip(['a', 'b', 'c'], true)});
  const abcOnce = pixelizeImport(imported, withHold, {poseClips: clip(['a', 'b', 'c'], false)});
  assert.notEqual(sig(abc, 'a_front'), sig(abcOnce, 'a_front'), 'a loop closes onto its first key; a one-shot does not');
  assert.equal(sig(abcOnce, 'a_front'), sig(pixelizeImport(imported, withHold, {poseClips: clip(['a', 'b'], false)}), 'a_front'), 'the first key of a one-shot ignores later keys');
  assert.equal(abcOnce.record.cells.find(c => c.id === 'a_front').held, 0);
  // Playing order: c first.
  assert.equal(pixelizeImport(imported, withHold, {poseClips: clip(['c', 'b', 'a'], false)}).record.cells.find(c => c.id === 'c_front').held, 0);
});

test('run forwards --pose-order and pixelise forwards --poses', async () => {
  const src = await fs.readFile(new URL('../../cli.mjs', import.meta.url), 'utf8');
  assert.match(src, /poseOrder: opts\['pose-order'\]/);
  assert.match(src, /order: opts\['pose-order'\]\?\.split\(','\), poseClips: await optionalJson\(opts\.poses\)/);
});
