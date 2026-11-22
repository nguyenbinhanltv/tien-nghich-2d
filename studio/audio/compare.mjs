// compare(): how close is one rendering to another, by envelope, spectrum and loudness (not bytes).
// Also reports the sample-exact facts so a byte-identical pair is recognised for what it is.
import { welch } from './fft.mjs';
import { measure } from './measure.mjs';
import { round2, round3 } from './util.mjs';

const mono = audio => {
  const n = audio.samples[0].length, out = new Float64Array(n);
  for (const c of audio.samples) for (let i = 0; i < n; i++) out[i] += c[i] / audio.samples.length;
  return out;
};
const db = x => x > 0 ? Math.max(-100, 20 * Math.log10(x)) : -100;

function envelopeDb(x, window) {
  const out = [];
  for (let at = 0; at + window <= x.length; at += window) {
    let s = 0;
    for (let i = at; i < at + window; i++) s += x[i] * x[i];
    out.push(db(Math.sqrt(s / window)));
  }
  return out;
}

const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : (saa === sbb ? 1 : 0);
};

function thirdOctaves(power, rate, size) {
  const bands = [];
  for (let c = 50; c * 2 ** (1 / 6) < rate / 2; c *= 2 ** (1 / 3)) {
    const lo = c / 2 ** (1 / 6), hi = c * 2 ** (1 / 6);
    let e = 0;
    for (let k = 0; k < power.length; k++) { const f = k * rate / size; if (f >= lo && f < hi) e += power[k]; }
    bands.push({centreHz: Math.round(c), power: e});
  }
  return bands;
}

/**
 * @param a, b decoded audio ({sampleRate, samples, pcm16?}); `a` is the reference (for example the delivered master)
 * @param options {envelopeMs = 10, floorDb = -60}
 */
export function compare(a, b, {envelopeMs = 10, floorDb = -60} = {}) {
  if (a.sampleRate !== b.sampleRate || a.samples.length !== b.samples.length)
    throw new RangeError('compare needs the same sample rate and channel count');
  const rate = a.sampleRate, na = a.samples[0].length, nb = b.samples[0].length, n = Math.min(na, nb);
  let differing = 0, maxLsb = 0;
  if (a.pcm16 && b.pcm16) for (let c = 0; c < a.pcm16.length; c++) for (let i = 0; i < n; i++) {
    const d = Math.abs(a.pcm16[c][i] - b.pcm16[c][i]);
    if (d) { differing++; if (d > maxLsb) maxLsb = d; }
  }
  const identical = {frames: na === nb, differingSamples: a.pcm16 && b.pcm16 ? differing : null, maxAbsLsb: a.pcm16 && b.pcm16 ? maxLsb : null,
    sampleExact: na === nb && differing === 0 && Boolean(a.pcm16 && b.pcm16)};

  const window = Math.max(1, Math.round(rate * envelopeMs / 1000));
  const ea = envelopeDb(mono(a).subarray(0, n), window), eb = envelopeDb(mono(b).subarray(0, n), window);
  const live = ea.map((v, i) => Math.max(v, eb[i]) > floorDb);
  const xa = ea.filter((_, i) => live[i]), xb = eb.filter((_, i) => live[i]);
  const diffs = xa.map((v, i) => Math.abs(v - xb[i]));
  const envelope = {windowMs: envelopeMs, windows: xa.length, floorDb,
    correlation: xa.length > 1 ? round3(pearson(xa, xb)) : null,
    meanAbsDb: diffs.length ? round2(diffs.reduce((p, q) => p + q, 0) / diffs.length) : null,
    maxAbsDb: diffs.length ? round2(Math.max(...diffs)) : null};

  const size = 4096, pa = welch(mono(a).subarray(0, n), size), pb = welch(mono(b).subarray(0, n), size);
  const ta = thirdOctaves(pa, rate, size), tb = thirdOctaves(pb, rate, size);
  const topA = Math.max(...ta.map(x => x.power));
  const used = ta.map((x, i) => ({x, y: tb[i]})).filter(({x, y}) => Math.max(x.power, y.power) > topA * 1e-6);
  const dd = used.map(({x, y}) => 10 * Math.log10((x.power || 1e-30) / (y.power || 1e-30)));
  const spectrumDiff = {thirdOctaveBandsUsed: used.length,
    rmsDiffDb: dd.length ? round2(Math.sqrt(dd.reduce((p, q) => p + q * q, 0) / dd.length)) : null,
    maxAbsDiffDb: dd.length ? round2(Math.max(...dd.map(Math.abs))) : null};

  const ma = measure(a, {spectrum: true}), mb = measure(b, {spectrum: true});
  const bandDiffDb = ma.spectrum.bandsDb.map((band, i) => ({fromHz: band.fromHz, toHz: band.toHz, a: band.db, b: mb.spectrum.bandsDb[i].db,
    diff: band.db === null || mb.spectrum.bandsDb[i].db === null ? null : round2(mb.spectrum.bandsDb[i].db - band.db)}));
  const sub = (x, y) => x === null || y === null || x === undefined || y === undefined ? null : round2(y - x);
  const levels = {
    samplePeakDbDiff: sub(ma.peak.sampleDbfs, mb.peak.sampleDbfs), truePeakDbDiff: sub(ma.peak.truePeakDbtp, mb.peak.truePeakDbtp),
    rmsDbDiff: sub(ma.rms.dbfs, mb.rms.dbfs), ungatedLufsDiff: sub(ma.loudness.ungatedLufs, mb.loudness.ungatedLufs),
    integratedLufsDiff: sub(ma.loudness.integratedLufs, mb.loudness.integratedLufs),
    a: {samplePeakDbfs: ma.peak.sampleDbfs, truePeakDbtp: ma.peak.truePeakDbtp, rmsDbfs: ma.rms.dbfs, ungatedLufs: ma.loudness.ungatedLufs, integratedLufs: ma.loudness.integratedLufs},
    b: {samplePeakDbfs: mb.peak.sampleDbfs, truePeakDbtp: mb.peak.truePeakDbtp, rmsDbfs: mb.rms.dbfs, ungatedLufs: mb.loudness.ungatedLufs, integratedLufs: mb.loudness.integratedLufs}
  };
  return {sampleRate: rate, frames: {a: na, b: nb}, identical, envelope, spectrum: {...spectrumDiff, bandsDb: bandDiffDb}, levels};
}
