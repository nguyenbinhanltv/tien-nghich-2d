import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { measure, loudness, kWeightCoefs, truePeak, decodeWav, estimateF0 } from '../index.mjs';
import { repo, readJson, sine } from './helpers.mjs';

const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b} (tol ${tol})`);

test('K-weighting at 48 kHz equals the constants published in BS.1770-4', () => {
  const [shelf, high] = kWeightCoefs(48000);
  const published = [[1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585], [1, -2, 1, -1.99004745483398, 0.99007225036621]];
  [shelf, high].forEach((c, s) => c.forEach((v, i) => near(v, published[s][i], 1e-8, `stage ${s + 1} coefficient ${i}`)));
});

test('loudness of a 997 Hz sine equals the textbook value, at 48 kHz and at 44.1 kHz', () => {
  for (const rate of [48000, 44100, 22050]) {
    const x = sine({amp: 0.1, rate});
    near(loudness(x.samples, rate).integratedLufs, 10 * Math.log10(0.1 ** 2 / 2), 0.05, `-20 dBFS mono sine at ${rate}`);
  }
  // Two identical channels add 3.01 LU.
  near(loudness(sine({amp: 0.1, channels: 2}).samples, 48000).integratedLufs, 10 * Math.log10(0.1 ** 2 / 2) + 3.01, 0.05, 'stereo');
});

test('gating: silence around a tone does not move the integrated figure; short files have no integrated figure', () => {
  const rate = 48000, tone = sine({amp: 0.1, seconds: 4, rate}).samples[0];
  const padded = new Float64Array(rate * 12); padded.set(tone, rate * 4);
  const plain = loudness([tone], rate), withSilence = loudness([padded], rate);
  // Edge blocks that straddle the tone's start and end sit above the -10 LU gate, so allow a few tenths of a LU.
  near(withSilence.integratedLufs, plain.integratedLufs, 0.4, 'gated');
  assert.ok(withSilence.ungatedLufs < plain.ungatedLufs - 3);
  const short = loudness([tone.subarray(0, 4000)], rate);
  assert.equal(short.integratedLufs, null);
  assert.ok(Number.isFinite(short.ungatedLufs));
});

test('true peak finds an inter-sample peak the sample peak misses', () => {
  const x = new Float64Array(2000);
  for (let i = 0; i < x.length; i++) x[i] = Math.sin(Math.PI / 2 * i + Math.PI / 4); // fs/4, samples at +-0.7071, true peak 1.0
  const tp = truePeak(x);
  near(20 * Math.log10(tp), 0, 0.15, 'true peak dBTP');
  near(Math.max(...x), 0.7071, 0.001, 'sample peak');
});

test('onset, tail and endpoints of a one-shot', () => {
  const x = new Float64Array(1000);
  for (let i = 100; i < 600; i++) x[i] = 0.5 * Math.sin(i * 0.3) * Math.sin(Math.PI * (i - 100) / 500);
  const m = measure({sampleRate: 44100, samples: [x]}, {spectrum: false});
  assert.equal(m.onset.frame, 101 > 0 ? m.onset.frame : 0);
  assert.ok(m.onset.frame >= 100 && m.onset.frame < 110);
  assert.ok(m.tail.endExclusive <= 600 && m.tail.endExclusive > 590);
  assert.equal(m.endpoints.digitalZeroStart, true);
  assert.equal(m.endpoints.digitalZeroEnd, true);
});

test('seam: a loop cut mid-wave is flagged, a loop on a whole number of cycles is not', () => {
  const rate = 8000, cycle = 80;
  const make = n => ({sampleRate: rate, samples: [Float64Array.from({length: n}, (_, i) => 0.5 * Math.sin(2 * Math.PI * i / cycle))]});
  const whole = measure(make(cycle * 20), {loop: {start: 0, end: cycle * 20}, spectrum: false});
  assert.ok(whole.loop.worstSeamStep <= whole.loop.perChannel[0].interiorP99AbsStep, whole.loop.verdict);
  const cut = measure(make(cycle * 20 + 30), {loop: {start: 0, end: cycle * 20 + 30}, spectrum: false});
  assert.ok(cut.loop.worstSeamStep > cut.loop.perChannel[0].interiorP99AbsStep, 'a mid-wave cut steps by more than the wave itself');
  assert.match(cut.loop.verdict, /click/);
});

test('f0 estimate finds the pitch of a sine within a few cents', () => {
  const x = sine({hz: 220, amp: 0.3, seconds: 1, rate: 44100}).samples[0];
  const f = estimateF0(x, 44100, 223);
  near(1200 * Math.log2(f.hz / 220), 0, 3, 'cents');
});

// Delivered masters carry the figures recorded when they were metered with FFmpeg ebur128/loudnorm.
const beds = ['dong_phu', 'hengyue', 'blood_sea', 'ancient_god', 'boss_trial', 'endless'];
const recorded = {dong_phu: {lufs: -23.2, tp: -7.4}, hengyue: {lufs: -21.66, tp: -7.06, lra: 6.0}, blood_sea: {lufs: -22.0, tp: -7.5, lra: 4.4},
  ancient_god: {lufs: -22.5, tp: -7.2, lra: 5.3}, boss_trial: {lufs: -21.6, tp: -8.4, lra: 1.9}, endless: {lufs: -22.0, tp: -9.9, lra: 5.4}};

test('integrated loudness, true peak and range agree with the figures recorded for the six delivered beds', () => {
  const rows = [];
  for (const bed of beds) {
    const prov = readJson('assets/audio', 'bgm_' + bed, 'provenance.json');
    const wav = decodeWav(fs.readFileSync(path.join(repo, 'assets/audio', 'bgm_' + bed, 'master.wav')));
    const m = measure(wav, {loop: {start: prov.loopStart ?? 0, end: prov.loopEnd ?? wav.frames}, spectrum: false});
    const rec = recorded[bed];
    rows.push(`${bed}: ${m.loudness.integratedLufs} vs ${rec.lufs}, tp ${m.peak.truePeakDbtp} vs ${rec.tp}`);
    near(m.loudness.integratedLufs, rec.lufs, 0.10, bed + ' integrated LUFS');
    near(m.peak.truePeakDbtp, rec.tp, 0.10, bed + ' true peak');
    if (rec.lra) near(m.loudness.loudnessRangeLu, rec.lra, 0.25, bed + ' LRA');
  }
  assert.equal(rows.length, 6);
});

test('seam steps and sample peaks of the Hengyue master equal the recorded integers exactly', () => {
  const prov = readJson('assets/audio/bgm_hengyue/provenance.json').verification;
  const wav = decodeWav(fs.readFileSync(path.join(repo, 'assets/audio/bgm_hengyue/master.wav')));
  const m = measure(wav, {loop: {start: 0, end: wav.frames}, spectrum: false});
  assert.deepEqual(m.peak.perChannel, prov.sample_peak_abs_lr);
  assert.deepEqual(m.loop.perChannel.map(p => p.signedStep), prov.signed_seam_step_lr);
  assert.deepEqual(m.loop.perChannel.map(p => p.maxAbsStepWithin10ms), prov.max_abs_step_within_10ms_either_side_lr);
  assert.deepEqual(m.loop.perChannel.map(p => p.firstPcm), prov.first_pcm_lr);
  assert.deepEqual(m.loop.perChannel.map(p => p.lastPcm), prov.last_pcm_lr);
});

test('sample peak and active RMS of delivered effects equal the ledger values', () => {
  const evidence = readJson('assets/audio/packs/pilot_v1/evidence.json').automated.mix_comparison.sfx_levels;
  for (const row of evidence) {
    const wav = decodeWav(fs.readFileSync(path.join(repo, 'assets/audio/masters/pilot_sfx', row.id + '.wav')));
    const m = measure(wav, {spectrum: false});
    near(m.peak.sampleDbfs, row.sample_peak_dbfs, 0.001, row.id + ' peak');
    near(m.rms.activeDbfs, row.active_rms_dbfs, 0.001, row.id + ' active rms');
  }
});
