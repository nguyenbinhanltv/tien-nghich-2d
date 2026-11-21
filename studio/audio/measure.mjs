// Measurements returned as data. All figures come from the decoded PCM, not from the renderer, so the same
// functions measure a render, a delivered master or any WAV.
import { dbfsFromLinear, round2, round3 } from './util.mjs';
import { welch } from './fft.mjs';

const FULL = 32768;
const lin = x => x > 0 ? 10 * Math.log10(x) : -Infinity;

// ---- ITU-R BS.1770-4 K-weighting (RLB high pass after the head-related shelf) --------------------
/** Biquad coefficients [b0,b1,b2,a1,a2] for both stages at any sample rate (analog prototype + bilinear transform). */
export function kWeightCoefs(rate) {
  const shelf = (() => {
    const G = 3.999843853973347, Q = 0.7071752369554196, fc = 1681.9744509555319;
    const K = Math.tan(Math.PI * fc / rate), Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
    const a0 = 1 + K / Q + K * K;
    return [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  })();
  const high = (() => {
    const Q = 0.5003270373238773, fc = 38.13547087613982;
    const K = Math.tan(Math.PI * fc / rate), a0 = 1 + K / Q + K * K;
    return [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
  })();
  return [shelf, high];
}

function biquad(x, [b0, b1, b2, a1, a2]) {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

const percentile = (sorted, p) => {
  const pos = (sorted.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/**
 * Integrated loudness (BS.1770-4: 400 ms blocks, 75 % overlap, -70 LUFS absolute gate, -10 LU relative gate),
 * momentary maximum and loudness range (EBU Tech 3342: 3 s windows, -20 LU relative gate, 10th to 95th percentile).
 * Channel weights are 1 for every channel (mono, stereo). Integrated, momentary and range are null when the signal is
 * shorter than one 400 ms block (3 s for range); `ungatedLufs` (K-weighted mean square of the whole file, no gating)
 * is always present and is the figure to compare short cues by.
 */
export function loudness(channels, rate) {
  const n = channels[0].length, block = Math.round(0.4 * rate), step = Math.round(0.1 * rate);
  const coefs = kWeightCoefs(rate);
  const sq = channels.map(c => { const z = biquad(biquad(c, coefs[0]), coefs[1]); for (let i = 0; i < n; i++) z[i] *= z[i]; return z; });
  const prefix = sq.map(z => { const p = new Float64Array(n + 1); for (let i = 0; i < n; i++) p[i + 1] = p[i] + z[i]; return p; });
  const energy = len => {
    const out = [];
    for (let at = 0; at + len <= n; at += step) {
      let e = 0;
      for (const p of prefix) e += (p[at + len] - p[at]) / len;
      out.push(e);
    }
    return out;
  };
  const blocks = energy(block);
  const whole = prefix.reduce((a, p) => a + p[n] / n, 0);
  const result = {ungatedLufs: whole > 0 ? round2(-0.691 + lin(whole)) : null, integratedLufs: null, momentaryMaxLufs: null, loudnessRangeLu: null, blocks: blocks.length, gatedBlocks: 0};
  if (blocks.length) {
    const l = e => -0.691 + lin(e);
    result.momentaryMaxLufs = round2(l(Math.max(...blocks)));
    const abs = blocks.filter(e => l(e) > -70);
    if (abs.length) {
      const rel = l(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
      const kept = abs.filter(e => l(e) > rel);
      result.gatedBlocks = kept.length;
      if (kept.length) result.integratedLufs = round2(l(kept.reduce((a, b) => a + b, 0) / kept.length));
    }
  }
  const short = energy(Math.round(3 * rate));
  if (short.length) {
    const l = e => -0.691 + lin(e);
    const abs = short.filter(e => l(e) > -70);
    if (abs.length) {
      const rel = l(abs.reduce((a, b) => a + b, 0) / abs.length) - 20;
      const vals = abs.map(l).filter(v => v > rel).sort((a, b) => a - b);
      if (vals.length) result.loudnessRangeLu = round2(percentile(vals, 0.95) - percentile(vals, 0.10));
    }
  }
  return result;
}

// ---- true peak (estimate) -----------------------------------------------------------------------
const TP_HALF = 12;
const TP_KERNEL = (() => {
  // Four-times oversampling: Hann-windowed sinc, 24 taps per phase. BS.1770 Annex 2 uses a 48-tap polyphase
  // FIR; this is a different but equivalent-purpose interpolator, so the figure is an estimate.
  const phases = [];
  for (let ph = 1; ph < 4; ph++) {
    const f = ph / 4, taps = [];
    for (let k = -TP_HALF + 1; k <= TP_HALF; k++) {
      const x = f - k;
      taps.push((Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 + 0.5 * Math.cos(Math.PI * x / TP_HALF)));
    }
    phases.push(taps);
  }
  return phases;
})();

/** Estimated true peak in full-scale units (|x| <= 1 means 0 dBTP). `circular` wraps the edges (loops). */
export function truePeak(channel, circular = false) {
  const n = channel.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(channel[i]));
  const at = i => circular ? channel[((i % n) + n) % n] : (i >= 0 && i < n ? channel[i] : 0);
  for (let i = 0; i < n; i++) {
    for (const taps of TP_KERNEL) {
      let s = 0;
      for (let k = 0; k < taps.length; k++) s += taps[k] * at(i + k - TP_HALF + 1);
      peak = Math.max(peak, Math.abs(s));
    }
  }
  return peak;
}

// ---- spectrum -----------------------------------------------------------------------------------
export const DEFAULT_BANDS = [[0, 100], [100, 450], [450, 1600], [1600, 5000], [5000, Infinity]];

/** Mono energy share per band in dB of the total, spectral centroid, and the -3 dB rolloff frequency. */
export function spectrum(channels, rate, bands = DEFAULT_BANDS) {
  const n = channels[0].length, mono = new Float64Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
  const size = 4096, power = welch(mono, size), hz = k => k * rate / size;
  let total = 0, weighted = 0;
  for (let k = 0; k < power.length; k++) { total += power[k]; weighted += power[k] * hz(k); }
  const shares = bands.map(([lo, hi]) => {
    let e = 0;
    for (let k = 0; k < power.length; k++) if (hz(k) >= lo && hz(k) < hi) e += power[k];
    return {fromHz: lo, toHz: Number.isFinite(hi) ? hi : rate / 2, db: total > 0 ? round2(lin(e / total)) : null};
  });
  let run = 0, roll = 0;
  for (let k = 0; k < power.length; k++) { run += power[k]; if (run >= 0.99 * total) { roll = hz(k); break; } }
  return {bandsDb: shares, centroidHz: total > 0 ? Math.round(weighted / total) : null, rolloff99Hz: Math.round(roll)};
}

// ---- the whole report ---------------------------------------------------------------------------
const quiet = Math.round(FULL * 10 ** (-60 / 20));

/**
 * Measure decoded audio. `audio` is {sampleRate, samples: Float64Array[] (units of full scale), pcm16?: Int16Array[]}.
 * `options.loop` is {start, end} (half-open, frames) for beds; `options.spectrum` false skips the FFT.
 */
export function measure(audio, options = {}) {
  const {sampleRate: rate, samples} = audio;
  const channels = samples.length, frames = samples[0].length;
  const ints = audio.pcm16 ?? samples.map(c => Int16Array.from(c, v => Math.max(-FULL, Math.min(FULL - 1, Math.round(v * FULL)))));
  const perPeak = ints.map(c => { let p = 0; for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i])); return p; });
  const samplePeak = Math.max(...perPeak);
  let clipped = 0;
  for (const c of ints) for (let i = 0; i < c.length; i++) if (c[i] >= 32767 || c[i] <= -32768) clipped++;

  let sum = 0;
  const perRms = ints.map(c => { let s = 0; for (let i = 0; i < c.length; i++) s += c[i] * c[i]; sum += s; return Math.sqrt(s / frames); });
  // Onset and tail: bounds of the nonzero PCM, plus the first/last frame above -60 dBFS.
  let first = -1, last = -1, loud0 = -1, loud1 = -1;
  for (let i = 0; i < frames; i++) {
    let nz = false, big = false;
    for (let c = 0; c < channels; c++) { const a = Math.abs(ints[c][i]); if (a) nz = true; if (a >= quiet) big = true; }
    if (nz) { if (first < 0) first = i; last = i; }
    if (big) { if (loud0 < 0) loud0 = i; loud1 = i; }
  }
  let activeSum = 0;
  if (first >= 0) for (const c of ints) for (let i = first; i <= last; i++) activeSum += c[i] * c[i];
  const activeFrames = first >= 0 ? last - first + 1 : 0;
  const ms = f => round3(f * 1000 / rate);

  const circular = Boolean(options.loop);
  const tp = Math.max(...samples.map(c => truePeak(c, circular)));
  const report = {
    sampleRate: rate, channels, frames, durationMs: ms(frames),
    peak: {
      sample: samplePeak, sampleDbfs: dbfsFromLinear(samplePeak, FULL), perChannel: perPeak,
      truePeakDbtp: dbfsFromLinear(tp), truePeakMethod: '4x oversampled Hann-windowed sinc (24 taps per phase), an estimate of BS.1770 Annex 2',
      clippedSamples: clipped
    },
    rms: {dbfs: dbfsFromLinear(Math.sqrt(sum / (frames * channels)), FULL), activeDbfs: activeFrames ? dbfsFromLinear(Math.sqrt(activeSum / (activeFrames * channels)), FULL) : null,
      perChannelDbfs: perRms.map(v => dbfsFromLinear(v, FULL))},
    loudness: loudness(samples, rate),
    endpoints: {firstFrame: ints.map(c => c[0]), lastFrame: ints.map(c => c[frames - 1]),
      digitalZeroStart: ints.every(c => c[0] === 0), digitalZeroEnd: ints.every(c => c[frames - 1] === 0)},
    onset: first < 0 ? null : {frame: first, ms: ms(first), audibleFrame: loud0, audibleMs: loud0 < 0 ? null : ms(loud0)},
    tail: first < 0 ? null : {endExclusive: last + 1, ms: ms(last + 1), silentFrames: frames - last - 1, lastAudibleFrame: loud1,
      decayBelow60DbMs: loud1 < 0 ? null : ms(loud1 - loud0)}
  };
  if (options.spectrum !== false) report.spectrum = spectrum(samples, rate);
  if (options.loop) report.loop = seam(ints, rate, options.loop);
  return report;
}

/** Seam of a half-open loop [start, end): the step from the last frame back to the first, per channel, against the music's own steps. */
export function seam(ints, rate, loop) {
  const {start, end} = loop, window = Math.round(0.01 * rate);
  const perChannel = ints.map(c => {
    const firstPcm = c[start], lastPcm = c[end - 1], signedStep = firstPcm - lastPcm;
    // Steps across the seam region: the last `window` frames of the loop followed by its first `window` frames.
    let nearMax = 0;
    const at = i => c[start + (((i - start) % (end - start)) + (end - start)) % (end - start)];
    for (let i = end - window; i < end + window - 1; i++) nearMax = Math.max(nearMax, Math.abs(at(i + 1) - at(i)));
    const steps = new Float64Array(Math.min(end - start - 1, 400000));
    const stride = Math.max(1, Math.floor((end - start - 1) / steps.length));
    for (let j = 0; j < steps.length; j++) steps[j] = Math.abs(c[start + j * stride + 1] - c[start + j * stride]);
    steps.sort();
    return {firstPcm, lastPcm, signedStep, maxAbsStepWithin10ms: nearMax, interiorP99AbsStep: steps[Math.floor(steps.length * 0.99)],
      interiorMedianAbsStep: steps[Math.floor(steps.length * 0.5)]};
  });
  const worst = Math.max(...perChannel.map(p => Math.abs(p.signedStep)));
  const typical = Math.max(1, ...perChannel.map(p => p.interiorP99AbsStep));
  return {start, end, frames: end - start, perChannel, worstSeamStep: worst, seamToInteriorP99: round3(worst / typical),
    verdict: worst <= typical ? 'seam step is within the music\'s own step size' : 'seam step exceeds the music\'s own p99 step: expect an audible click'};
}
