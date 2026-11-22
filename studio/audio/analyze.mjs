// analyze(): the engine behind a studio_audio_analyze tool. Takes a WAV buffer, decoded audio, a render result
// or a patch/score document and returns measurements plus the two pictures.
import { decodeWav } from './wav.mjs';
import { measure } from './measure.mjs';
import { waveformPng, spectrogramPng } from './images.mjs';
import { renderDocument } from './render.mjs';
import { documentKind } from './validate.mjs';
import { pitchCheck } from './pitch.mjs';

export const audioFromPcm = (pcm, sampleRate) => ({
  sampleRate, pcm16: pcm, samples: pcm.map(c => Float64Array.from(c, v => v / 32768))
});

/**
 * @param input Buffer (WAV file) | {sampleRate, samples, pcm16?} | render result | patch/score document
 * @param options {loop?: {start, end}, images?: boolean (default true), width?: number, spectrum?: boolean}
 * @returns {measurements, pitch?, images?: {waveform, spectrogram}, source}
 */
export function analyze(input, options = {}) {
  let audio, loop = options.loop ?? null, doc = null, source;
  if (Buffer.isBuffer(input)) { audio = decodeWav(input); source = 'wav'; }
  else if (documentKind(input)) {
    doc = input;
    const render = renderDocument(doc);
    audio = audioFromPcm(render.pcm, render.sampleRate);
    loop = loop ?? render.loop;
    source = 'document:' + documentKind(doc);
  } else if (input?.pcm) { audio = audioFromPcm(input.pcm, input.sampleRate); loop = loop ?? input.loop; source = 'render'; }
  else if (input?.samples) { audio = input; source = 'decoded'; }
  else throw Object.assign(new Error('analyze needs a WAV buffer, decoded audio, a render result or an audio document'), {code: 'bad_input'});

  const measurements = measure(audio, {loop, spectrum: options.spectrum});
  const result = {source, measurements};
  if (doc && documentKind(doc) === 'score') result.pitch = pitchCheck(doc);
  if (options.images !== false) {
    const marks = loop ? {loop} : {onsetFrame: measurements.onset?.frame, tailEndFrame: measurements.tail?.endExclusive};
    const width = options.width ?? 1000;
    result.images = {waveform: waveformPng(audio, {width, marks}), spectrogram: spectrogramPng(audio, {width, marks})};
  }
  return result;
}
