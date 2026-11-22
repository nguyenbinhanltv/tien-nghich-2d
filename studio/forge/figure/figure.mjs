// Figure readability: what a project says a character should look like at native size, drawn into the sheet template as
// a guide, written out as text for the image prompt, and checked on the pixelised figure. Nothing here knows a project:
// the numbers come from the project pack (`figures`), the module only draws and measures.
//
// A figure guide (all lengths are fractions of the figure's height, ground to crown):
//   headToBody      {min, max, target}   head height / figure height (0.38 = about 2.6 heads tall)
//   minLimbWidthPx  integer              narrowest leg or arm in FINAL pixels, outline included
//   accentMinPixels integer              pixels an accent colour needs in a final frame to still read
//   guide           {headWidth, bodyWidth, legWidth, legGap}   the silhouette drawn into template cells

/** The guide of this figure name, or the first whose profiles list `profile`; null when none applies. */
export function figureFor(figures = {}, profile, name) {
  if (name !== undefined) return Object.hasOwn(figures, name) ? { ...figures[name], name } : null;
  const hit = Object.entries(figures).find(([, f]) => f.profiles.includes(profile));
  return hit ? { ...hit[1], name: hit[0] } : null;
}

/** The guidance as text for an image prompt, from the numbers alone. */
export function guidanceText(figure, { nativePx }) {
  const [, nh] = nativePx;
  const h = figure.headToBody, pct = (v) => Math.round(v * 100);
  const px = (frac) => Math.round(frac * nh * 0.8);   // a figure fills about 80% of the native height
  return [
    `Proportions (this project's "${figure.name}" figures): the head is about ${pct(h.target)}% of the figure's height (${pct(h.min)}% to ${pct(h.max)}% reads right; about ${(1 / h.target).toFixed(1)} heads tall), so draw a LARGE head on a short, sturdy body, not realistic adult proportions.`,
    `Limbs: at ${nativePx.join('x')} each leg and arm must stay at least ${figure.minLimbWidthPx} final pixels wide (outline included), so draw them thick, with the gap between the legs about one limb wide; thin limbs vanish in pixelisation.`,
    `Accent colours (a scarf, a sash, a gem, a mark): give each at least ${figure.accentMinPixels} final pixels, which is a bold patch about ${Math.max(2, Math.ceil(Math.sqrt(figure.accentMinPixels)))} native pixels across; a thin line of colour will be absorbed by its neighbours. State each accent colour when you call studio_process (accents) to be warned if one disappears.`,
    `The guide silhouette drawn in each cell (dimmed green, it keys out as background) shows these proportions: fit your figure to it; it is a guide, not a shape to copy.`,
  ].join(' ');
}

/** The silhouette as rectangles and ellipses in cell pixels: {top, ground, cx} -> [{kind, ...}]. */
export function guideShapes(figure, { cx, ground, top, minX, maxX }) {
  const g = figure.guide;
  if (!g) return [];
  let H = ground - top;
  // Fit the cell in both dimensions, keeping the proportions: shrink about the ground point when the widest part would cross a cell edge.
  if (minX !== undefined && maxX !== undefined) {
    const half = Math.min(cx - minX, maxX - cx), widest = Math.max(g.headWidth, g.bodyWidth);
    H = Math.min(H, Math.floor((half * 2) / widest));
    top = ground - H;
  }
  const headH = Math.round(H * figure.headToBody.target);
  const headW = Math.round(H * g.headWidth), bodyW = Math.round(H * g.bodyWidth), legW = Math.round(H * g.legWidth), gap = Math.round(H * g.legGap);
  const legH = Math.round(H * 0.18), bodyTop = top + headH, bodyBottom = ground - legH;
  return [
    { kind: 'ellipse', cx, cy: top + Math.round(headH / 2), rx: Math.round(headW / 2), ry: Math.round(headH / 2) },
    { kind: 'rect', x0: cx - Math.round(bodyW / 2), y0: bodyTop, x1: cx + Math.round(bodyW / 2), y1: bodyBottom },
    { kind: 'rect', x0: cx - gap / 2 - legW, y0: bodyBottom, x1: cx - gap / 2, y1: ground },
    { kind: 'rect', x0: cx + gap / 2, y0: bodyBottom, x1: cx + gap / 2 + legW, y1: ground },
  ];
}

