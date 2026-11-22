// Whole-frame transforms (E3): flip, rotate by quarter turns, shift, centre. Pure functions over {width, height, pixels}
// (RGBA Buffer), the idea taken from the transformation list of Piskel's published specs; the code is written here.
// Nothing here knows an asset, a palette or a store: a transform only moves pixels, so a frame that passed the palette
// and binary-alpha gates still does afterwards (a fully transparent pixel keeps RGB 0,0,0). What moves out of the
// frame is reported (`lost`), never dropped silently. Mirror drawing and tile view live here too, as pure helpers.

export const TRANSFORMS = Object.freeze(['flip_h', 'flip_v', 'rotate90', 'rotate180', 'rotate270', 'shift', 'centre']);
export const SCOPES = Object.freeze(['frame', 'clip', 'all']);
export const MIRROR_AXES = Object.freeze(['x', 'y', 'xy']);

const fail = message => { throw Object.assign(new Error(message), {status: 422, code: 'invalid_input'}); };
const blankLike = (w, h) => ({width: w, height: h, pixels: Buffer.alloc(w * h * 4)});
const copyPixel = (src, si, dst, di) => { src.pixels.copy(dst.pixels, di * 4, si * 4, si * 4 + 4); };
const opaque = (img, i) => img.pixels[i * 4 + 3] !== 0;

/** Check a transform description: {kind, dx?, dy?, wrap?, axis?}. Returns it normalised; throws a reason otherwise. */
export function checkTransform(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) fail('a transform is an object {kind, ...}');
  if (!TRANSFORMS.includes(t.kind)) fail(`transform kind must be one of ${TRANSFORMS.join(', ')}`);
  const out = {kind: t.kind};
  if (t.kind === 'shift') {
    if (!Number.isInteger(t.dx) || !Number.isInteger(t.dy)) fail('shift needs integer dx and dy');
    if (Math.abs(t.dx) > 256 || Math.abs(t.dy) > 256) fail('shift dx and dy must be within 256');
    out.dx = t.dx; out.dy = t.dy; out.wrap = t.wrap === true;
  } else if (t.kind === 'centre') {
    const axis = t.axis ?? 'both';
    if (!['x', 'y', 'both'].includes(axis)) fail('centre axis must be x, y or both');
    out.axis = axis;
  }
  return out;
}

/** The opaque bounds {x, y, w, h} of an image, or null when it is empty. */
export function opaqueBox(img) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (!opaque(img, y * img.width + x)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1};
}

function roll(img, dx, dy, wrap) {
  const out = blankLike(img.width, img.height);
  let lost = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const si = y * img.width + x;
    let nx = x + dx, ny = y + dy;
    if (wrap) { nx = ((nx % img.width) + img.width) % img.width; ny = ((ny % img.height) + img.height) % img.height; }
    else if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) { if (opaque(img, si)) lost++; continue; }
    copyPixel(img, si, out, ny * img.width + nx);
  }
  return {image: out, lost};
}

/**
 * Apply one transform. Returns {image, lost, moved: [dx, dy] | null, note?}. `image` is a new object; the input is untouched.
 * Rotation by a quarter turn needs a square frame (a rotated 32x24 frame would no longer be one); the reason says so.
 */
export function transformImage(img, spec) {
  const t = checkTransform(spec);
  const {width: w, height: h} = img;
  if (t.kind === 'flip_h' || t.kind === 'flip_v') {
    const out = blankLike(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) copyPixel(img, y * w + x, out, t.kind === 'flip_h' ? y * w + (w - 1 - x) : (h - 1 - y) * w + x);
    return {image: out, lost: 0, moved: null};
  }
  if (t.kind.startsWith('rotate')) {
    const turns = {rotate90: 1, rotate180: 2, rotate270: 3}[t.kind];
    if (turns !== 2 && w !== h) fail(`${t.kind} needs a square frame; this one is ${w}x${h}`);
    const out = blankLike(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [nx, ny] = turns === 1 ? [h - 1 - y, x] : turns === 2 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      copyPixel(img, y * w + x, out, ny * w + nx);
    }
    return {image: out, lost: 0, moved: null};
  }
  if (t.kind === 'shift') {
    const r = roll(img, t.dx, t.dy, t.wrap);
    return {...r, moved: [t.dx, t.dy]};
  }
  // centre: the opaque bounds move to the middle (the left or upper pixel when the margin is odd).
  const box = opaqueBox(img);
  if (!box) return {image: {width: w, height: h, pixels: Buffer.from(img.pixels)}, lost: 0, moved: [0, 0], note: 'the frame is empty, so there is nothing to centre'};
  const dx = t.axis === 'y' ? 0 : Math.floor((w - box.w) / 2) - box.x;
  const dy = t.axis === 'x' ? 0 : Math.floor((h - box.h) / 2) - box.y;
  return {...roll(img, dx, dy, false), moved: [dx, dy]};
}

