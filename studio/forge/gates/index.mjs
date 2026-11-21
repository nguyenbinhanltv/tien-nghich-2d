// Animation gates as a library. Every gate returns structured findings with frame indices and pixel
// coordinates; nothing here prints or throws on a failed check.
//
// A "unit" is one clip of one facing as the baker returns it:
//   {clip, facing, loop, frames: [Frame], contacts: [[{id, xy, planted}]], poses?}
// The context carries what the gates need to know about the rig and palette:
//   {palette, facing: <rig facing>, pivot: [x, y]}
//
// Finding: {gate, severity: "error"|"warn", clip, facing, frame, frameTo?, pixels: [[x, y]], message, measured?, limit?}
import { alphaAt, bounds, getRgb, isColor, luma, sameRgb } from '../rig/raster.mjs';

export const defaultOptions = {
  footSlide: {},
  pivotDrift: {tolerance: 2},
  flicker: {maxPixels: 10},
  loopSeam: {factor: 1.25, margin: 0.03},
  markSide: {},
  stability: {maxSizeDelta: 0.5, maxNewColors: 0},
  silhouetteContrast: {minRatio: 1.5, maxLowEdgeFraction: 0.5},
  featureContrast: {},
  weightTransfer: {minBodyTravel: 1}
};

const cap = (list, n = 40) => list.slice(0, n);
const ring = (n, loop) => Array.from({length: loop ? n : n - 1}, (_, i) => [i, (i + 1) % n]);

function finding(unit, gate, fields, severity = 'error') {
  return {gate, severity, clip: unit.clip, facing: unit.facing, ...fields};
}

/** Planted contacts must not move between adjacent keys (including the wrap of a loop) and must stay opaque. */
export function footSlide(unit) {
  const out = [];
  const {frames, contacts} = unit;
  for (const [i, j] of ring(frames.length, unit.loop)) {
    contacts[i].forEach((a, k) => {
      const b = contacts[j][k];
      if (a.planted && b.planted && (a.xy[0] !== b.xy[0] || a.xy[1] !== b.xy[1])) {
        out.push(finding(unit, 'foot_slide', {frame: i, frameTo: j, pixels: [a.xy, b.xy], contact: a.id,
          measured: Math.abs(a.xy[0] - b.xy[0]) + Math.abs(a.xy[1] - b.xy[1]), limit: 0,
          message: `planted contact ${a.id} slid from ${a.xy} to ${b.xy} between keys ${i} and ${j}`}));
      }
    });
  }
  frames.forEach((frame, i) => contacts[i].forEach(c => {
    if (c.planted && alphaAt(frame, c.xy[0], c.xy[1]) !== 255) {
      out.push(finding(unit, 'foot_slide', {frame: i, pixels: [c.xy], contact: c.id, message: `planted contact ${c.id} has no pixel at ${c.xy} in key ${i}`}));
    }
  }));
  return out;
}

/** The silhouette centre must stay put, and the pivot column must stay under the body, on every key. */
export function pivotDrift(unit, ctx, options = defaultOptions.pivotDrift) {
  const out = [];
  const boxes = unit.frames.map(f => bounds(f));
  const centers = boxes.map(([x0, y0, x1, y1]) => [(x0 + x1) / 2, (y0 + y1) / 2]);
  for (const [axis, name] of [[0, 'x'], [1, 'y']]) {
    const values = centers.map(c => c[axis]);
    const lo = Math.min(...values), hi = Math.max(...values);
    if (hi - lo > options.tolerance) {
      const a = values.indexOf(lo), b = values.indexOf(hi);
      out.push(finding(unit, 'pivot_drift', {frame: a, frameTo: b, pixels: [[Math.floor(centers[a][0]), Math.floor(centers[a][1])], [Math.floor(centers[b][0]), Math.floor(centers[b][1])]],
        measured: hi - lo, limit: options.tolerance, message: `silhouette centre drifts ${hi - lo}px along ${name} between keys ${a} and ${b}`}));
    }
  }
  if (ctx.pivot) {
    boxes.forEach(([x0, , x1], i) => {
      if (ctx.pivot[0] < x0 || ctx.pivot[0] >= x1) out.push(finding(unit, 'pivot_drift', {frame: i, pixels: [ctx.pivot], message: `pivot column ${ctx.pivot[0]} is outside the silhouette (${x0}..${x1 - 1}) in key ${i}`}));
    });
  }
  return out;
}

const interior = (frame, x, y, ink) => alphaAt(frame, x, y) === 255 && !isColor(frame, x, y, ink);

