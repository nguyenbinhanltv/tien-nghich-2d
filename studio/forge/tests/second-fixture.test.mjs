// A different project (own pack, palette, sizes, pivot, outline rule, key and sheet shape) must run the
// whole pipeline with no code change: nothing may be tied to the marten or to Tiên Nghịch.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadPack } from '../../core/pack.mjs';
import { gateOptions, checkPixels } from '../../core/gates.mjs';
import { parsePalette } from '../../core/pack.mjs';
import { decodePng, encodePng, importSheet, pixelizeImport, renderTemplate, resolveMarks, settingsFromPack, turnaroundLayout, boundsOf } from '../index.mjs';
import { drawFigure, makeProject, palette, forgeDir } from './fixture.mjs';

const run = promisify(execFile);
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const find = id => rgb(palette.colors.find(c => c.id === id).hex);

async function build() {
  const dir = await makeProject();
  const pack = await loadPack(dir), settings = await settingsFromPack(pack, dir, 'critter');
  const layout = turnaroundLayout({id: 'critter-sheet', facings: ['front', 'side', 'back'], poses: ['idle', 'hit'], size: [1200, 800], heightPx: 26});
  const sheet = renderTemplate(layout);
  const spec = {front: {width: 150, height: 220, body: find('clay'), head: find('rose'), mark: find('mark')},
    side: {width: 260, height: 140, body: find('moss'), head: find('leaf')}, back: {width: 150, height: 240, body: find('sky'), head: find('sand')}};
  const boxes = {};
  for (const cell of layout.cells) boxes[cell.id] = drawFigure(sheet, layout, cell.id, spec[cell.facing]);
  return {dir, pack, settings, layout, sheet, boxes};
}

test('settings come from the second pack', async t => {
  const {dir, settings} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  assert.deepEqual(settings.profile.nativePx, [48, 40]);
  assert.deepEqual(settings.profile.pivotPx, [24, 34]);
  assert.equal(settings.outline.hex, '#101820');
  assert.equal(settings.palette.colors.length, 8);
});

test('template -> import -> pixelise on a 1200x800 green-key sheet with other sizes and palette', async t => {
  const {dir, pack, settings, layout, sheet} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const bytes = Buffer.from(encodePng(sheet));
  const imported = importSheet({layout, sheet: decodePng(bytes), sheetBytes: bytes, prompt: 'second fixture', profile: settings.profile});
  assert.equal(imported.record.cells.length, 6);
  assert.equal(imported.record.prompt.text, 'second fixture');
  // Guides left in the template and the label text are not foreground: only the drawn figure is.
  for (const entry of imported.record.cells) assert.ok(entry.foregroundPx > 10000, entry.id);
  const marks = resolveMarks([{color: 'mark', minRgb: [230, 200, 0]}], settings.palette);
  const result = pixelizeImport(imported, settings, {marks});
  const options = gateOptions(pack, parsePalette(palette), {});
  for (const info of result.record.cells) {
    const sprite = result.cells.get(info.id).native;
    assert.equal(sprite.width, 48); assert.equal(sprite.height, 40);
    assert.deepEqual(info.warnings, [], info.id);
    const gate = checkPixels({width: 48, height: 40, pixels: Buffer.from(sprite.data)}, options);
    assert.deepEqual(gate.errors, [], info.id);
    // Foot anchored: lowest opaque row is the support line (pivot y - groundLift - 1), centred near pivot x.
    const box = boundsOf(sprite);
    assert.equal(box[3], 30, `${info.id} support line`);
    assert.ok(Math.abs((box[0] + box[2]) / 2 - 24) <= 4, `${info.id} centred on pivot`);
  }
  // Each facing sits at its own size but within the room the profile allows; the tall ones are height-bound.
  const heights = Object.fromEntries(result.record.cells.map(c => [c.id, c.bounds[3] - c.bounds[1]]));
  assert.ok(heights.idle_front >= 20 && heights.idle_side <= 26);
  // The mark is a reserved colour: kept only where drawn (front) and never produced by snapping elsewhere.
  const markCount = id => result.record.cells.find(c => c.id === id).marks[0].visiblePx;
  assert.ok(markCount('idle_front') > 0 && markCount('idle_side') === 0 && markCount('idle_back') === 0);
});

test('the CLI runs the same steps against the second project', async t => {
  const dir = await makeProject();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const cli = path.join(forgeDir, 'cli.mjs');
  const common = ['--project', dir, '--profile', 'critter'];
  await run('node', [cli, 'template', ...common, '--out', path.join(dir, 't.png'), '--layout-out', path.join(dir, 'layout.json'), '--size', '900x900']);
  const layout = JSON.parse(await fs.readFile(path.join(dir, 'layout.json'), 'utf8'));
  assert.deepEqual(layout.cells.map(c => c.id), ['front', 'side', 'back']);
  // "Draw" on the template, save it as the sheet and import it.
  const sheet = decodePng(await fs.readFile(path.join(dir, 't.png')));
  for (const cell of layout.cells) drawFigure(sheet, layout, cell.id, {width: 140, height: 200, body: find('clay'), head: find('rose')});
  await fs.writeFile(path.join(dir, 'sheet.png'), encodePng(sheet));
  const before = await fs.readFile(path.join(dir, 'sheet.png'));
  await run('node', [cli, 'import', '--layout', path.join(dir, 'layout.json'), '--sheet', path.join(dir, 'sheet.png'), '--out', path.join(dir, 'imp'), '--prompt-text', 'cli', ...common]);
  await run('node', [cli, 'pixelise', '--import', path.join(dir, 'imp'), '--out', path.join(dir, 'native'), ...common]);
  assert.deepEqual((await fs.readdir(path.join(dir, 'native'))).sort(), ['back.png', 'front.png', 'pixelize.json', 'side.png']);
  const record = JSON.parse(await fs.readFile(path.join(dir, 'native/pixelize.json'), 'utf8'));
  assert.equal(record.profile.name, 'critter');
  assert.equal(decodePng(await fs.readFile(path.join(dir, 'native/front.png'))).width, 48);
  assert.ok(before.equals(await fs.readFile(path.join(dir, 'sheet.png'))), 'raw sheet untouched');
});

test('a scale recorded for one profile is recomputed for another, never reused', async t => {
  const {dir, settings, layout, sheet} = await build();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const other = {...settings, profile: {...settings.profile, nativePx: [64, 56], pivotPx: [32, 48]}};
  const imported = importSheet({layout, sheet, profile: settings.profile});
  const viaOther = pixelizeImport(imported, other);
  const direct = pixelizeImport(importSheet({layout, sheet, profile: other.profile}), other);
  assert.deepEqual(viaOther.record.cells.map(c => [c.scale, c.nativeOrigin]), direct.record.cells.map(c => [c.scale, c.nativeOrigin]));
  assert.notDeepEqual(viaOther.record.cells[0].nativeOrigin, pixelizeImport(imported, settings).record.cells[0].nativeOrigin);
  assert.equal(viaOther.cells.get('idle_front').native.width, 64);
});
