// The character lineup ruler: a new character is judged standing next to approved references on one ground line.
// Pure measurement, drawing and judging; nothing here knows a project. The numbers come from the project pack
// (`lineup`, keyed by figure guide name):
//
//   references  names of pack `references` entries (the style-locked, approved characters) drawn as the ruler
//   pose        {clip, direction}: the standing pose that is measured and drawn
//   tolerance   a figure outside this is BLOCKED, with numbers   }   each: heightRatio, limbWidthRatio {min, max};
//   typical     a figure outside this is warned about           }   headShareDelta, outlineWeightDelta {max}
//
// Every metric is the figure's value against the reference's (the median of the references): height as a ratio of
// the reference's height, limb width as a ratio, head share and outline weight as an absolute difference.
import { createImage, makeImage } from '../image.mjs';
import { drawText, canDraw, glyphHeight, glyphWidth } from '../sheet/font.mjs';
import { measureFigure } from './figure.mjs';

export const LINEUP_METRICS = Object.freeze(['heightRatio', 'headShareDelta', 'limbWidthRatio', 'outlineWeightDelta']);

/**
 * Outline weight: for every outline-colour pixel on a straight stretch of the silhouette edge (one side faces empty space),
 * how many outline-colour pixels in a row run straight inward from it; the mean. Corner pixels are left out (they would
 * count along the edge); a figure with no straight stretch falls back to the shorter run of every edge pixel.
 * 1 is a one-pixel outline, 2 a two-pixel one. null when the figure has no outline pixel.
 * `ink` is the outline colour as 0xRRGGBB.
 */
export function outlineWeight({width: w, height: h, pixels: p}, ink) {
  const at = (x, y) => (y * w + x) * 4;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const solid = (x, y) => inside(x, y) && p[at(x, y) + 3] === 255;
  const isInk = (x, y) => solid(x, y) && p.readUIntBE(at(x, y), 3) === ink;
  const flat = { sum: 0, n: 0 }, any = { sum: 0, n: 0 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isInk(x, y)) continue;
    const runs = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (solid(x - dx, y - dy)) continue;                       // the neighbour behind is inside the figure: not an edge on this side
      let run = 0, cx = x, cy = y;
      while (isInk(cx, cy)) { run++; cx += dx; cy += dy; }
      runs.push(run);
    }
    if (!runs.length) continue;
    any.sum += Math.min(...runs); any.n++;
    if (runs.length === 1) { flat.sum += runs[0]; flat.n++; }  // a straight stretch of outline: a corner pixel is ambiguous and is left out
  }
  const use = flat.n ? flat : any;
  return use.n ? use.sum / use.n : null;
}

const median = (values) => {
  const v = values.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};

/** One standing figure: {height, width, headShare|null, limbWidth|null, outlineWeight|null}. */
export function standingMeasure(image, ink) {
  const m = measureFigure(image);
  return { height: m.height, width: m.width, headShare: m.headShare, limbWidth: m.limbWidth, outlineWeight: outlineWeight(image, ink) };
}

/** The median of several frames' measures (a standing pose is a few frames of an idle). */
export function medianMeasure(images, ink) {
  const each = images.map((i) => standingMeasure(i, ink));
  return Object.fromEntries(['height', 'width', 'headShare', 'limbWidth', 'outlineWeight'].map((k) => [k, median(each.map((m) => m[k]))]));
}

/** The reference value the newcomer is judged against: the median over the references' own measures. */
export const referenceMeasure = (measures) => Object.fromEntries(['height', 'width', 'headShare', 'limbWidth', 'outlineWeight'].map((k) => [k, median(measures.map((m) => m[k]))]));