/**
 * Mirror drawing: every point op also lands on its mirror image across the frame's middle line(s). `axes` x mirrors left to right,
 * y top to bottom, xy both (four copies). Works on the ops of studio_frame_patch that have coordinates: set, line, fill, flood.
 * Operations that move or copy regions (shift, copy), rebuild the outline (outline) or are whole-frame (flip, rotate...) are not mirrored and
 * are refused, so a mirrored edit never means something other than what was asked.
 */
export function mirrorOps(ops, axes, width, height) {
  if (!MIRROR_AXES.includes(axes)) fail(`mirror must be one of ${MIRROR_AXES.join(', ')}`);
  const fx = axes.includes('x'), fy = axes.includes('y');
  const px = ([x, y]) => [[x, y], ...(fx ? [[width - 1 - x, y]] : []), ...(fy ? [[x, height - 1 - y]] : []), ...(fx && fy ? [[width - 1 - x, height - 1 - y]] : [])];
  const out = [];
  for (const op of ops) {
    if (op.op === 'set') out.push({...op, pixels: op.pixels.flatMap(([x, y, c]) => px([x, y]).map(([a, b]) => [a, b, c]))});
    else if (op.op === 'line') {
      const from = px(op.from), to = px(op.to);
      from.forEach((f, i) => out.push({...op, from: f, to: to[i]}));
    } else if (op.op === 'fill') {
      const [x0, y0, x1, y1] = op.box;
      out.push(op);
      if (fx) out.push({...op, box: [width - x1, y0, width - x0, y1]});
      if (fy) out.push({...op, box: [x0, height - y1, x1, height - y0]});
      if (fx && fy) out.push({...op, box: [width - x1, height - y1, width - x0, height - y0]});
    } else if (op.op === 'flood') for (const at of px(op.at)) out.push({...op, at});
    else fail(`mirror cannot be used with the "${op.op}" operation; it mirrors set, line, fill and flood`);
  }
  return out;
}

/** Tile mode: the image repeated nx by ny times (a preview of how a tile meets itself). Returns a new image. */
export function tileImage(img, nx = 3, ny = 3) {
  if (!Number.isInteger(nx) || !Number.isInteger(ny) || nx < 1 || ny < 1 || nx > 8 || ny > 8) fail('tile counts must be integers from 1 to 8');
  const out = blankLike(img.width * nx, img.height * ny);
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) for (let y = 0; y < img.height; y++) {
    img.pixels.copy(out.pixels, (((ty * img.height + y) * out.width) + tx * img.width) * 4, y * img.width * 4, (y + 1) * img.width * 4);
  }
  return out;
}

/**
 * Seam report for tile mode: how many pixels differ across the left/right and top/bottom edges when the image repeats
 * (an opaque pixel facing a transparent one, or two opaque pixels of different colour). 0 and 0 means it tiles cleanly.
 */
export function seamMismatch(img) {
  const {width: w, height: h, pixels: p} = img;
  const differs = (a, b) => {
    const aa = p[a * 4 + 3], bb = p[b * 4 + 3];
    return aa !== bb || (aa !== 0 && (p[a * 4] !== p[b * 4] || p[a * 4 + 1] !== p[b * 4 + 1] || p[a * 4 + 2] !== p[b * 4 + 2]));
  };
  let horizontal = 0, vertical = 0;
  for (let y = 0; y < h; y++) if (differs(y * w, y * w + w - 1)) horizontal++;
  for (let x = 0; x < w; x++) if (differs(x, (h - 1) * w + x)) vertical++;
  return {horizontal, vertical};
}
