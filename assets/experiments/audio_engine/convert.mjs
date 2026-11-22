// Legacy preset -> studio.audio.patch converter (project-specific; the engine in studio/audio knows nothing of it).
// Usage: node assets/experiments/audio_engine/convert.mjs   (rewrites patches/ from assets/audio/source/*/presets.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');

export function layerFromPreset(l) {
  const out = {type: l.voice === 'tone' ? 'osc' : 'noise', startMs: l.start_ms, ms: l.ms, gain: l.gain};
  if (l.voice === 'tone') {
    out.hz = l.hz; out.endHz = l.end_hz;
    if (l.fm_index !== undefined || l.fm_ratio !== undefined) out.fm = {ratio: l.fm_ratio ?? 1, index: l.fm_index ?? 0};
  } else out.filters = [{type: 'band', lowHz: l.low_hz, highHz: l.high_hz}];
  out.env = {attackMs: l.attack_ms, decayMs: l.decay_ms, releaseMs: l.release_ms};
  if (l.flutter_depth) out.am = {hz: l.flutter_hz ?? 0, depth: l.flutter_depth};
  return out;
}

export function patchFromPreset(id, p, sampleRate = 44100) {
  return {schema: 'studio.audio.patch', version: 1, id, title: id, design: p.design, sampleRate, channels: 1,
    seed: p.seed, durationMs: p.duration_ms, trim: p.trim, layers: p.layers.map(layerFromPreset)};
}

export function legacyPresets() {
  const out = {};
  const src = path.join(root, 'assets/audio/source');
  for (const batch of fs.readdirSync(src).sort()) {
    const file = path.join(src, batch, 'presets.json');
    if (!fs.existsSync(file)) continue;
    for (const [id, p] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) out[id] = {batch, preset: p};
  }
  return out;
}

/** The Hengyue bed: figures/answers per bar become patterns and sequences; plucks alternate two string timbres. */
export function scoreFromHengyue(legacy) {
  const dark = {pickPosition: 0.32, gains: [0.35, 0.26]}, bright = {pickPosition: 0.21, gains: [0.21, 0.29]};
  const string = v => ({gains: v.gains, tailMs: 850, fadeOutMs: 10, layers: [{
    type: 'osc', wave: 'additive', ratio: 1,
    harmonics: {count: 7, rolloff: 1.3, pickPosition: v.pickPosition, decayBase: 2.9, decayStep: 1.3},
    env: {attackMs: 3, attackShape: 'exp', releaseMs: 1000 / 15, releaseShape: 'exp'}}]});
  const flute = {gains: [0.143, 0.157], tailMs: 850, fadeOutMs: 10, layers: [
    {type: 'osc', wave: 'additive', ratio: 1, harmonics: [{n: 1, gain: 1}, {n: 2, gain: 0.15}, {n: 3, gain: 0.12}],
      scoop: {depth: -0.009, tauMs: 60}, vibrato: {hz: 4.8, depth: 0.002, riseMs: 1000 / 3},
      env: {attackMs: 72, attackShape: 'exp', releaseMs: 100, releaseShape: 'exp'}},
    {type: 'noise', filters: [{type: 'fir', taps: [0.125, 0.375, 0.375, 0.125], align: 'same'}],
      env: {attackMs: 72, attackShape: 'exp', releaseMs: 100, releaseShape: 'exp', level: {from: 0.155, to: 0.045, tauMs: 90}}}]};
  const patterns = {};
  for (const [name, events] of Object.entries(legacy.figures))
    patterns['fig_' + name] = events.map(([beat, note, gate, vel], i) => [beat, note, gate, vel, i % 2 ? 'string_bright' : 'string_dark']);
  for (const [name, events] of Object.entries(legacy.answers)) patterns['ans_' + name] = events;
  const plucks = [], answers = [];
  legacy.bars.forEach(([figure, answer], bar) => {
    if (legacy.figures[figure].length) plucks.push({bar, pattern: 'fig_' + figure});
    if (legacy.answers[answer].length) answers.push({bar, pattern: 'ans_' + answer});
  });
  return {
    schema: 'studio.audio.score', version: 1, id: legacy.id, title: legacy.title, sampleRate: legacy.sample_rate, seed: legacy.seed,
    tempoBpm: legacy.tempo_bpm, beatsPerBar: legacy.beats_per_bar, tuningA4Hz: legacy.tuning_A4_hz,
    key: {tonic: 'G', scale: 'major-pentatonic', enforce: true},
    loop: {bars: legacy.bars.length},
    instruments: {string_dark: string(dark), string_bright: string(bright), flute},
    patterns,
    tracks: [{name: 'plucks', instrument: 'string_dark', sequence: plucks}, {name: 'flute', instrument: 'flute', sequence: answers}],
    reverb: {type: 'taps', taps: [{ms: 23, gain: 0.054, cross: true}, {ms: 49, gain: 0.032, cross: true}, {ms: 91, gain: 0.018, cross: true}]}
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const legacy = JSON.parse(fs.readFileSync(path.join(root, 'assets/audio/bgm_hengyue/score.json'), 'utf8'));
  fs.mkdirSync(path.join(here, 'scores'), {recursive: true});
  fs.writeFileSync(path.join(here, 'scores/bgm_hengyue.score.json'), JSON.stringify(scoreFromHengyue(legacy), null, 1) + '\n');
  const dir = path.join(here, 'patches');
  fs.mkdirSync(dir, {recursive: true});
  for (const [id, {preset}] of Object.entries(legacyPresets()))
    fs.writeFileSync(path.join(dir, id + '.patch.json'), JSON.stringify(patchFromPreset(id, preset), null, 2) + '\n');
  console.log('wrote', fs.readdirSync(dir).length, 'patches');
}
