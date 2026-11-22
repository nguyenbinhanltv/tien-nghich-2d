import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { renderDocument, renderScore } from '../index.mjs';
import { repo, readJson, sha256, exampleDir, experiments } from './helpers.mjs';
import { legacyPresets, patchFromPreset } from '../../../assets/experiments/audio_engine/convert.mjs';

const cli = path.join(repo, 'studio/audio/cli.mjs');

test('two renders of every example are byte-identical, in this process and in a fresh one', () => {
  for (const name of fs.readdirSync(exampleDir)) {
    const doc = readJson('studio/audio/examples', name);
    const first = renderDocument(doc).wav, second = renderDocument(structuredClone(doc)).wav;
    assert.ok(first.equals(second), name);
    const out = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'audio-det-')), 'x.wav');
    const run = spawnSync(process.execPath, [cli, 'render', path.join(exampleDir, name), '--out', out], {encoding: 'utf8'});
    assert.equal(run.status, 0, run.stderr);
    assert.equal(sha256(fs.readFileSync(out)), sha256(first), name + ' (separate process)');
  }
});

test('property order and key order in the document do not change the output', () => {
  const doc = readJson('studio/audio/examples/zap.patch.json');
  const shuffled = JSON.parse(JSON.stringify(doc, Object.keys(doc).sort()));
  const sortDeep = v => Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])])) : v;
  assert.ok(renderDocument(doc).wav.equals(renderDocument(sortDeep(doc)).wav));
  assert.ok(shuffled);
});

test('the Hengyue bed render is pinned: same hash on every platform we have run', () => {
  // This hash was produced on Node 24.12.0 darwin/arm64. A different value on another Node or CPU means a platform
  // difference in Math.sin/exp/pow, floating-point contraction or the PNG-independent integer rounding.
  const score = JSON.parse(fs.readFileSync(path.join(experiments, 'scores/bgm_hengyue.score.json'), 'utf8'));
  const render = renderScore(score);
  assert.equal(render.frames, 3087000);
  const pinned = fs.readFileSync(path.join(experiments, 'renders/bgm_hengyue.wav'));
  assert.equal(sha256(render.wav), sha256(pinned), 'committed experiment render is stale or the platform differs');
  assert.ok(render.wav.equals(renderScore(structuredClone(score)).wav));
});

test('all 40 delivered effects re-render byte-identical to their masters from converted patches', () => {
  let count = 0;
  for (const [id, {batch, preset}] of Object.entries(legacyPresets())) {
    const master = fs.readFileSync(path.join(repo, 'assets/audio/masters', batch, id + '.wav'));
    const render = renderDocument(patchFromPreset(id, preset));
    assert.ok(render.wav.equals(master), id);
    count++;
  }
  assert.equal(count, 40);
});

test('the committed patch files are what the converter writes', () => {
  for (const [id, {preset}] of Object.entries(legacyPresets())) {
    const file = path.join(experiments, 'patches', id + '.patch.json');
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(patchFromPreset(id, preset), null, 2) + '\n', id);
  }
});

test('a loop is half-open: tails and reverb wrap, so the seam adds no discontinuity', () => {
  const doc = readJson('studio/audio/examples/dusk.score.json');
  const r = renderScore(doc);
  assert.deepEqual(r.loop, {start: 0, end: r.frames});
  const left = r.pcm[0];
  // The step from last frame back to the first must be ordinary for this music.
  const steps = [];
  for (let i = 1; i < left.length; i++) steps.push(Math.abs(left[i] - left[i - 1]));
  steps.sort((a, b) => a - b);
  const p99 = steps[Math.floor(steps.length * 0.99)];
  assert.ok(Math.abs(left[0] - left[left.length - 1]) <= p99);
  // A tail that crosses the end really lands at the start: silence the first bar's own events and energy remains.
  const solo = structuredClone(doc);
  solo.tracks = [{instrument: 'pad', events: [[15, 'A3', 1, 0.9]]}];
  solo.reverb = undefined; delete solo.reverb;
  const wrapped = renderScore(solo);
  let head = 0;
  for (let i = 0; i < 4000; i++) head += Math.abs(wrapped.pcm[0][i]);
  assert.ok(head > 0, 'the note at the last beat wraps into the first frames');
  // Same note rendered where it does not wrap leaves silence at frame 0.
  solo.tracks[0].events = [[2, 'A3', 1, 0.9]];
  const plain = renderScore(solo);
  assert.equal(plain.pcm[0][0], 0);
});
