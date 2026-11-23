// Identity drift for drawn-key clips. Pixel churn between drawn poses is expected to exceed churn between rig keys,
// so the A-B-A flicker gate (tuned for rig keys) is not applied to them by default. This measures the same thing in a
// way that suits drawn keys: how much of the interior changes colour from key to key, and how far the colour mix moves.
import { alphaAt, getRgb, isColor, sameRgb } from '../image.mjs';

// Calibrated on the drawn clips in the repo (docs/FORGE_BAKEOFF.md, "Drawn-clip gates: calibration"): the limits sit between the
// worst number of the Codex retest walk after its patches (change 0.315, shift 0.090) and the best of the same walk before them
// (change 0.407, shift 0.110). They were 0.6 and off before.
export const defaultDrift = {maxInteriorChange: 0.36, maxColorShift: 0.10};

// `ink` is null for a project without an outline: nothing is excluded then.
const isInk = (frame, x, y, ink) => ink !== null && ink !== undefined && isColor(frame, x, y, ink);

function histogram(frame, ink) {
  const counts = new Map();
  let total = 0;
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    if (alphaAt(frame, x, y) !== 255 || isInk(frame, x, y, ink)) continue;
    const key = getRgb(frame, x, y).join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  return {counts, total};
}

/**
 * Per consecutive pair of keys (the loop wraps when `unit.loop`): interiorChange = share of the pixels that are interior in
 * both keys whose colour differs; colorShift = half the L1 distance between the interior colour distributions (0 same mix, 1 disjoint).
 * Returns {metrics: {interiorChange, colorShift} (the worst pair), findings}. Findings are warnings, never errors.
 */
export function identityDrift(unit, {palette}, options = {}) {
  const o = {...defaultDrift, ...options}, ink = palette.outline, n = unit.frames.length;
  const pairs = Array.from({length: unit.loop ? n : n - 1}, (_, i) => [i, (i + 1) % n]);
  const hist = unit.frames.map(f => histogram(f, ink));
  let worstChange = 0, worstShift = 0;
  const findings = [];
  for (const [a, b] of pairs) {
    const fa = unit.frames[a], fb = unit.frames[b];
    let shared = 0, changed = 0;
    const pixels = [];
    for (let y = 0; y < fa.height; y++) for (let x = 0; x < fa.width; x++) {
      if (alphaAt(fa, x, y) !== 255 || alphaAt(fb, x, y) !== 255 || isInk(fa, x, y, ink) || isInk(fb, x, y, ink)) continue;
      shared++;
      if (!sameRgb(getRgb(fa, x, y), getRgb(fb, x, y))) { changed++; pixels.push([x, y]); }
    }
    const change = shared ? changed / shared : 0;
    const keys = new Set([...hist[a].counts.keys(), ...hist[b].counts.keys()]);
    let l1 = 0;
    for (const k of keys) l1 += Math.abs((hist[a].counts.get(k) ?? 0) / (hist[a].total || 1) - (hist[b].counts.get(k) ?? 0) / (hist[b].total || 1));
    const shift = l1 / 2;
    worstChange = Math.max(worstChange, change); worstShift = Math.max(worstShift, shift);
    const base = {gate: 'identity_drift', severity: 'warn', clip: unit.clip, facing: unit.facing, frame: a, frameTo: b, pixels: pixels.slice(0, 40)};
    if (o.maxInteriorChange !== null && change > o.maxInteriorChange)
      findings.push({...base, measured: +change.toFixed(3), limit: o.maxInteriorChange, message: `${(change * 100).toFixed(0)}% of the shared interior changes colour from key ${a} to ${b}`});
    if (o.maxColorShift !== null && shift > o.maxColorShift)
      findings.push({...base, pixels: [], measured: +shift.toFixed(3), limit: o.maxColorShift, message: `the interior colour mix moves ${(shift * 100).toFixed(0)}% from key ${a} to ${b}`});
  }
  return {metrics: {interiorChange: +worstChange.toFixed(3), colorShift: +worstShift.toFixed(3)}, findings};
}
