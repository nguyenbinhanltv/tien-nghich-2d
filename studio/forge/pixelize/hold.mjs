// Sequence-aware palette snapping ("hold"): frames of one clip and direction are snapped in order, and a pixel keeps the
// palette entry it had in the previous frame when the new source colour is within `margin` of the best entry's distance.
// The idea is plain hysteresis (it is how a thermostat avoids chattering); the code here is this project's own.
// Only the colour of pixels that are already opaque changes: alpha and the outline (rebuilt afterwards) are never touched.
import { createHash } from 'node:crypto';
import { cloneImage, snapPalette } from '../image.mjs';

/** Colour distances in 0..~441 units. `rgb` is Euclidean; `redmean` weights channels by the mean red (a cheap perceptual fit). */
export const metrics = {
  rgb: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  redmean: (a, b) => {
    const r = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
    return Math.sqrt((2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db) / 2.5;
  },
};

/**
 * Normalise a hold spec. `spec` is false/undefined (off), true (use `defaults`) or an object overlaying `defaults`
 * ({margin, metric, search, laps, maxChromaGain}). With no defaults and no explicit margin the hold stays off: nothing is assumed in code.
 */
export function resolveHold(spec, defaults) {
  if (spec === false || spec === null) return null;
  const base = defaults && defaults.enabled !== false ? defaults : null;
  const given = spec && typeof spec === 'object' ? spec : null;
  if (given?.enabled === false) return null;
  const merged = {...(base ?? {}), ...(given ?? {})};
  if (merged.margin === undefined) return null;
  const {margin, metric = 'rgb', search = 0, laps = 2, maxChromaGain = null} = merged;
  if (maxChromaGain !== null && !(typeof maxChromaGain === 'number' && maxChromaGain >= 0 && maxChromaGain <= 255)) throw new Error('hold maxChromaGain must be a number from 0 to 255');
  if (!(typeof margin === 'number' && margin >= 0 && margin <= 450)) throw new Error('hold margin must be a number from 0 to 450');
  if (!metrics[metric]) throw new Error(`hold metric must be one of ${Object.keys(metrics).join(', ')}`);
  if (!(Number.isInteger(search) && search >= 0 && search <= 4)) throw new Error('hold search must be an integer from 0 to 4');
  if (!(Number.isInteger(laps) && laps >= 1 && laps <= 4)) throw new Error('hold laps must be an integer from 1 to 4');
  return {margin, metric, search, laps, ...(maxChromaGain !== null ? {maxChromaGain} : {})};
}

const chroma = c => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
/** Nearest palette entry per opaque pixel under an arbitrary distance (first entry wins ties); alpha untouched. */
function snapNearest(img, colors, dist) {
  const out = cloneImage(img), d = out.pixels, cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let hit = cache.get(key);
    if (!hit) {
      let best = Infinity;
      for (const c of colors) { const e = dist([d[i], d[i + 1], d[i + 2]], c); if (e < best) { best = e; hit = c; } }
      cache.set(key, hit);
    }
    d[i] = hit[0]; d[i + 1] = hit[1]; d[i + 2] = hit[2];
  }
  return out;
}

/**
 * The hold sequences of a forge.poseclips document: [{clip, keys, facings|null, loop}]. `facings` null means every facing that
 * has a cell for every key. `loop` is the effective loop setting: `loops[clip]` (see effectiveLoops in pipeline/poses.mjs, which
 * resolves a secondary template's loop) else the clip's own `loop`, default true.
 */
export function sequencesOf(poseClips, loops = {}) {
  return Object.entries(poseClips?.clips ?? {}).map(([clip, spec]) => ({clip, keys: Array.isArray(spec.keys) ? spec.keys : [], facings: spec.facings ?? null, loop: loops[clip] ?? spec.loop ?? true}));
}

/**
 * Identity of one clip's playing sequence for one facing: what a held frame was made for. A bake that finds a different value
 * (keys reordered, another loop setting) must not reuse the frame.
 */
export function sequenceHash(clip, facing, keys, loop) {
  return createHash('sha256').update(JSON.stringify({clip, facing, keys, loop: loop !== false})).digest('hex').slice(0, 16);
}

const keyOf = (r, g, b) => (r << 16) | (g << 8) | b;

/**
 * Snap `img` (binary alpha) to `colors`, holding the previous frame's entry where it is close enough.
 * `previous` is the previous frame's snapped image (or null for the first frame of a sequence); `search` allows the previous
 * frame to be shifted by up to that many pixels in each direction before comparing (the shift that agrees most is used).
 * Returns {image, held, offset}: `held` counts pixels whose entry differs from the plain nearest-colour choice.
 */
export function snapHeld(img, colors, previous, {margin, metric = 'rgb', search = 0, maxChromaGain = null} = {}) {
  const plain = metric === 'rgb' ? snapPalette(img, colors) : snapNearest(img, colors, metrics[metric]);
  if (!previous || previous.width !== img.width || previous.height !== img.height) return {image: plain, held: 0, offset: [0, 0]};
  const dist = metrics[metric], {width, height} = img;
  const inPalette = new Set(colors.map(c => keyOf(c[0], c[1], c[2])));
  const prevAt = (x, y, dx, dy) => {
    const px = x - dx, py = y - dy;
    if (px < 0 || py < 0 || px >= width || py >= height) return null;
    const i = (py * width + px) * 4, p = previous.pixels;
    if (p[i + 3] !== 255 || !inPalette.has(keyOf(p[i], p[i + 1], p[i + 2]))) return null;
    return p.subarray(i, i + 3);
  };
  // The shift: the one for which most opaque pixels already agree with the previous frame. Ties go to the smaller shift, then row-major.
  let offset = [0, 0];
  if (search > 0) {
    let bestScore = -1, bestCost = Infinity;
    for (let dy = -search; dy <= search; dy++) for (let dx = -search; dx <= search; dx++) {
      let score = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (plain.pixels[i + 3] !== 255) continue;
        const p = prevAt(x, y, dx, dy);
        if (p && p[0] === plain.pixels[i] && p[1] === plain.pixels[i + 1] && p[2] === plain.pixels[i + 2]) score++;
      }
      const cost = Math.abs(dx) + Math.abs(dy);
      if (score > bestScore || (score === bestScore && cost < bestCost)) { bestScore = score; bestCost = cost; offset = [dx, dy]; }
    }
  }
  const out = cloneImage(plain);
  let held = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (img.pixels[i + 3] !== 255) continue;
    const p = prevAt(x, y, offset[0], offset[1]);
    if (!p) continue;
    const source = img.pixels.subarray(i, i + 3), best = plain.pixels.subarray(i, i + 3);
    if (p[0] === best[0] && p[1] === best[1] && p[2] === best[2]) continue;
    // A held entry may not differ much in saturation from the nearest one: otherwise a stray accent colour, once chosen, keeps spreading, and a bright accent fades to its dull neighbour.
    if (maxChromaGain !== null && Math.abs(chroma(p) - chroma(best)) > maxChromaGain) continue;
    if (dist(source, p) <= dist(source, best) + margin) { out.pixels.set(p, i); held++; }
  }
  return {image: out, held, offset};
}
