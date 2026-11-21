// Parity with the Python prototype: the committed turnaround sheet and layout must reproduce
// turnaround_native/ pixel for pixel, and metrics.json's import landmarks exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from '../../core/pack.mjs';
import { decodePng, diffImages, encodePng, normalizeLayout, fromLegacyLayout, importSheet, settingsFromPack, resolveMarks, pixelizeImport, imagesEqual, sha256 } from '../index.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = path.join(root, 'assets/experiments/forge_bakeoff/lt_ink_marten');
const read = file => fs.readFile(path.join(dir, file));
const facings = ['south', 'west', 'north', 'east'];

async function run(basis) {
  const bytes = await read('turnaround.png');
  const legacy = JSON.parse(await read('layout.json'));
  const rig = JSON.parse(await read('rig.json'));
  const pack = await loadPack(root);
  const settings = await settingsFromPack(pack, root, 'pet');
  const layout = fromLegacyLayout(legacy, {id: 'lt-ink-marten', basis});
  const imported = importSheet({layout, sheet: decodePng(bytes), sheetBytes: bytes, profile: settings.profile});
  const marks = resolveMarks([{color: rig.marker, minRgb: [165, 0, 187], blueOverGreen: 17}], settings.palette);
  return {imported, result: pixelizeImport(imported, settings, {marks}), bytes};
}

test('the sheet hash matches the committed SHA-256', async () => {
  const bytes = await read('turnaround.png');
  assert.equal(sha256(bytes), (await read('turnaround.sha256')).toString().split(/\s/)[0]);
});

test('legacy basis reproduces turnaround_native pixel for pixel', async () => {
  const {result} = await run('cell_height');
  for (const facing of facings) {
    const expected = decodePng(await read(`turnaround_native/${facing}.png`));
    const actual = result.cells.get(facing).native;
    assert.deepEqual(diffImages(actual, expected), {count: 0, first: []}, facing);
  }
});

test('legacy basis reproduces the import landmarks in metrics.json', async () => {
  const {imported, result} = await run('cell_height');
  const metrics = JSON.parse(await read('metrics.json'));
  assert.equal(imported.record.sheet.sha256, metrics.sheet_sha256);
  for (const info of result.record.cells) {
    const m = metrics.imports[info.facing];
    assert.deepEqual(info.sourceGround, m.source_ground_xy);
    assert.deepEqual(info.sourceBounds, m.source_bounds);
    assert.deepEqual(info.nativeOrigin, m.native_origin_xy);
    assert.equal(Number(info.scale.toFixed(6)), m.scale);
    assert.equal(info.marks[0].visiblePx, m.visible_source_marker_px);
  }
});

test('the width-basis fix changes exactly the facings whose cell is not as wide as it is tall', async () => {
  const legacy = await run('cell_height'), fixed = await run('cell_width');
  const effect = {};
  for (const facing of facings) {
    const a = legacy.result.cells.get(facing).native, b = fixed.result.cells.get(facing).native;
    const la = legacy.result.record.cells.find(c => c.facing === facing), lb = fixed.result.record.cells.find(c => c.facing === facing);
    effect[facing] = {differingPx: diffImages(a, b).count, groundX: [la.sourceGround[0], lb.sourceGround[0]], scale: [Number(la.scale.toFixed(4)), Number(lb.scale.toFixed(4))]};
    assert.deepEqual(lb.warnings, [], facing);
  }
  // south and west cells are 627 wide (= cell height); north is 596 wide and east 659 wide.
  assert.deepEqual(effect, {
    south: {differingPx: 0, groundX: [301, 301], scale: [0.0529, 0.0529]},
    west: {differingPx: 0, groundX: [314, 314], scale: [0.0478, 0.0478]},
    north: {differingPx: 202, groundX: [345, 328], scale: [0.051, 0.0521]},
    east: {differingPx: 147, groundX: [332, 349], scale: [0.0489, 0.0463]},
  });
});

test('PNG containers differ from the Pillow files, but decode to identical pixels', async () => {
  const {result} = await run('cell_height');
  for (const facing of facings) {
    const committed = await read(`turnaround_native/${facing}.png`);
    const ours = encodePng(result.cells.get(facing).native);
    assert.ok(imagesEqual(decodePng(ours), decodePng(committed)));
  }
});
