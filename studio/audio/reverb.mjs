// Reverbs that wrap: every tail is circular on the buffer, so a loop's join carries the reverb.
// `circular` true wraps indices modulo the length (loops); false lets the tail fall off the end
// (one-shots render with enough length to hold it).
import { msToFrames, roundEven } from './util.mjs';
import { Mt19937 } from './rng.mjs';
import { fft } from './fft.mjs';

/**
 * Reflection taps: out += gain * channelsSwapped(dry) delayed by ms. All taps read the dry mix.
 * `cross` swaps left and right (stereo only). `dry` is an array of Float64Array.
 */
function taps(dry, spec, rate, circular) {
  const n = dry[0].length;
  const out = dry.map(c => Float64Array.from(c));
  for (const tap of spec.taps) {
    const shift = roundEven(rate * (tap.ms / 1000));
    for (let c = 0; c < dry.length; c++) {
      const src = tap.cross && dry.length === 2 ? dry[1 - c] : dry[c];
      for (let i = 0; i < n; i++) {
        let j = i - shift;
        if (j < 0) { if (!circular) continue; j = ((j % n) + n) % n; }
        out[c][i] += tap.gain * src[j];
      }
    }
  }
  return out;
}

/** Schroeder-style room: parallel damped feedback combs into series all-passes, decorrelated per channel. */
function feedback(dry, spec, rate, circular) {
  const n = dry[0].length;
  const spread = spec.spreadMs ?? 0.7;
  const wetOut = [];
  dry.forEach((chan, c) => {
    const combs = spec.combs.map(k => ({
      delay: msToFrames(k.ms + c * spread, rate), fb: k.feedback, damp: k.damp ?? 0, store: 0
    }));
    const aps = (spec.allpasses ?? []).map(k => ({delay: msToFrames(k.ms + c * spread, rate), g: k.gain}));
    combs.forEach(k => { k.buf = new Float64Array(k.delay); k.pos = 0; });
    aps.forEach(k => { k.buf = new Float64Array(k.delay); k.pos = 0; });
    // Warm-up passes make the state periodic so the tail wraps across the loop join: run until the
    // slowest comb has decayed 80 dB, then keep only the last pass.
    const decay = Math.max(...combs.map(k => k.delay * Math.log(1e-4) / Math.log(Math.max(1e-6, Math.min(0.999999, Math.abs(k.fb))))));
    const out = new Float64Array(n);
    const total = circular ? 1 + Math.ceil(decay / n) : 1;
    for (let pass = 0; pass < total; pass++) {
      for (let i = 0; i < n; i++) {
        const x = chan[i] * (spec.inputGain ?? 0.25);
        let s = 0;
        for (const k of combs) {
          const v = k.buf[k.pos];
          k.store = v * (1 - k.damp) + k.store * k.damp;
          k.buf[k.pos] = x + k.store * k.fb;
          if (++k.pos >= k.delay) k.pos = 0;
          s += v;
        }
        for (const k of aps) {
          const v = k.buf[k.pos];
          const y = -s + v;
          k.buf[k.pos] = s + v * k.g;
          if (++k.pos >= k.delay) k.pos = 0;
          s = y;
        }
        out[i] = s;
      }
    }
    wetOut.push(out);
  });
  return dry.map((c, ch) => c.map((v, i) => v * (spec.dry ?? 1) + wetOut[ch][i] * (spec.wet ?? 0.3)));
}

/** Seeded gaussian noise (Box-Muller over the integer PRNG), shaped into a decaying impulse response of unit energy. */
export function impulseResponse(spec, rate, channel) {
  const n = roundEven(spec.seconds * rate), rng = new Mt19937(spec.seeds[channel % spec.seeds.length]);
  const raw = new Float64Array(n), attack = (spec.attackMs ?? 8) / 1000;
  for (let i = 0; i < n; i++) {
    const u = 1 - rng.random(), v = rng.random(), t = i / rate;
    raw[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * Math.exp(-spec.decayPerSecond * t) * -Math.expm1(-t / attack);
  }
  const taps = spec.smoothTaps ?? 1, ir = new Float64Array(n), start = (taps - 1) >> 1;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < taps; j++) { const k = i + start - j; if (k >= 0 && k < n) sum += raw[k] / taps; }
    ir[i] = sum; energy += sum * sum;
  }
  const norm = 1 / Math.sqrt(energy);
  for (let i = 0; i < n; i++) ir[i] *= norm;
  return ir;
}

/** Convolution with a seeded noise impulse response (FFT). Circular for loops: the tail past the end folds onto the start. */
function impulse(dry, spec, rate, circular) {
  const n = dry[0].length;
  return dry.map((chan, c) => {
    const ir = impulseResponse(spec, rate, c), full = n + ir.length - 1;
    let size = 1;
    while (size < full) size <<= 1;
    const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
    ar.set(chan); br.set(ir);
    fft(ar, ai); fft(br, bi);
    for (let k = 0; k < size; k++) { const re = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = -(ar[k] * bi[k] + ai[k] * br[k]); ar[k] = re; }
    fft(ar, ai); // conjugate trick: forward FFT of the conjugated product, conjugated and scaled, is the inverse
    const wet = new Float64Array(n);
    for (let i = 0; i < full; i++) {
      const v = ar[i] / size;
      if (i < n) wet[i] += v; else if (circular) wet[i % n] += v;
    }
    return chan.map((v, i) => v * (spec.dry ?? 1) + wet[i] * (spec.wet ?? 0.3));
  });
}

export function applyReverb(dry, spec, rate, {circular}) {
  if (!spec) return dry;
  if (spec.type === 'taps') return taps(dry, spec, rate, circular);
  if (spec.type === 'impulse') return impulse(dry, spec, rate, circular);
  if (spec.type === 'feedback') return feedback(dry, spec, rate, circular);
  throw new RangeError(`Unknown reverb ${spec.type}`);
}
