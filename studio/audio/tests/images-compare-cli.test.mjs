import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyze, waveformPng, spectrogramPng, compare, renderDocument, audioFromPcm, decodeWav, renderScore } from '../index.mjs';
import { decodeRgba } from '../../core/png.mjs';
import { repo, readJson, sha256, experiments } from './helpers.mjs';
import { run as runExperiment, EFFECTS } from '../../../assets/experiments/audio_engine/compare.mjs';

const cli = path.join(repo, 'studio/audio/cli.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'audio-cli-'));

test('waveform and spectrogram are real PNGs that show the sound, deterministically, with an axis mapping', () => {
  const render = renderDocument(readJson('studio/audio/examples/zap.patch.json'));
  const audio = audioFromPcm(render.pcm, render.sampleRate);
  const w = waveformPng(audio, {width: 500, marks: {onsetFrame: 1, tailEndFrame: render.frames - 100}});
  const s = spectrogramPng(audio, {width: 500, height: 200});
  for (const [img, minColours] of [[w, 6], [s, 50]]) {
    const px = decodeRgba(img.png);
    assert.equal(px.width, img.width); assert.equal(px.height, img.height);
    const colours = new Set();
    for (let i = 0; i < px.pixels.length; i += 4) colours.add(px.pixels[i] << 16 | px.pixels[i + 1] << 8 | px.pixels[i + 2]);
    assert.ok(colours.size >= minColours, `the image is not blank (${colours.size} colours)`);
  }
  assert.ok(w.png.equals(waveformPng(audio, {width: 500, marks: {onsetFrame: 1, tailEndFrame: render.frames - 100}}).png));
  assert.equal(w.axes.framesPerPx, render.frames / 500);
  assert.equal(s.axes.frequencyAxis, 'log');
  assert.ok(s.axes.dbRange[1] > s.axes.dbRange[0]);
  // The spectrogram is a function of the sound: a falling sweep puts its energy high early and low late.
  const px = decodeRgba(s.png), row = (x) => { let best = 0, at = 0; for (let y = 0; y < 200; y++) { const o = ((6 + y) * px.width + 54 + x) * 4; const b = px.pixels[o] + px.pixels[o + 1] + px.pixels[o + 2]; if (b > best) { best = b; at = y; } } return at; };
  assert.ok(row(20) < row(280), 'the sweep falls, so its brightest row moves down the picture');
});

test('analyze accepts a document, a WAV and a render, and agrees with itself', () => {
  const doc = readJson('studio/audio/examples/dusk.score.json');
  const fromDoc = analyze(doc, {width: 300});
  const render = renderScore(doc);
  const fromWav = analyze(render.wav, {loop: render.loop, images: false});
  assert.deepEqual(fromDoc.measurements, fromWav.measurements);
  assert.ok(fromDoc.pitch.ok && fromDoc.images.waveform.png.length > 1000);
  assert.equal(fromDoc.measurements.loop.end, render.frames);
  assert.throws(() => analyze({nothing: 1}), e => e.code === 'bad_input');
});

test('compare: identical, reseeded and different cues are told apart', () => {
  const doc = readJson('assets/experiments/audio_engine/patches/sfx_dash.patch.json');
  const a = renderDocument(doc), b = renderDocument(doc), reseed = renderDocument({...doc, seed: doc.seed + 1});
  const A = audioFromPcm(a.pcm, a.sampleRate);
  const same = compare(A, audioFromPcm(b.pcm, b.sampleRate));
  assert.equal(same.identical.sampleExact, true);
  assert.equal(same.envelope.maxAbsDb, 0);
  const other = compare(A, audioFromPcm(reseed.pcm, reseed.sampleRate));
  assert.equal(other.identical.sampleExact, false);
  assert.ok(other.identical.differingSamples > 1000);
  assert.ok(other.envelope.correlation > 0.99 && other.envelope.maxAbsDb < 3, JSON.stringify(other.envelope));
  assert.ok(other.spectrum.rmsDiffDb < 3);
});

test('experiment: four delivered effects match their masters; the re-expressed bed matches by envelope, spectrum and loudness', () => {
  const r = runExperiment({write: false});
  assert.equal(r.effects.length, EFFECTS.length);
  for (const e of r.effects) {
    assert.equal(e.byteIdenticalToMaster, true, e.id);
    assert.equal(e.identical.maxAbsLsb, 0, e.id);
    assert.equal(e.envelope.correlation, 1, e.id);
  }
  const c = r.bed.comparison;
  assert.equal(c.frames.a, c.frames.b);
  assert.equal(c.identical.sampleExact, false, 'the bed uses another noise generator, so it is not sample-exact');
  assert.ok(c.envelope.correlation >= 0.999, 'envelope correlation ' + c.envelope.correlation);
  assert.ok(c.envelope.maxAbsDb <= 0.5, 'envelope max dB ' + c.envelope.maxAbsDb);
  assert.ok(c.spectrum.rmsDiffDb <= 0.25, 'spectrum rms dB ' + c.spectrum.rmsDiffDb);
  for (const band of c.spectrum.bandsDb) assert.ok(Math.abs(band.diff) <= 0.5, JSON.stringify(band));
  assert.ok(Math.abs(c.levels.integratedLufsDiff) <= 0.05 && Math.abs(c.levels.ungatedLufsDiff) <= 0.05);
  assert.ok(Math.abs(c.levels.samplePeakDbDiff) <= 0.1 && Math.abs(c.levels.truePeakDbDiff) <= 0.1);
  assert.ok(Math.abs(r.bed.render_measured.integratedLufs - r.bed.recorded.integratedLufs) <= 0.1, 'close to the figure recorded for the delivered master');
  for (const ctl of r.controls) assert.ok(ctl.identical.sampleExact === false);
  const [reseed, different] = r.controls;
  assert.ok(different.envelope.correlation < 0.9 && different.spectrum.rmsDiffDb > 10, 'the comparison does separate different sounds');
  assert.ok(reseed.envelope.correlation > 0.99);
});

test('committed experiment renders and report equal a fresh run', () => {
  const fresh = runExperiment({write: false});
  const report = JSON.parse(fs.readFileSync(path.join(experiments, 'comparison.json'), 'utf8'));
  assert.deepEqual(report, JSON.parse(JSON.stringify(fresh)));
  for (const {id} of EFFECTS) {
    const committed = fs.readFileSync(path.join(experiments, 'renders', id + '.wav'));
    assert.equal(sha256(committed), sha256(renderDocument(readJson('assets/experiments/audio_engine/patches', id + '.patch.json')).wav));
  }
});

test('CLI: validate, render with report and images, analyze a WAV, and never write into delivered audio', () => {
  const dir = tmp();
  const doc = path.join(repo, 'studio/audio/examples/zap.patch.json');
  const ok = spawnSync(process.execPath, [cli, 'validate', doc], {encoding: 'utf8'});
  assert.equal(ok.status, 0); assert.equal(JSON.parse(ok.stdout).valid, true);
  const badDoc = path.join(dir, 'bad.json');
  fs.writeFileSync(badDoc, JSON.stringify({schema: 'studio.audio.patch', version: 1}));
  const bad = spawnSync(process.execPath, [cli, 'validate', badDoc], {encoding: 'utf8'});
  assert.equal(bad.status, 1); assert.ok(JSON.parse(bad.stdout).issues.length >= 4);

  const out = path.join(dir, 'zap.wav');
  const render = spawnSync(process.execPath, [cli, 'render', doc, '--out', out, '--project', repo, '--images', dir, '--report', path.join(dir, 'r.json')], {encoding: 'utf8'});
  assert.equal(render.status, 0, render.stderr);
  const summary = JSON.parse(render.stdout);
  assert.equal(summary.sampleRate, 44100);
  assert.ok(fs.existsSync(path.join(dir, 'zap.waveform.png')) && fs.existsSync(path.join(dir, 'zap.spectrogram.png')) && fs.existsSync(path.join(dir, 'r.json')));
  assert.equal(decodeWav(fs.readFileSync(out)).frames, summary.frames);

  const analysis = spawnSync(process.execPath, [cli, 'analyze', out, '--out-dir', path.join(dir, 'a'), '--width', '400'], {encoding: 'utf8'});
  assert.equal(analysis.status, 0, analysis.stderr);
  assert.deepEqual(JSON.parse(analysis.stdout).measurements.peak, summary.measurements.peak);

  // analyze is read-only unless --out-dir is given: no files appear in the working directory.
  const cwd = tmp();
  const quiet = spawnSync(process.execPath, [cli, 'analyze', out], {encoding: 'utf8', cwd});
  assert.equal(quiet.status, 0, quiet.stderr);
  assert.ok(JSON.parse(quiet.stdout).measurements && !JSON.parse(quiet.stdout).images);
  assert.deepEqual(fs.readdirSync(cwd), []);
  const quietDoc = spawnSync(process.execPath, [cli, 'analyze', doc], {encoding: 'utf8', cwd});
  assert.equal(quietDoc.status, 0, quietDoc.stderr);
  assert.deepEqual(fs.readdirSync(cwd), []);

  const refused = spawnSync(process.execPath, [cli, 'render', doc, '--out', path.join(repo, 'assets/audio/masters/pilot_sfx/zz.wav'), '--project', repo], {encoding: 'utf8'});
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /delivered audio/);
  assert.ok(!fs.existsSync(path.join(repo, 'assets/audio/masters/pilot_sfx/zz.wav')));

  const mismatch = path.join(dir, 'rate.json');
  fs.writeFileSync(mismatch, JSON.stringify({...JSON.parse(fs.readFileSync(doc, 'utf8')), sampleRate: 48000}));
  const wrong = spawnSync(process.execPath, [cli, 'render', mismatch, '--out', path.join(dir, 'x.wav'), '--project', repo], {encoding: 'utf8'});
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /project's 44100/);
});
