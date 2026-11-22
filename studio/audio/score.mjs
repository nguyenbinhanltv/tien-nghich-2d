// Score renderer: tempo grid, instruments built from layers, timed events, loop-wrapped tails
// and reverb. Every event and its tail wraps modulo the loop length, so the join is seamless.
import { Mt19937 } from './rng.mjs';
import { renderLayer } from './layer.mjs';
import { roundEven, noteHz, msToFrames, allowedPitchClasses } from './util.mjs';
import { toPcm16, encodeWav } from './wav.mjs';
import { applyReverb } from './reverb.mjs';
import { validateScore, expandEvents } from './validate.mjs';

export const isPitched = inst => inst.pitched ?? inst.layers.some(l => l.ratio !== undefined || l.endRatio !== undefined);

export function loopFrames(doc) {
  if (doc.loop.frames !== undefined) return doc.loop.frames;
  return roundEven(doc.loop.bars * (doc.beatsPerBar ?? 4) * (60 / doc.tempoBpm) * doc.sampleRate);
}

/** One note of one instrument as a mono float buffer at unit velocity, fade applied. */
export function renderVoice(inst, {rate, seed, streamIndex, hz, gateSec}) {
  const length = roundEven(rate * (gateSec + (inst.tailMs ?? 600) / 1000));
  const voice = new Float64Array(length);
  inst.layers.forEach((layer, li) => {
    const rng = new Mt19937([seed, streamIndex, li]);
    const x = renderLayer(layer, {rate, length, rng, noteHz: hz, gateSec});
    for (let i = 0; i < length; i++) voice[i] += x[i];
  });
  if (inst.fadeOutMs) {
    const k = Math.min(length, msToFrames(inst.fadeOutMs, rate));
    for (let j = 0; j < k; j++) voice[length - k + j] *= k > 1 ? 1 - j / (k - 1) : 0;
  }
  return voice;
}

export function scaleReport(doc, events) {
  const allowed = allowedPitchClasses(doc.key);
  const out = [];
  if (!allowed) return {declared: false, ok: true, outOfScale: []};
  for (const e of events) {
    if (!isPitched(doc.instruments[e.instrument])) continue;
    if (!allowed.has(((e.note % 12) + 12) % 12)) out.push({instrument: e.instrument, beat: e.beat, note: e.note});
  }
  return {declared: true, ok: out.length === 0, outOfScale: out};
}

export function renderScore(doc, {skipValidation = false} = {}) {
  if (!skipValidation) {
    const issues = validateScore(doc);
    if (issues.length) throw Object.assign(new Error('Invalid score:\n  ' + issues.join('\n  ')), {code: 'invalid_score', issues});
  }
  const rate = doc.sampleRate, meterBeat = 60 / doc.tempoBpm, a4 = doc.tuningA4Hz ?? 440;
  const length = loopFrames(doc);
  const events = expandEvents(doc);
  const scale = scaleReport(doc, events);
  if (doc.key?.enforce && !scale.ok)
    throw Object.assign(new Error(`Notes outside the declared scale: ${scale.outOfScale.slice(0, 5).map(o => `${o.instrument}@${o.beat} midi ${o.note}`).join(', ')}`), {code: 'out_of_scale', outOfScale: scale.outOfScale});
  const dry = [new Float64Array(length), new Float64Array(length)];
  events.forEach((e, index) => {
    const inst = doc.instruments[e.instrument];
    const voice = renderVoice(inst, {rate, seed: doc.seed, streamIndex: index, hz: noteHz(e.note, a4), gateSec: e.gate * meterBeat});
    const gains = inst.gains ?? [1, 1];
    const start = roundEven(e.beat * meterBeat * rate);
    for (let i = 0; i < voice.length; i++) {
      const v = voice[i] * e.vel, at = ((start + i) % length + length) % length;
      dry[0][at] += v * gains[0];
      dry[1][at] += v * gains[1];
    }
  });
  const wet = applyReverb(dry, doc.reverb, rate, {circular: true});
  const master = doc.masterGain ?? 1;
  const mixed = master === 1 ? wet : wet.map(c => c.map(v => v * master));
  let pcm;
  try { pcm = toPcm16(mixed); } catch (e) {
    if (e.code === 'clip') throw Object.assign(new Error(`${e.message}: lower masterGain or instrument layer gains`), {code: 'clip'});
    throw e;
  }
  return {kind: 'score', id: doc.id, sampleRate: rate, channels: 2, frames: length, pcm, wav: encodeWav(pcm, rate),
    loop: {start: 0, end: length}, scale, events: events.length};
}
