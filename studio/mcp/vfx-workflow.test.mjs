// The SpriteFX build is shared by studio_vfx_build and the VFX tab's human build action; its input checks are the same for both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSpec, vfxAdapter } from './workflow/vfx.mjs';

const palettes = {neutral: 'palettes/neutral.json'};
const spec = (over = {}) => ({name: 'spark', palette: 'neutral', canvas: [32, 32], ...over});

test('checkSpec: a registered palette is required unless the caller allows a spec that lists its ramps inline', () => {
  assert.equal(typeof checkSpec(spec(), palettes), 'string');
  assert.throws(() => checkSpec(spec({palette: undefined}), palettes), /registered project palette/);
  assert.equal(typeof checkSpec(spec({palette: undefined}), palettes, {requirePalette: false}), 'string');
  assert.throws(() => checkSpec(spec({palette: 'other'}), palettes, {requirePalette: false}), /registered project palette/, 'a named palette must still be registered');
});

test('checkSpec: no file paths, a safe name, a size limit', () => {
  assert.throws(() => checkSpec(spec({layers: [{src: '../x.png'}]}), palettes), /looks like a file path/);
  assert.throws(() => checkSpec(spec({name: 'Bad Name'}), palettes), /spec.name is required/);
  assert.throws(() => checkSpec(spec({pad: 'x'.repeat(70000)}), palettes), /limit is/);
  assert.throws(() => checkSpec([], palettes), /effect object/);
});

test('vfxAdapter names the missing registration', () => {
  assert.throws(() => vfxAdapter({adapters: {}}), /registers no SpriteFX adapter/);
  assert.deepEqual(vfxAdapter({adapters: {vfx: {a: 1}}}), {a: 1});
});