/** Interior pixels that change for one key and revert (A, B, A) read as flicker. */
export function flicker(unit, ctx, options = defaultOptions.flicker) {
  const out = [];
  const n = unit.frames.length;
  if (n < 3) return out;
  const ink = ctx.palette.outline;
  const keys = unit.loop ? [...Array(n).keys()] : [...Array(n - 2).keys()].map(i => i + 1);
  for (const i of keys) {
    const before = unit.frames[(i + n - 1) % n], current = unit.frames[i], after = unit.frames[(i + 1) % n];
    const pixels = [];
    for (let y = 0; y < current.height; y++) for (let x = 0; x < current.width; x++) {
      if (!interior(before, x, y, ink) || !interior(current, x, y, ink) || !interior(after, x, y, ink)) continue;
      const b = getRgb(before, x, y), c = getRgb(current, x, y), a = getRgb(after, x, y);
      if (sameRgb(b, a) && !sameRgb(c, b)) pixels.push([x, y]);
    }
    if (pixels.length > options.maxPixels) {
      out.push(finding(unit, 'flicker', {frame: i, pixels: cap(pixels), measured: pixels.length, limit: options.maxPixels,
        message: `${pixels.length} interior pixels change for key ${i} only and revert`}));
    }
  }
  return out;
}

function changedPixels(a, b) {
  const pixels = [];
  let union = 0;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const k = (y * a.width + x) * 4;
    if (!a.pixels[k + 3] && !b.pixels[k + 3]) continue;
    union++;
    if (!a.pixels.subarray(k, k + 4).equals(b.pixels.subarray(k, k + 4))) pixels.push([x, y]);
  }
  return {pixels, fraction: union ? pixels.length / union : 0};
}

/** The last-to-first change of a loop must not exceed the largest internal change by more than the allowance. */
export function loopSeam(unit, ctx, options = defaultOptions.loopSeam) {
  const n = unit.frames.length;
  if (!unit.loop || n < 3) return [];
  const steps = ring(n, true).map(([i, j]) => changedPixels(unit.frames[i], unit.frames[j]));
  const seam = steps[n - 1];
  const limit = Math.max(...steps.slice(0, -1).map(s => s.fraction)) * options.factor + options.margin;
  if (seam.fraction <= limit) return [];
  return [finding(unit, 'loop_seam', {frame: n - 1, frameTo: 0, pixels: cap(seam.pixels), measured: +seam.fraction.toFixed(3), limit: +limit.toFixed(3),
    message: `loop seam changes ${(seam.fraction * 100).toFixed(1)}% of the silhouette; the largest internal step allows ${(limit * 100).toFixed(1)}%`})];
}

