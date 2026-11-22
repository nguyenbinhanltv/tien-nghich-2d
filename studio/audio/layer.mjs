// One synthesis layer: an oscillator or a noise source, optional filter chain, envelope and
// amplitude flutter. Used by one-shot patches (fixed length) and by score instruments (one note).
// Everything is plain float64 arithmetic in a fixed order; transcendental functions are V8's
// bundled fdlibm ports, not the platform libm.
import { roundEven, msToFrames } from './util.mjs';

const TAU = 2 * Math.PI;

function polyBlep(p, dt) {
  if (p < dt) { const x = p / dt; return x + x - x * x - 1; }
  if (p > 1 - dt) { const x = (p - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

function shape(wave, phase, dt) {
  if (wave === 'sine') return Math.sin(phase);
  const p = (phase / TAU) % 1;
  if (wave === 'saw') return 2 * p - 1 - polyBlep(p, dt);
  if (wave === 'square') return (p < 0.5 ? 1 : -1) + polyBlep(p, dt) - polyBlep((p + 0.5) % 1, dt);
  return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4; // triangle
}

/** Additive partial table: [{n, gain, decay}] from the explicit list or the generator form. */
export function partialTable(spec) {
  if (Array.isArray(spec)) return spec.map(h => ({n: h.n, gain: h.gain ?? 1, decay: h.decay ?? 0}));
  const out = [];
  for (let n = 1; n <= spec.count; n++) {
    const pick = spec.pickPosition === undefined ? 1 : Math.sin(spec.pickPosition * Math.PI * n);
    out.push({n, gain: pick / n ** (spec.rolloff ?? 0), decay: (spec.decayBase ?? 0) + n * (spec.decayStep ?? 0)});
  }
  return out;
}

function oscillator(layer, o) {
  const {rate, length, rng, noteHz} = o;
  const out = new Float64Array(length);
  const wave = layer.wave ?? 'sine';
  let hz = layer.hz ?? noteHz * layer.ratio;
  const endHz = layer.endHz ?? (layer.endRatio === undefined ? undefined : noteHz * layer.endRatio);
  const glide = endHz === undefined ? 1 : (length > 1 ? (endHz / hz) ** (1 / (length - 1)) : 1);
  const fm = layer.fm, vib = layer.vibrato, scoop = layer.scoop;
  const parts = wave === 'additive' ? partialTable(layer.harmonics) : null;
  const offsets = parts && parts.map(h => (layer.partialPhase?.slope ?? 0) * h.n + (layer.partialPhase?.random ? rng.uniform(0, layer.partialPhase.random) : 0));
  let phase = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    let inst = hz;
    if (scoop) inst *= 1 + scoop.depth * Math.exp(-t / (scoop.tauMs / 1000));
    if (vib) inst *= 1 + vib.depth * Math.sin(TAU * vib.hz * t) * (vib.riseMs ? 1 - Math.exp(-t / (vib.riseMs / 1000)) : 1);
    let s;
    if (parts) {
      s = 0;
      for (let k = 0; k < parts.length; k++) {
        const h = parts[k];
        s += h.gain * Math.sin(h.n * phase + offsets[k]) * (h.decay ? Math.exp(-h.decay * t) : 1);
      }
    } else if (fm) {
      s = Math.sin(phase + fm.index * Math.sin(phase * fm.ratio));
    } else {
      s = shape(wave, phase, inst / rate);
    }
    out[i] = s;
    phase += TAU * inst / rate;
    hz *= glide;
  }
  return out;
}

// ---- filters (applied in order to the raw source) -------------------------------------------

const onePoleCoef = (hz, rate) => -Math.expm1(-TAU * hz / rate);

function biquadCoefs(mode, hz, q, rate) {
  const w = TAU * hz / rate, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (mode === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
  else if (mode === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
  else if (mode === 'bandpass') { b0 = alpha; b1 = 0; b2 = -alpha; }
  else { b0 = 1; b1 = -2 * cos; b2 = 1; } // notch
  const a0 = 1 + alpha;
  return [b0 / a0, b1 / a0, b2 / a0, -2 * cos / a0, (1 - alpha) / a0];
}

function applyFilter(f, x, rate) {
  const n = x.length, y = new Float64Array(n);
  switch (f.type) {
    case 'lowpass1': case 'highpass1': {
      const sweep = f.endHz !== undefined;
      let hz = f.hz, a = onePoleCoef(hz, rate), s = 0;
      const step = sweep && n > 1 ? (f.endHz / f.hz) ** (1 / (n - 1)) : 1;
      for (let i = 0; i < n; i++) {
        if (sweep) { a = onePoleCoef(hz, rate); hz *= step; }
        s += a * (x[i] - s);
        y[i] = f.type === 'lowpass1' ? s : x[i] - s;
      }
      return y;
    }
    case 'band': { // difference of two one-pole low passes: low pass at highHz minus low pass at lowHz
      const slowA = onePoleCoef(f.lowHz, rate), fastA = onePoleCoef(f.highHz, rate);
      let slow = 0, fast = 0;
      for (let i = 0; i < n; i++) {
        fast += fastA * (x[i] - fast);
        slow += slowA * (x[i] - slow);
        y[i] = fast - slow;
      }
      return y;
    }
    case 'biquad': {
      const sweep = f.endHz !== undefined, q = f.q ?? Math.SQRT1_2;
      let hz = f.hz, c = biquadCoefs(f.mode, hz, q, rate), x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      const step = sweep && n > 1 ? (f.endHz / f.hz) ** (1 / (n - 1)) : 1;
      for (let i = 0; i < n; i++) {
        if (sweep) { c = biquadCoefs(f.mode, hz, q, rate); hz *= step; }
        const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
        y[i] = v;
      }
      return y;
    }
    case 'box': case 'fir': {
      const taps = f.type === 'box' ? new Array(f.taps).fill(1 / f.taps) : f.taps;
      const k = taps.length, start = f.align === 'causal' ? 0 : (k - 1) >> 1; // 'same' = numpy.convolve(..., "same")
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < k; j++) {
          const idx = i + start - j;
          if (idx >= 0 && idx < n) s += taps[j] * x[idx];
        }
        y[i] = s;
      }
      return y;
    }
    default: throw new RangeError(`Unknown filter ${f.type}`);
  }
}

// ---- envelope ---------------------------------------------------------------------------------

/**
 * Render one layer into a float64 buffer of `length` frames.
 * o: {rate, length, rng, noteHz?, gateSec?}. `gateSec` is set for score notes (release "exp" starts there).
 */
export function renderLayer(layer, o) {
  const {rate, length, gateSec} = o;
  let x;
  if (layer.type === 'osc') x = oscillator(layer, o);
  else { x = new Float64Array(length); for (let i = 0; i < length; i++) x[i] = o.rng.signed(); }
  for (const f of layer.filters ?? []) x = applyFilter(f, x, rate);

  const env = layer.env ?? {}, gain = layer.gain ?? 1, am = layer.am;
  const attack = env.attackMs === undefined ? 0 : msToFrames(env.attackMs, rate);
  const expAttack = env.attackShape === 'exp';
  const tauA = (env.attackMs ?? 0) / 1000;
  const decay = env.decayMs === undefined ? 0 : msToFrames(env.decayMs, rate);
  const release = env.releaseMs === undefined ? 0 : msToFrames(env.releaseMs, rate);
  const expRelease = env.releaseShape === 'exp';
  const lvl = env.level;
  for (let i = 0; i < length; i++) {
    let e = 1;
    if (attack) e = expAttack ? -Math.expm1(-(i / rate) / tauA) : Math.min(1, i / attack);
    if (release && !expRelease) e = Math.min(e, (length - 1 - i) / release);
    if (release && expRelease) {
      const over = i / rate - (gateSec ?? 0);
      if (over > 0) e *= Math.exp(-over / (env.releaseMs / 1000));
    }
    let v = x[i] * gain * e;
    if (decay) v *= Math.exp(-i / decay);
    if (lvl) v *= lvl.to + (lvl.from - lvl.to) * Math.exp(-(i / rate) / (lvl.tauMs / 1000));
    if (am) v *= 1 - am.depth * (0.5 + 0.5 * Math.cos(TAU * am.hz * i / rate));
    x[i] = v;
  }
  return x;
}

export const layerFrames = (ms, rate) => msToFrames(ms, rate);
export { roundEven };
