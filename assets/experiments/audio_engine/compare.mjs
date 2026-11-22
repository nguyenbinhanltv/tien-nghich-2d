// Proof run: re-render delivered cues from patches/scores with studio/audio and compare against the delivered masters.
// node assets/experiments/audio_engine/compare.mjs      writes renders/, images/, comparison.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocument, decodeWav, compare, analyze, audioFromPcm, measure } from '../../../studio/audio/index.mjs';
import { legacyPresets } from './convert.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const read = f => JSON.parse(fs.readFileSync(path.join(here, f), 'utf8'));

export const EFFECTS = [
  {id: 'sfx_dash', character: 'broadband noise rush with a falling tone'},
  {id: 'sfx_blade', character: 'FM tone sweeps (whistle) over filtered noise'},
  {id: 'sfx_hit_stone', character: 'percussive impact, short and dry'},
  {id: 'sfx_chime', character: 'pitched, ringing tail'}
];

export function run({write = true} = {}) {
  const presets = legacyPresets();
  const out = {effects: [], controls: [], bed: null};
  for (const {id, character} of EFFECTS) {
    const doc = read(`patches/${id}.patch.json`);
    const render = renderDocument(doc);
    const master = path.join(root, 'assets/audio/masters', presets[id].batch, id + '.wav');
    const masterBytes = fs.readFileSync(master);
    const reference = decodeWav(masterBytes);
    const result = compare(reference, audioFromPcm(render.pcm, render.sampleRate));
    result.id = id; result.character = character; result.master = path.relative(root, master);
    result.byteIdenticalToMaster = render.wav.equals(masterBytes);
    out.effects.push(result);
    if (write) {
      fs.mkdirSync(path.join(here, 'renders'), {recursive: true});
      fs.writeFileSync(path.join(here, 'renders', id + '.wav'), render.wav);
      const imgs = analyze(render, {width: 600}).images;
      fs.mkdirSync(path.join(here, 'images'), {recursive: true});
      for (const [k, v] of Object.entries(imgs)) fs.writeFileSync(path.join(here, 'images', `${id}.${k}.png`), v.png);
    }
    if (id === 'sfx_dash') {
      // Controls: what a genuinely different render looks like. Same patch with another seed, and a different cue.
      const reseed = renderDocument({...doc, seed: doc.seed + 1});
      const other = decodeWav(fs.readFileSync(path.join(root, 'assets/audio/masters', presets.sfx_blade.batch, 'sfx_blade.wav')));
      const a = compare(reference, audioFromPcm(reseed.pcm, reseed.sampleRate));
      a.id = 'control: sfx_dash with seed + 1'; out.controls.push(a);
      const lenient = {...other, samples: other.samples.map(c => c.subarray(0, reference.frames)), pcm16: other.pcm16.map(c => c.subarray(0, reference.frames))};
      const b = compare(reference, lenient);
      b.id = 'control: sfx_dash vs sfx_blade (first 242 ms)'; out.controls.push(b);
    }
  }
  // The bed.
  const score = read('scores/bgm_hengyue.score.json');
  const render = renderDocument(score);
  const dir = path.join(root, 'assets/audio/bgm_hengyue');
  const prov = JSON.parse(fs.readFileSync(path.join(dir, 'provenance.json'), 'utf8'));
  const reference = decodeWav(fs.readFileSync(path.join(dir, 'master.wav')));
  const mine = audioFromPcm(render.pcm, render.sampleRate);
  const result = compare(reference, mine, {envelopeMs: 50});
  const mm = measure(mine, {loop: render.loop}), rm = measure(reference, {loop: {start: prov.loopStart, end: prov.loopEnd}});
  out.bed = {id: score.id, master: 'assets/audio/bgm_hengyue/master.wav', comparison: result,
    recorded: {integratedLufs: prov.verification.integrated_lufs, truePeakDbtp: prov.verification.true_peak_dbtp, loudnessRangeLu: prov.verification.loudness_range_lu},
    master_measured: {integratedLufs: rm.loudness.integratedLufs, truePeakDbtp: rm.peak.truePeakDbtp, loudnessRangeLu: rm.loudness.loudnessRangeLu, seam: rm.loop.perChannel.map(p => p.signedStep), seamMax10ms: rm.loop.perChannel.map(p => p.maxAbsStepWithin10ms)},
    render_measured: {integratedLufs: mm.loudness.integratedLufs, truePeakDbtp: mm.peak.truePeakDbtp, loudnessRangeLu: mm.loudness.loudnessRangeLu, sampleRate: mm.sampleRate, seam: mm.loop.perChannel.map(p => p.signedStep), seamMax10ms: mm.loop.perChannel.map(p => p.maxAbsStepWithin10ms), seamVerdict: mm.loop.verdict},
    bytes: {render: render.wav.length, masterFrames: reference.frames, renderFrames: render.frames}};
  if (write) {
    fs.writeFileSync(path.join(here, 'renders', score.id + '.wav'), render.wav);
    const imgs = analyze(render, {width: 1000}).images;
    for (const [k, v] of Object.entries(imgs)) fs.writeFileSync(path.join(here, 'images', `${score.id}.${k}.png`), v.png);
    const refImgs = analyze(fs.readFileSync(path.join(dir, 'master.wav')), {loop: {start: prov.loopStart, end: prov.loopEnd}}).images;
    for (const [k, v] of Object.entries(refImgs)) fs.writeFileSync(path.join(here, 'images', `${score.id}.master.${k}.png`), v.png);
    fs.writeFileSync(path.join(here, 'comparison.json'), JSON.stringify(out, null, 2) + '\n');
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = run();
  for (const e of r.effects) console.log(e.id, 'byte-identical:', e.byteIdenticalToMaster, 'env corr', e.envelope.correlation);
  console.log(JSON.stringify(r.bed.comparison.envelope), JSON.stringify(r.bed.comparison.spectrum.rmsDiffDb), JSON.stringify(r.bed.comparison.levels), JSON.stringify(r.bed.render_measured), JSON.stringify(r.bed.master_measured));
  for (const c of r.controls) console.log(c.id, JSON.stringify(c.envelope), JSON.stringify(c.spectrum.rmsDiffDb), JSON.stringify(c.levels.ungatedLufsDiff));
}