/** Draw the guide's outline with `plot(x, y)`, `thick` pixels wide. */
export function drawGuide(shapes, plot, thick = 3) {
  const dot = (x, y) => { for (let dy = 0; dy < thick; dy++) for (let dx = 0; dx < thick; dx++) plot(Math.round(x) + dx, Math.round(y) + dy); };
  for (const s of shapes) {
    if (s.kind === 'rect') {
      for (let x = Math.round(s.x0); x <= Math.round(s.x1); x++) { dot(x, s.y0); dot(x, s.y1); }
      for (let y = Math.round(s.y0); y <= Math.round(s.y1); y++) { dot(s.x0, y); dot(s.x1, y); }
    } else {
      const steps = Math.max(48, (s.rx + s.ry) * 4);
      for (let i = 0; i < steps; i++) { const t = (i / steps) * Math.PI * 2; dot(s.cx + Math.cos(t) * s.rx, s.cy + Math.sin(t) * s.ry); }
    }
  }
}

/**
 * Measure a pixelised figure {width, height, pixels RGBA}. Returns
 *   {height, width, headShare|null, limbWidth|null, colors: {'#rrggbb': pixels}}.
 * headShare is head height / figure height where a neck is visible (a row clearly narrower than the head above it, in the top 55%); null otherwise.
 * limbWidth is the median length of the horizontal runs of opaque pixels in the lower 15-20% of the figure.
 */
export function measureFigure(image) {
  const { width: w, height: h, pixels } = image;
  const rowWidth = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) if (pixels[(y * w + x) * 4 + 3]) n++; rowWidth.push(n); }
  const rows = rowWidth.map((n, y) => (n ? y : -1)).filter((y) => y >= 0);
  if (!rows.length) return { height: 0, width: 0, headShare: null, limbWidth: null, colors: {} };
  const top = rows[0], bottom = rows.at(-1), height = bottom - top + 1;
  let headShare = null, widest = 0;
  for (let y = top; y <= top + Math.floor(height * 0.55); y++) {
    widest = Math.max(widest, rowWidth[y]);
    if (y - top >= 3 && rowWidth[y] < widest * 0.78) { headShare = (y - top) / height; break; }
  }
  const runs = [];
  for (let y = top + Math.floor(height * 0.8); y <= top + Math.floor(height * 0.95); y++) {
    let run = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && pixels[(y * w + x) * 4 + 3]) run++; else { if (run) runs.push(run); run = 0; }
    }
  }
  runs.sort((a, b) => a - b);
  const colors = {};
  for (let i = 0; i < w * h; i++) {
    if (!pixels[i * 4 + 3]) continue;
    const hex = '#' + [0, 1, 2].map((c) => pixels[i * 4 + c].toString(16).padStart(2, '0')).join('');
    colors[hex] = (colors[hex] ?? 0) + 1;
  }
  return { height, width: Math.max(...rowWidth), headShare, limbWidth: runs.length ? runs[Math.floor(runs.length / 2)] : null, colors };
}

/**
 * Warnings for one measured figure against a guide. `accents` is a list of {id, hex}: colours the author wants to survive.
 * Each warning: {check, message, measured, limit}.
 */
export function figureWarnings(measure, figure, { accents = [] } = {}) {
  const out = [];
  const h = figure.headToBody;
  if (measure.limbWidth !== null && measure.limbWidth < figure.minLimbWidthPx) {
    out.push({ check: 'thin_limbs', measured: measure.limbWidth, limit: figure.minLimbWidthPx,
      message: `the figure is thinner than this project's minimum: its legs are ${measure.limbWidth} px wide in the final frame and the minimum is ${figure.minLimbWidthPx} (outline included). Redraw the limbs thicker, or draw the figure sturdier.` });
  }
  if (measure.headShare !== null && (measure.headShare < h.min || measure.headShare > h.max)) {
    out.push({ check: 'head_proportion', measured: +measure.headShare.toFixed(2), limit: [h.min, h.max],
      message: `the head is ${Math.round(measure.headShare * 100)}% of the figure's height; this project's figures are ${Math.round(h.min * 100)}% to ${Math.round(h.max * 100)}% (target ${Math.round(h.target * 100)}%). ${measure.headShare < h.min ? 'Draw a larger head on a shorter body.' : 'The head is oversized for this project.'} (Ignore this for a figure that has no head, such as a beast or a construct.)` });
  }
  for (const a of accents) {
    const n = measure.colors[a.hex.toLowerCase()] ?? 0;
    if (n < figure.accentMinPixels) out.push({ check: 'accent_lost', accent: a.id, measured: n, limit: figure.accentMinPixels,
      message: `accent ${a.id} has ${n} pixel(s) in the final frame; it needs at least ${figure.accentMinPixels} to read. ${n === 0 ? 'It vanished in pixelisation: draw it bigger and bolder, or keep it with studio_process marks.' : 'Draw it bigger, or keep it with studio_process marks.'}` });
  }
  return out;
}