/** A figure's lineup numbers against a reference: {heightRatio, headShareDelta, limbWidthRatio, outlineWeightDelta}; a metric that was not measured is null. */
export function lineupNumbers(figure, ref) {
  const ratio = (a, b) => (a === null || a === undefined || !b ? null : a / b);
  const delta = (a, b) => (a === null || a === undefined || b === null || b === undefined ? null : Math.abs(a - b));
  return {
    heightRatio: ratio(figure.height, ref.height),
    headShareDelta: delta(figure.headShare, ref.headShare),
    limbWidthRatio: ratio(figure.limbWidth, ref.limbWidth),
    outlineWeightDelta: delta(figure.outlineWeight, ref.outlineWeight),
  };
}

const outside = (value, band) => band && ((band.min !== undefined && value < band.min) || (band.max !== undefined && value > band.max));
const round = (v) => (v === null || v === undefined ? v : Math.round(v * 1000) / 1000);

/**
 * Judge a figure against the reference and a group's bands.
 * Returns {status: 'pass'|'warn'|'fail', rows: [{metric, measured, figure, reference, block, typical, status}], notProven: [{what, why}]}
 * fail: a metric is outside `tolerance` (the build is wrong: block, with the number). warn: inside it but outside `typical`.
 * A metric the figure does not show (no neck for a head share, no outline pixel) is not proven, never a pass.
 */
export function judgeLineup({ figure, reference, spec }) {
  const n = lineupNumbers(figure, reference);
  const field = { heightRatio: 'height', headShareDelta: 'headShare', limbWidthRatio: 'limbWidth', outlineWeightDelta: 'outlineWeight' };
  const rows = [], notProven = [];
  let status = 'pass';
  for (const metric of LINEUP_METRICS) {
    const band = spec.tolerance?.[metric], soft = spec.typical?.[metric];
    if (!band && !soft) continue;
    const value = n[metric];
    if (value === null) { notProven.push({ what: `lineup ${metric}`, why: `the ${field[metric]} could not be measured on this figure${reference[field[metric]] === null ? ' (or on the reference)' : ''}` }); continue; }
    const st = outside(value, band) ? 'fail' : outside(value, soft) ? 'warn' : 'pass';
    if (st === 'fail') status = 'fail'; else if (st === 'warn' && status === 'pass') status = 'warn';
    rows.push({ metric, measured: round(value), figure: round(figure[field[metric]]), reference: round(reference[field[metric]]), block: band ?? null, typical: soft ?? null, status: st });
  }
  return { status, rows, notProven };
}

/** One sentence per out-of-band row, with the numbers, for a person or an agent to act on. */
export function lineupMessages(verdict, name = 'the reference') {
  const say = { heightRatio: (r) => `height is ${Math.round(r.measured * 100)}% of ${name}'s (${r.figure} px against ${r.reference})`,
    headShareDelta: (r) => `head share is ${Math.round(r.figure * 100)}% of the figure against ${Math.round(r.reference * 100)}% for ${name}`,
    limbWidthRatio: (r) => `limbs are ${r.figure} px wide against ${r.reference} px for ${name}`,
    outlineWeightDelta: (r) => `the outline weighs ${r.figure} px on average against ${r.reference} for ${name}` };
  return verdict.rows.filter((r) => r.status !== 'pass').map((r) => `${r.status === 'fail' ? 'BLOCKED' : 'warning'}: ${say[r.metric](r)}; allowed ${r.status === 'fail' ? bandText(r.block) : bandText(r.typical)}`);
}
const bandText = (b) => (b.min !== undefined && b.max !== undefined ? `${b.min} to ${b.max}` : b.max !== undefined ? `at most ${b.max}` : `at least ${b.min}`) + ' (as a ratio or difference, see the pack lineup)';

// ---- drawing ------------------------------------------------------------------------------------------------------

const blitScaled = (dst, src, x0, groundY, scale, tint) => {
  const w = src.width * scale, h = src.height * scale, top = groundY - h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x0 + x, dy = top + y;
    if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
    const k = (Math.floor(y / scale) * src.width + Math.floor(x / scale)) * 4;
    if (!src.pixels[k + 3]) continue;
    dst.pixels.set(tint ? tint(src.pixels[k], src.pixels[k + 1], src.pixels[k + 2]) : [src.pixels[k], src.pixels[k + 1], src.pixels[k + 2], 255], (dy * dst.width + dx) * 4);
  }
};

