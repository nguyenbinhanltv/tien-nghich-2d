// One-shot patch renderer: layers of oscillators and noise mixed on one bus, trimmed, PCM16, with
// digital zero at both ends enforced.
import { Mt19937 } from './rng.mjs';
import { renderLayer } from './layer.mjs';
import { msToFrames } from './util.mjs';
import { toPcm16, encodeWav } from './wav.mjs';
import { validatePatch } from './validate.mjs';

export function renderPatch(doc, {skipValidation = false} = {}) {
  if (!skipValidation) {
    const issues = validatePatch(doc);
    if (issues.length) throw Object.assign(new Error('Invalid patch:\n  ' + issues.join('\n  ')), {code: 'invalid_patch', issues});
  }
  const rate = doc.sampleRate, channels = doc.channels ?? 1, frames = msToFrames(doc.durationMs, rate);
  const bus = Array.from({length: channels}, () => new Float64Array(frames));
  doc.layers.forEach((layer, index) => {
    const offset = msToFrames(layer.startMs ?? 0, rate), length = msToFrames(layer.ms, rate);
    if (offset + length > frames) throw Object.assign(new Error(`Layer ${index} exceeds the patch frame count`), {code: 'layer_overflow'});
    const rng = new Mt19937(doc.seed + index); // seed + layer index, the CPython random.Random(seed + i) stream
    const signal = renderLayer(layer, {rate, length, rng});
    const gains = channels === 1 ? [1] : layer.gains ?? doc.gains ?? [1, 1];
    for (let c = 0; c < channels; c++) {
      const g = gains[c], out = bus[c];
      if (g === 1) for (let i = 0; i < length; i++) out[offset + i] += signal[i];
      else for (let i = 0; i < length; i++) out[offset + i] += signal[i] * g;
    }
  });
  const trim = doc.trim ?? 1;
  const scaled = bus.map(ch => ch.map(v => v * trim));
  let pcm;
  try { pcm = toPcm16(scaled); } catch (e) {
    if (e.code === 'clip') throw Object.assign(new Error(`${e.message}: lower "trim" or layer gains so the peak stays below full scale`), {code: 'clip'});
    throw e;
  }
  for (let c = 0; c < channels; c++) {
    const ch = pcm[c];
    let peak = 0;
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));
    if (peak === 0) throw Object.assign(new Error('Patch renders silence'), {code: 'silent'});
    if (ch[0] !== 0 || ch[ch.length - 1] !== 0)
      throw Object.assign(new Error(`One-shot must start and end on digital zero (first ${ch[0]}, last ${ch[ch.length - 1]}, channel ${c}); give the layers that end last a linear releaseMs and the first a nonzero attackMs`), {code: 'endpoint'});
  }
  return {kind: 'patch', id: doc.id, sampleRate: rate, channels, frames, pcm, wav: encodeWav(pcm, rate), loop: null};
}
