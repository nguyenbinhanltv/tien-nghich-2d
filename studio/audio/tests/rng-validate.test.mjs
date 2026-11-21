import test from 'node:test';
import assert from 'node:assert/strict';
import { Mt19937 } from '../rng.mjs';
import { validatePatch, validateScore, validateDocument } from '../validate.mjs';
import { renderPatch, renderScore } from '../index.mjs';
import { readJson, exampleDir } from './helpers.mjs';
import fs from 'node:fs';
import path from 'node:path';

test('MT19937 reproduces CPython random.Random(seed) draws', () => {
  // Values from CPython 3.14: random.Random(7021).random(), random.Random(0).random(), random.Random(2**40 + 5).random()
  const a = new Mt19937(7021);
  assert.equal(a.random(), 0.9347016770037334);
  assert.equal(a.random(), 0.35369541209670996);
  assert.equal(new Mt19937(0).random(), 0.8444218515250481);
  assert.equal(new Mt19937(2 ** 40 + 5).random(), 0.5043802970418443);
});

test('the examples validate and render', () => {
  for (const name of fs.readdirSync(exampleDir)) {
    const doc = JSON.parse(fs.readFileSync(path.join(exampleDir, name), 'utf8'));
    assert.deepEqual(validateDocument(doc), [], name);
  }
});

test('patch validation says what is wrong and where', () => {
  const doc = readJson('studio/audio/examples/zap.patch.json');
  const bad = structuredClone(doc);
  bad.layers[0].hz = 30000; bad.layers[1].ratio = 2; delete bad.layers[2].ms; bad.extra = 1; bad.layers[1].filters = [{type: 'band', lowHz: 100}];
  const issues = validatePatch(bad);
  assert.ok(issues.some(i => /extra: unknown field/.test(i)), issues.join('\n'));
  assert.deepEqual(validatePatch(doc), []);
  const second = structuredClone(doc);
  second.layers[0].hz = 30000; second.layers[1].ratio = 2; delete second.layers[2].ms; second.layers[1].filters = [{type: 'band', lowHz: 100}];
  const issues2 = validatePatch(second);
  assert.ok(issues2.some(i => /layers\[0\].*Nyquist/.test(i)), issues2.join('\n'));
  assert.ok(issues2.some(i => /layers\[1\].*ratio/.test(i)));
  assert.ok(issues2.some(i => /layers\[2\].*"ms"/.test(i)));
  assert.ok(issues2.some(i => /filters\[0\].*highHz/.test(i)));
  assert.throws(() => renderPatch(second), e => e.code === 'invalid_patch' && e.issues.length >= 4);
});

test('one-shots must start and end on digital zero, clips are refused, silence is refused', () => {
  const doc = readJson('studio/audio/examples/zap.patch.json');
  // A tone that runs to the last frame with no linear release ends mid-wave, off zero.
  const noRelease = {...doc, durationMs: 100, layers: [{type: 'osc', startMs: 0, ms: 100, gain: 0.5, hz: 1000.5, env: {attackMs: 2}}]};
  assert.throws(() => renderPatch(noRelease), e => e.code === 'endpoint' && /releaseMs/.test(e.message));
  const loud = structuredClone(doc); loud.trim = 40;
  assert.throws(() => renderPatch(loud), e => e.code === 'clip');
  const silent = structuredClone(doc); silent.trim = 0;
  assert.throws(() => renderPatch(silent), e => e.code === 'silent');
  const ok = renderPatch(doc);
  assert.equal(ok.pcm[0][0], 0); assert.equal(ok.pcm[0][ok.frames - 1], 0);
});

test('score validation: unknown instruments and patterns, scale enforcement as data and as error', () => {
  const doc = readJson('studio/audio/examples/dusk.score.json');
  const bad = structuredClone(doc);
  bad.tracks[0].instrument = 'ghost'; bad.tracks[1].sequence[0].pattern = 'nope'; bad.loop = {bars: 4, frames: 100};
  const issues = validateScore(bad);
  assert.ok(issues.some(i => /ghost/.test(i)) && issues.some(i => /nope/.test(i)) && issues.some(i => /exactly one/.test(i)), issues.join('\n'));
  const off = structuredClone(doc);
  off.patterns.walk[0] = [0, 'A#3', 0.5, 0.8];
  assert.throws(() => renderScore(off), e => e.code === 'out_of_scale' && e.outOfScale[0].note === 58);
  off.key.enforce = false;
  const r = renderScore(off);
  assert.equal(r.scale.ok, false);
  assert.ok(r.scale.outOfScale.length > 0);
});
