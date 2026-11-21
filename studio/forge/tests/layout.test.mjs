import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLayout, turnaroundLayout, gridLayout, normalizeLayout, cellRect, renderTemplate, importSheet, createImage, boundsOf, getPixel } from '../index.mjs';

const base = () => turnaroundLayout({id: 'a', facings: ['south', 'west', 'north', 'east'], heightPx: 20});

test('turnaround layout: four facings make a 2x2 grid with unique ids and labels', () => {
  const layout = base();
  assert.deepEqual(validateLayout(layout), []);
  assert.deepEqual(layout.cells.map(c => [c.id, c.label, c.rect]), [
    ['south', 'SOUTH', [0, 0, 0.5, 0.5]], ['west', 'WEST', [0.5, 0, 1, 0.5]], ['north', 'NORTH', [0, 0.5, 0.5, 1]], ['east', 'EAST', [0.5, 0.5, 1, 1]]]);
  assert.equal(layout.landmarkBasis, 'cell_width');
});

test('with several poses each pose is a row and ids carry the pose', () => {
  const layout = turnaroundLayout({id: 'p', facings: ['f', 'b'], poses: ['idle', 'hit'], heightPx: 10});
  assert.deepEqual(layout.cells.map(c => c.id), ['idle_f', 'idle_b', 'hit_f', 'hit_b']);
  assert.deepEqual(layout.cells[2].rect, [0, 0.5, 0.5, 1]);
  assert.equal(layout.cells[2].label, 'HIT F');
});

test('validateLayout names each problem', () => {
  const layout = base();
  layout.cells[1].id = 'south';
  layout.cells[0].rect = [0.6, 0, 0.5, 1];
  layout.cells[2].label = 'bad label!';
  layout.key.rgb = [128, 128, 128];
  layout.landmarkBasis = 'sheet';
  const issues = validateLayout(layout).join('\n');
  for (const part of ['duplicated', 'rect', 'label', 'dominant channel', 'landmarkBasis']) assert.match(issues, new RegExp(part));
  assert.deepEqual(validateLayout({schema: 'other'}), ['not a forge.layout version 1 document']);
  assert.throws(() => gridLayout({id: 'x', columns: 1, rows: 1, cells: [{id: 'a'}, {id: 'b'}]}), RangeError);
});

test('cellRect scales with the sheet and rounds half to even', () => {
  const cell = {rect: [0, 0, 0.475, 0.5]};
  assert.deepEqual(cellRect(cell, 1254, 1254), [0, 0, 596, 627]);
  assert.deepEqual(cellRect({rect: [0, 0, 0.5, 1]}, 5, 5), [0, 0, 2, 5]); // 2.5 -> 2
});

test('normalizeLayout accepts the legacy bake-off format', () => {
  const legacy = {template: {columns: 2, rows: 1, labels: ['A', 'B'], label_band_fraction: 0.1, key_rgb: [0, 255, 0]},
    source_landmarks: {a: {cell_x: [0, 0.5], center_x: 0.5, foot_window: [0.2, 0.8], height_px: 10}, b: {cell_x: [0.5, 1], center_x: 0.5, foot_window: [0.2, 0.8], height_px: 10}}};
  const layout = normalizeLayout(legacy);
  assert.equal(layout.landmarkBasis, 'cell_height');
  assert.deepEqual(layout.cells.map(c => c.id), ['a', 'b']);
  assert.equal(normalizeLayout(layout), layout);
});

test('the template PNG is key-coloured with black labels and keyed-out guides', () => {
  const layout = base();
  const img = renderTemplate(layout);
  assert.deepEqual([img.width, img.height], [1024, 1024]);
  assert.deepEqual([...getPixel(img, 300, 300)], [0, 255, 0, 255]);
  const black = boundsOf(img, i => img.pixels[i] === 0 && img.pixels[i + 1] === 0 && img.pixels[i + 2] === 0);
  assert.ok(black[1] < 20 && black[0] < 20, 'label drawn at the top left of the first cell');
  // A blank template has no foreground: importing it fails with a cell-specific error.
  assert.throws(() => importSheet({layout, sheet: img}), error => error.code === 'empty_cell' && error.cell === 'south');
});

test('an empty foot window is reported, not guessed', () => {
  const layout = base();
  const sheet = renderTemplate(layout);
  // a figure far from the foot window of the first cell
  for (let y = 200; y < 300; y++) for (let x = 20; x < 60; x++) sheet.pixels.set([200, 0, 0, 255], (y * 1024 + x) * 4);
  layout.cells[0].landmarks.footWindow = [0.6, 0.9];
  assert.throws(() => importSheet({layout, sheet}), error => error.code === 'empty_foot_window');
  assert.ok(createImage(1, 1));
});