/** The asymmetric mark must sit in its declared box (at least one pixel) and nowhere else, on every key. */
export function markSide(unit, ctx) {
  const out = [];
  const landmarks = ctx.facing?.landmarks ?? [];
  const groups = new Map();
  for (const mark of landmarks) groups.set(mark.color, [...(groups.get(mark.color) ?? []), mark]);
  unit.frames.forEach((frame, i) => {
    for (const [colorId, marks] of groups) {
      const rgb = ctx.palette.rgb(colorId);
      const all = [];
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) if (isColor(frame, x, y, rgb)) all.push([x, y]);
      const inside = ([x, y], [x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1;
      // A landmark that follows a part has its box moved by that part's offset on this key.
      const boxAt = mark => {
        const slot = mark.follows ? unit.poses?.[i]?.parts[mark.follows] : null;
        if (!slot) return mark.box;
        const dx = ctx.mirrored ? -slot.dx : slot.dx;
        return [mark.box[0] + dx, mark.box[1] + slot.dy, mark.box[2] + dx, mark.box[3] + slot.dy];
      };
      for (const mark of marks) {
        const box = boxAt(mark);
        const here = all.filter(p => inside(p, box));
        if (mark.expect === 'absent') {
          if (all.length) out.push(finding(unit, 'mark_side', {frame: i, pixels: cap(all), measured: all.length, limit: 0, landmark: mark.id, message: `${mark.id} must be absent in this facing but ${all.length} marker pixel(s) are visible`}));
        } else if (!here.length) {
          out.push(finding(unit, 'mark_side', {frame: i, pixels: [[box[0], box[1]], [box[2] - 1, box[3] - 1]], landmark: mark.id, measured: 0, limit: 1,
            message: `${mark.id}: no marker pixel inside its box ${JSON.stringify(box)} in key ${i}`}));
        }
      }
      const expected = marks.filter(m => m.expect !== 'absent');
      if (expected.length) {
        const stray = all.filter(p => !expected.some(m => inside(p, boxAt(m))));
        if (stray.length) out.push(finding(unit, 'mark_side', {frame: i, pixels: cap(stray), measured: stray.length, limit: 0, landmark: expected.map(m => m.id).join(','),
          message: `${stray.length} marker pixel(s) outside the declared box(es) in key ${i}: the mark is on the wrong side`}));
      }
    }
  });
  return out;
}

/**
 * Palette and proportion stability across the clips of one facing. `clips` maps clip name to a unit.
 * Colours appearing in a clip but absent from the reference clip, and silhouette sizes that stray from the
 * reference by more than `maxSizeDelta` of the reference size, are findings.
 */
export function stability(clips, ctx, overrides = {}) {
  const options = {...defaultOptions.stability, ...overrides};
  const out = [];
  const names = Object.keys(clips);
  const reference = options.reference ?? names[0];
  const colorKey = rgb => rgb.join(',');
  const colorsOf = unit => {
    const seen = new Map();
    unit.frames.forEach((f, i) => {
      for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
        if (alphaAt(f, x, y) !== 255) continue;
        const key = colorKey(getRgb(f, x, y));
        if (!seen.has(key)) seen.set(key, {frame: i, xy: [x, y]});
      }
    });
    return seen;
  };
  const sizeOf = f => { const [x0, y0, x1, y1] = bounds(f); return [x1 - x0, y1 - y0]; };
  const refColors = colorsOf(clips[reference]);
  const refSizes = clips[reference].frames.map(sizeOf);
  const refW = Math.max(...refSizes.map(s => s[0])), refH = Math.max(...refSizes.map(s => s[1]));
  for (const name of names) {
    if (name === reference) continue;
    const unit = clips[name];
    const fresh = [...colorsOf(unit)].filter(([key]) => !refColors.has(key));
    if (fresh.length > options.maxNewColors) {
      out.push(finding(unit, 'stability_palette', {frame: fresh[0][1].frame, pixels: cap(fresh.map(([, v]) => v.xy)), measured: fresh.length, limit: options.maxNewColors,
        message: `${fresh.length} colour(s) in ${name} do not appear in ${reference}`}));
    }
    unit.frames.forEach((f, i) => {
      const [w, h] = sizeOf(f);
      if (Math.abs(w - refW) > Math.max(1, refW * options.maxSizeDelta) || Math.abs(h - refH) > Math.max(1, refH * options.maxSizeDelta)) {
        out.push(finding(unit, 'stability_proportion', {frame: i, pixels: [], measured: [w, h], limit: [refW, refH],
          message: `silhouette ${w}x${h} in ${name} key ${i} strays from ${reference} (${refW}x${refH}) by more than ${options.maxSizeDelta * 100}%`}));
      }
    });
  }
  return out;
}

const channel = v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const relative = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrastRatio = (a, b) => { const [hi, lo] = [relative(a), relative(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };

/** Outline against a given background colour (RGB triple): does the silhouette separate at 1x? */
export function silhouetteContrast(unit, ctx, options = defaultOptions.silhouetteContrast) {
  const out = [];
  const background = options.background;
  if (!background) throw new Error('silhouetteContrast needs options.background as [r, g, b]');
  unit.frames.forEach((f, i) => {
    const edge = [], low = [];
    const solid = (x, y) => x >= 0 && y >= 0 && x < f.width && y < f.height && alphaAt(f, x, y) === 255;
    for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
      if (!solid(x, y) || (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) continue;
      edge.push([x, y]);
      if (contrastRatio(getRgb(f, x, y), background) < options.minRatio) low.push([x, y]);
    }
    if (edge.length && low.length / edge.length > options.maxLowEdgeFraction) {
      out.push(finding(unit, 'silhouette_contrast', {frame: i, pixels: cap(low), measured: +(low.length / edge.length).toFixed(2), limit: options.maxLowEdgeFraction,
        message: `${low.length}/${edge.length} edge pixels have contrast below ${options.minRatio}:1 against the background in key ${i}`}));
    }
  });
  return out;
}

/**
 * A face or feature box must carry accents: interior (non-edge) pixels whose luma differs from the box's
 * median by at least `minDelta` (default 40). Eyes, muzzle and nose are accents; flat fur is not.
 * Declared in the rig as features: [{id, box, minAccents, minDelta?}].
 */
export function featureContrast(unit, ctx) {
  const out = [];
  for (const feature of ctx.facing?.features ?? []) {
    const [x0, y0, x1, y1] = feature.box;
    const minDelta = feature.minDelta ?? 40;
    unit.frames.forEach((f, i) => {
      const solid = (x, y) => x >= 0 && y >= 0 && x < f.width && y < f.height && alphaAt(f, x, y) === 255;
      const cells = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        if (solid(x, y) && solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)) cells.push({x, y, v: luma(getRgb(f, x, y))});
      }
      const sorted = cells.map(c => c.v).sort((p, q) => p - q);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const accents = cells.filter(c => Math.abs(c.v - median) >= minDelta);
      if (accents.length < feature.minAccents) {
        out.push(finding(unit, 'feature_contrast', {frame: i, pixels: [[x0, y0], [x1 - 1, y1 - 1]], feature: feature.id, measured: accents.length, limit: feature.minAccents,
          message: `${feature.id} has ${accents.length} accent pixel(s), needs ${feature.minAccents}: the features are lost at 1x`}));
      }
    });
  }
  return out;
}