/** Tight crop of the opaque pixels of a native frame (a figure on its own, feet at the bottom edge). */
export function trimFigure(image) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) if (image.pixels[(y * image.width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return null;
  const out = createImage(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.pixels.set(image.pixels.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4), ((y - y0) * out.width + (x - x0)) * 4);
  return out;
}

/** A reference drawn into a template cell as a green ghost (luminance mapped to dark and light greens, so it keys out as background): {image, height} fit to `height` px. */
export function ghostFigure(image, height) {
  const fig = trimFigure(image);
  if (!fig) return null;
  const scale = Math.max(1, Math.round(height / fig.height));
  const ghost = createImage(fig.width * scale, fig.height * scale);
  for (let y = 0; y < ghost.height; y++) for (let x = 0; x < ghost.width; x++) {
    const k = (Math.floor(y / scale) * fig.width + Math.floor(x / scale)) * 4;
    if (!fig.pixels[k + 3]) continue;
    const luma = (fig.pixels[k] * 54 + fig.pixels[k + 1] * 183 + fig.pixels[k + 2] * 19) / 256;
    ghost.pixels.set([0, Math.round(110 + luma * 0.35), 0, 255], (y * ghost.width + x) * 4);
  }
  return { image: ghost, scale };
}

/**
 * The lineup picture: figures standing on one ground line, left to right, at one whole-number scale, with a mark for the
 * ground and, when `bands` is given, lines at the allowed height range of a newcomer (from the reference's height).
 * figures: [{image (native frame), name, tone?: 'reference'|'newcomer'}]. Returns an image.
 */
export function renderLineup({ figures, reference, bands, scale = 6, gap = 14, margin = 12, background = [128, 122, 134] }) {
  const fit = figures.map((f) => ({ ...f, fig: trimFigure(f.image) })).filter((f) => f.fig);
  if (!fit.length) throw new Error('renderLineup needs at least one figure with pixels');
  const tallest = Math.max(...fit.map((f) => f.fig.height)), top = margin + 8;
  const ground = top + tallest * scale + 2;
  const width = Math.max(margin * 2 + fit.reduce((s, f) => s + f.fig.width * scale, 0) + gap * (fit.length - 1), margin * 2 + 16 * (glyphWidth + 1));
  const height = ground + margin + 8 + glyphHeight * 2 + 4;
  const img = createImage(width, height, background);
  const plot = (x, y, c) => { if (x >= 0 && y >= 0 && x < width && y < height) img.pixels.set([...c, 255], (y * width + x) * 4); };
  for (let x = 0; x < width; x++) plot(x, ground, [60, 54, 66]);
  if (bands && reference?.height) {
    for (const [ratio, c] of [[bands.min, [255, 96, 96]], [bands.max, [255, 96, 96]], [bands.typicalMin, [255, 220, 96]], [bands.typicalMax, [255, 220, 96]]]) {
      if (ratio === undefined) continue;
      const y = ground - Math.round(reference.height * ratio * scale);
      for (let x = 0; x < width; x += 6) { plot(x, y, c); plot(x + 1, y, c); plot(x + 2, y, c); }
    }
  }
  let x0 = margin;
  const placed = [];
  for (const f of fit) {
    blitScaled(img, f.fig, x0, ground, scale);
    const label = String(f.name ?? '').toUpperCase().replace(/[^A-Z0-9 ._-]/g, '_').slice(0, 16);
    if (label && canDraw(label)) drawText(label, x0, ground + 6, 1, (x, y) => plot(x, y, f.tone === 'reference' ? [40, 90, 40] : [20, 16, 26]));
    placed.push({ name: f.name, tone: f.tone ?? 'newcomer', x: x0, width: f.fig.width * scale, height: f.fig.height * scale });
    x0 += f.fig.width * scale + gap;
  }
  return Object.assign(makeImage(width, height, img.pixels), { placed, ground, scale });
}
