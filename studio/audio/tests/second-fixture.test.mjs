// A second project: other sample rate, other tuning, other scale, its own pack. Nothing in studio/audio is tied to the first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectAudio, applyProjectRate, insideProtected, renderDocument, renderScore, analyze, pitchCheck, validateDocument, measure, loudness } from '../index.mjs';
import { sine } from './helpers.mjs';
import { realPack as corePack } from '../../core/tests/helpers.mjs';

const score = {
  schema: 'studio.audio.score', version: 1, id: 'tide_loop', title: 'Second project bed', sampleRate: 48000, seed: 31337,
  tempoBpm: 72, beatsPerBar: 3, tuningA4Hz: 432,
  key: {tonic: 'D', scale: 'hirajoshi', enforce: true},
  loop: {bars: 6},
  instruments: {
    reed: {gains: [0.15, 0.15], tailMs: 700, fadeOutMs: 8, layers: [
      {type: 'osc', wave: 'square', ratio: 1, filters: [{type: 'biquad', mode: 'lowpass', hz: 1800, q: 0.9}],
        env: {attackMs: 40, attackShape: 'exp', releaseMs: 120, releaseShape: 'exp'}}]},
    bell: {gains: [0.25, 0.4], tailMs: 1500, fadeOutMs: 10, layers: [
      {type: 'osc', wave: 'additive', ratio: 1, harmonics: [{n: 1, gain: 1, decay: 2}, {n: 2.0 | 0, gain: 0.4, decay: 3}, {n: 3, gain: 0.2, decay: 5}],
        env: {attackMs: 2, attackShape: 'exp', releaseMs: 200, releaseShape: 'exp'}}]},
    hush: {gains: [0.5, 0.5], tailMs: 400, pitched: false, layers: [
      {type: 'noise', filters: [{type: 'biquad', mode: 'bandpass', hz: 3000, endHz: 800, q: 2}], gain: 0.2,
        env: {attackMs: 30, attackShape: 'exp', releaseMs: 100, releaseShape: 'exp'}}]}
  },
  tracks: [
    {instrument: 'reed', events: [[0, 'D3', 2, 0.9], [3, 'F3', 2, 0.8], [6, 'A3', 2, 0.9], [9, 'E3', 2, 0.8], [12, 'D4', 2.5, 0.7]]},
    {instrument: 'bell', events: [[1, 'A4', 1, 0.8], [4, 'D5', 1, 0.7], [7, 'F5', 1, 0.7], [13, 'A4', 1, 0.6]]},
    {instrument: 'hush', events: [[2, 'C4', 1, 0.8], [8, 'C4', 1, 0.8]]}
  ],
  reverb: {type: 'taps', taps: [{ms: 31, gain: 0.05, cross: true}, {ms: 67, gain: 0.03}]},
  masterGain: 1
};

async function project(t, rate) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-second-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const pack = corePack();
  pack.id = 'other-game';
  pack.palette.file = 'pal.json';
  pack.catalog.sources = [{id: 'snd', kind: 'audio-plan', file: 'plan.json', evidence: {packs: 'snd/packs', masters: 'snd/masters', sources: 'snd/src'}}];
  pack.editable = {overlay: 'approved.json', groups: []};
  await fs.writeFile(path.join(dir, 'studio.project.json'), JSON.stringify(pack));
  await fs.mkdir(path.join(dir, 'snd/packs/one'), {recursive: true});
  await fs.writeFile(path.join(dir, 'snd/packs/one/pack.json'), JSON.stringify({bgm: {sample_rate_hz: rate}, sfx: {sample_rate_hz: rate}}));
  return dir;
}

