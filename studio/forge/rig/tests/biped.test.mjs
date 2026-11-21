import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bakeRig, qaBake, validateRig, loadLibrary, makePalette } from '../index.mjs';
import { getRgb, alphaAt, flipHorizontal, framesEqual } from '../raster.mjs';
import { bipedPalette, bipedPaletteData, bipedRig, bipedNative } from './fixtures/biped.mjs';
import { root } from './fixtures/marten.mjs';
import { checkPixels } from '../../../core/gates.mjs';

const palette = bipedPalette();
const manifest = JSON.parse(readFileSync(`${root}assets/manifest_longtime.json`, 'utf8'));
const projectPalette = JSON.parse(readFileSync(`${root}tools/generators/palette.json`, 'utf8'));
const library = loadLibrary('biped');
const native = bipedNative(palette);
const bake = (profileName, clips) => bakeRig({rig: bipedRig, native, library, profile: manifest.profiles[profileName], profileName, palette, clips});

test('the biped fixture shares nothing with the marten or the project palette', () => {
  const project = new Set(projectPalette.colors.map(c => c.hex.toLowerCase()));
  assert.ok(bipedPaletteData.colors.every(c => !project.has(c.hex.toLowerCase())));
  assert.notEqual(bipedPaletteData.outline_id, projectPalette.outline_id);
  assert.deepEqual(validateRig(bipedRig, {palette}), []);
  // Against the project palette the rig does not even validate: its colour ids are unknown there.
  assert.match(validateRig(bipedRig, {palette: makePalette(projectPalette)}).join(), /unknown palette id "bp_badge"/);
});

test('every frame of every forge clip at 32x32 passes the studio core pixel gates with the biped palette', () => {
  const rgbInt = hex => parseInt(hex.slice(1), 16);
  const gate = {palette: new Set(bipedPaletteData.colors.map(c => rgbInt(c.hex))), outline: rgbInt(bipedPaletteData.colors[0].hex), sizeSpec: {sizes: [[32, 32]]}};
  const allowed = new Set(bipedPaletteData.colors.map(c => c.hex.slice(1)));
  let frames = 0;
  for (const profile of ['player', 'npc', 'mob']) {
    for (const [name, frame] of Object.entries(bake(profile).frames)) {
      frames++;
      assert.deepEqual(checkPixels(frame, gate).errors, [], name);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (alphaAt(frame, x, y) === 0) continue;
        assert.equal(alphaAt(frame, x, y), 255);
        assert.ok(allowed.has(getRgb(frame, x, y).map(v => v.toString(16).padStart(2, '0')).join('')), `${name} ${x},${y}`);
      }
    }
  }
  assert.equal(frames, 72 + 32 + 56);
});

test('player idle and walk pass every gate on all four facings, including the mirrored one', () => {
  const result = bake('player', ['idle', 'walk']);
  const qa = qaBake(result, {rig: bipedRig, palette, options: {stability: {maxSizeDelta: 0.5}}});
  assert.deepEqual(qa.findings, []);
  for (const facing of ['south', 'west', 'north', 'east']) {
    assert.ok(qa.metrics[`walk/${facing}`].bodyTravel >= 1, `${facing} weight shifts with the support`);
  }
});

test('east is the mirror of west with the badge swapped away; the badge is on the correct side per facing', () => {
  const result = bake('player', ['idle']);
  const {west, east} = result.clips.idle.facings;
  west.frames.forEach((frame, i) => {
    const flipped = flipHorizontal(frame);
    const swapped = Buffer.from(flipped.pixels);
    const badge = palette.rgb('bp_badge'), spare = palette.rgb('bp_cloth_hi');
    for (let k = 0; k < swapped.length; k += 4) if (swapped[k + 3] && swapped[k] === badge[0] && swapped[k + 1] === badge[1] && swapped[k + 2] === badge[2]) spare.forEach((v, c) => { swapped[k + c] = v; });
    assert.ok(framesEqual({...flipped, pixels: swapped}, east.frames[i]), `east_${i}`);
  });
  assert.deepEqual(east.contacts[0].map(c => c.xy[0]), west.contacts[0].map(c => 31 - c.xy[0]));
  const count = frame => { let n = 0; const b = palette.rgb('bp_badge'); for (let k = 0; k < frame.pixels.length; k += 4) if (frame.pixels[k + 3] && frame.pixels[k] === b[0] && frame.pixels[k + 1] === b[1] && frame.pixels[k + 2] === b[2]) n++; return n; };
  for (const facing of ['south', 'west', 'north']) assert.equal(count(result.clips.idle.facings[facing].frames[0]), 2, facing);
  assert.equal(count(east.frames[0]), 0);
});

test('the pivot never moves: every frame keeps the canvas, and the feet stay on the same row', () => {
  const result = bake('player', ['walk']);
  for (const facing of ['south', 'west', 'north', 'east']) {
    const out = result.clips.walk.facings[facing];
    out.frames.forEach(frame => assert.deepEqual([frame.width, frame.height], bipedRig.canvas));
    const planted = out.contacts.flatMap(list => list.filter(c => c.planted).map(c => c.xy[1]));
    assert.equal(new Set(planted).size, 1, `${facing} planted feet share one row`);
  }
});

test('a rig that lacks a required role for its plan is refused before any pixel is drawn', () => {
  const legless = structuredClone(bipedRig);
  legless.facings.south.parts = legless.facings.south.parts.filter(p => p.role !== 'leg');
  assert.match(validateRig(legless, {palette}).join(), /body plan biped needs 2\+ "leg"/);
  assert.throws(() => bakeRig({rig: legless, native, library, profile: manifest.profiles.player, profileName: 'player', palette}), /rig is invalid/);
});
