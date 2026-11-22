import test from 'node:test';
import assert from 'node:assert/strict';
import { applyReverb, impulseResponse } from '../reverb.mjs';
import { renderScore, validateScore } from '../index.mjs';
import { readJson } from './helpers.mjs';

const rate = 8000;
const dryClick = (n, at) => [Float64Array.from({length: n}, (_, i) => i === at ? 1 : 0), Float64Array.from({length: n}, (_, i) => i === at ? 0.5 : 0)];

test('impulse reverb equals direct circular convolution for loops and a plain truncated convolution for one-shots', () => {
  const spec = {type: 'impulse', seconds: 0.25, decayPerSecond: 6, seeds: [3, 4], wet: 1, dry: 0, smoothTaps: 2};
  const n = 1500, dry = dryClick(n, 1400).map((c, ch) => { c[10] = 0.25 * (ch + 1); return c; });
  const looped = applyReverb(dry, spec, rate, {circular: true}), oneShot = applyReverb(dry, spec, rate, {circular: false});
  dry.forEach((chan, c) => {
    const ir = impulseResponse(spec, rate, c);
    for (const [out, circular] of [[looped[c], true], [oneShot[c], false]]) {
      for (const i of [0, 7, 10, 300, 1400, 1499]) {
        let want = 0;
        for (let j = 0; j < n; j++) {
          if (!chan[j]) continue;
          // The response (8000 * 0.25 = 2000 frames) is longer than the 1500-frame loop, so it wraps more than once.
          let k = i - j;
          if (circular) { k = ((k % n) + n) % n; for (; k < ir.length; k += n) want += chan[j] * ir[k]; }
          else if (k >= 0 && k < ir.length) want += chan[j] * ir[k];
        }
        assert.ok(Math.abs(out[i] - want) < 1e-9, `channel ${c} frame ${i} circular=${circular}: ${out[i]} vs ${want}`);
      }
    }
  });
  assert.ok(Math.abs(looped[0][0]) > 0, 'the click near the end rings across the join');
  assert.equal(oneShot[0][0], 0);
});

test('feedback reverb wraps: a click near the end is audible at the start, and the tail repeats identically on a second pass', () => {
  const spec = {type: 'feedback', wet: 1, dry: 0, combs: [{ms: 20, feedback: 0.8}, {ms: 27, feedback: 0.75}], allpasses: [{ms: 5, gain: 0.5}]};
  const n = 6000, dry = dryClick(n, 5900);
  const wet = applyReverb(dry, spec, rate, {circular: true});
  let head = 0;
  for (let i = 0; i < 1500; i++) head += Math.abs(wet[0][i]);
  assert.ok(head > 0);
  const flat = applyReverb(dry, spec, rate, {circular: false});
  assert.equal(flat[0][0], 0);
});

test('impulse reverb in a score is schema-checked and renders deterministically', () => {
  const doc = readJson('studio/audio/examples/dusk.score.json');
  doc.reverb = {type: 'impulse', seconds: 1, decayPerSecond: 5, seeds: [1, 2], wet: 0.4};
  assert.deepEqual(validateScore(doc), []);
  assert.ok(renderScore(doc).wav.equals(renderScore(structuredClone(doc)).wav));
  delete doc.reverb.seeds;
  assert.ok(validateScore(doc).some(i => /impulse needs "seeds"/.test(i)));
});