/**
 * Weight transfer: when the support changes between keys (contacts plant and lift) the body has to move
 * with it. Reports bodyTravel (peak-to-peak of the body plate offset) and supportMisalignment (standard
 * deviation of upper-body centre minus planted centroid, in px), and flags a rigid body over stepping contacts.
 */
export function weightTransfer(unit, ctx, options = defaultOptions.weightTransfer) {
  const {frames, contacts} = unit;
  const supports = contacts.map(list => list.filter(c => c.planted).map(c => c.id).join('|'));
  const stepping = new Set(supports).size > 1 || contacts.some(list => list.some(c => !c.planted));
  const body = ctx.facing?.parts?.find(p => p.role === 'body');
  const offsets = unit.poses.map(p => p.parts[body?.id] ?? {dx: 0, dy: 0});
  const travel = Math.max(ptp(offsets.map(o => o.dx)), ptp(offsets.map(o => o.dy)));
  const series = frames.map((f, i) => {
    const planted = contacts[i].filter(c => c.planted);
    if (!planted.length) return null;
    const floor = Math.min(...planted.map(c => c.xy[1])) - 2;
    let sum = 0, count = 0;
    for (let y = 0; y <= floor; y++) for (let x = 0; x < f.width; x++) if (alphaAt(f, x, y) === 255) { sum += x; count++; }
    if (!count) return null;
    return sum / count - planted.reduce((s, c) => s + c.xy[0], 0) / planted.length;
  }).filter(v => v !== null);
  const mean = series.reduce((s, v) => s + v, 0) / (series.length || 1);
  const misalignment = Math.sqrt(series.reduce((s, v) => s + (v - mean) ** 2, 0) / (series.length || 1));
  unit.metrics = {...(unit.metrics ?? {}), bodyTravel: travel, supportMisalignment: +misalignment.toFixed(3), stepping};
  if (stepping && travel < options.minBodyTravel) {
    return [finding(unit, 'weight_transfer', {frame: 0, pixels: [], measured: travel, limit: options.minBodyTravel,
      message: `contacts step but the body plate never moves (${travel}px): it reads as a rigid body sliding over stepping feet`})];
  }
  return [];
}

const ptp = values => (values.length ? Math.max(...values) - Math.min(...values) : 0);

/**
 * Run every gate that applies to one unit. `options` overrides defaults per gate; set a gate's entry to
 * false to skip it. silhouetteContrast only runs when options.silhouetteContrast.background is given.
 */
export function runGates(unit, ctx, options = {}) {
  const opt = name => (options[name] === false ? false : {...defaultOptions[name], ...options[name]});
  const run = (name, fn) => (opt(name) ? fn(unit, ctx, opt(name)) : []);
  const findings = [
    ...run('footSlide', footSlide),
    ...run('pivotDrift', pivotDrift),
    ...run('flicker', flicker),
    ...run('loopSeam', loopSeam),
    ...run('markSide', markSide),
    ...run('featureContrast', featureContrast),
    ...(options.weightTransfer === false || !unit.poses ? [] : weightTransfer(unit, ctx, opt('weightTransfer'))),
    ...(options.silhouetteContrast?.background ? silhouetteContrast(unit, ctx, opt('silhouetteContrast')) : [])
  ];
  return {pass: !findings.some(f => f.severity === 'error'), findings, metrics: unit.metrics ?? {}};
}