test('the sample rate comes from the second project, and a document naming another rate is refused', async t => {
  const dir = await project(t, 48000);
  const info = await projectAudio(dir);
  assert.equal(info.sampleRate, 48000);
  assert.deepEqual(info.protectedDirs, ['snd/packs', 'snd/masters', 'snd/src']);
  assert.equal(applyProjectRate({...score, sampleRate: undefined}, info.sampleRate).sampleRate, 48000);
  assert.throws(() => applyProjectRate({...score, sampleRate: 44100}, info.sampleRate), e => e.code === 'sample_rate_mismatch');
  assert.ok(insideProtected(dir, info.protectedDirs, path.join(dir, 'snd/masters/x.wav')));
  assert.ok(!insideProtected(dir, info.protectedDirs, path.join(dir, 'scratch/x.wav')));
  const none = await project(t, 44100);
  await fs.writeFile(path.join(none, 'snd/packs/one/pack.json'), JSON.stringify({bgm: {}}));
  assert.equal((await projectAudio(none)).sampleRate, null);
});

test('a bed at 48 kHz, A4 = 432 Hz, D hirajoshi renders deterministically with the right length and pitch', () => {
  assert.deepEqual(validateDocument(score), []);
  const a = renderScore(score), b = renderScore(structuredClone(score));
  assert.ok(a.wav.equals(b.wav));
  assert.equal(a.sampleRate, 48000);
  assert.equal(a.frames, Math.round(6 * 3 * (60 / 72) * 48000)); // 6 bars of 3 beats at 72 bpm = 15 s
  assert.equal(a.wav.readUInt32LE(24), 48000);
  const pitch = pitchCheck(score);
  assert.ok(pitch.ok, JSON.stringify(pitch.voices.filter(v => !v.inScale || Math.abs(v.centsError) > 25)));
  const a4 = pitch.voices.find(v => v.instrument === 'bell' && v.midi === 69);
  assert.ok(Math.abs(a4.expectedHz - 432) < 0.01, 'A4 is 432 Hz in this project');
  assert.ok(Math.abs(a4.centsError) < 5);
  assert.deepEqual(pitch.voices.map(v => v.instrument).filter(i => i === 'hush'), [], 'the noise instrument is not pitched');
  const m = analyze(a).measurements;
  assert.equal(m.sampleRate, 48000);
  assert.ok(m.peak.sampleDbfs < 0 && m.loudness.integratedLufs < -10);
  assert.ok(m.loop.worstSeamStep <= m.loop.perChannel[0].interiorP99AbsStep, m.loop.verdict);
});

test('a note outside the second scale is refused, and allowed once the key says so', () => {
  const bad = structuredClone(score);
  bad.tracks[0].events[0] = [0, 'B3', 2, 0.9]; // B is not in D hirajoshi (D E F A Bb)
  assert.throws(() => renderScore(bad), e => e.code === 'out_of_scale');
  bad.key = {pitchClasses: [2, 4, 5, 9, 10, 11], enforce: true};
  assert.doesNotThrow(() => renderScore(bad));
});

test('a 22.05 kHz one-shot: Nyquist is enforced from the document rate, loudness meter follows the rate', () => {
  const patch = {schema: 'studio.audio.patch', version: 1, id: 'low_rate', sampleRate: 22050, seed: 5, durationMs: 120, trim: 0.5,
    layers: [{type: 'osc', startMs: 0, ms: 120, gain: 0.8, hz: 3000, endHz: 900, env: {attackMs: 4, decayMs: 40, releaseMs: 30}}]};
  const r = renderDocument(patch);
  assert.equal(r.frames, Math.round(0.120 * 22050));
  assert.equal(r.wav.readUInt32LE(24), 22050);
  assert.ok(validateDocument({...patch, layers: [{...patch.layers[0], hz: 12000}]}).some(i => /Nyquist/.test(i)));
  for (const rate of [22050, 32000, 48000, 96000]) {
    const l = loudness(sine({amp: 0.1, rate}).samples, rate).integratedLufs;
    assert.ok(Math.abs(l - (-23.01)) < 0.06, `${rate}: ${l}`);
  }
});
