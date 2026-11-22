// Motion measurement for agents: numbers about an animation instead of a guess. Pure; nothing here reads a
// file or knows a project. Images are {width, height, pixels: RGBA Buffer}. A pixel is "opaque" when its
// alpha is above 0 (frames carry binary alpha, so this is the same as alpha 255 on any frame that passes QA).
import { encodePixels } from './png.mjs';

const opaqueAt = (img, i) => img.pixels[i * 4 + 3] !== 0;

/** {x, y, w, h} of the opaque pixels, or null for an empty frame; `pixels` is how many there are. */
export function opaqueBounds(img) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, pixels = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (!opaqueAt(img, y * img.width + x)) continue;
      pixels++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return pixels ? {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels} : {x: 0, y: 0, w: 0, h: 0, pixels: 0};
}

/** Pixels that differ between two frames of the same size: {changedPixels, box|null}. A different size is reported, not compared. */
export function changedBetween(a, b) {
  if (a.width !== b.width || a.height !== b.height) return {changedPixels: null, box: null, sizeChanged: true};
  let changed = 0, minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const k = (y * a.width + x) * 4;
      const aa = a.pixels[k + 3], bb = b.pixels[k + 3];
      if (aa === bb && (aa === 0 || (a.pixels[k] === b.pixels[k] && a.pixels[k + 1] === b.pixels[k + 1] && a.pixels[k + 2] === b.pixels[k + 2]))) continue;
      changed++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return {changedPixels: changed, box: changed ? {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1} : null};
}

/**
 * Measure one clip (frames in play order). Returns
 *   {frames: [{index, bounds, pixels}], pairs: [{from, to, changedPixels, box, seam?}]}
 * `pairs` has one entry per neighbouring pair, plus the loop seam (last to first) when `loop` is true and there are 2+ frames.
 */
export function measureClip(images, {loop = false} = {}) {
  const frames = images.map((img, index) => { const b = opaqueBounds(img); return {index, bounds: {x: b.x, y: b.y, w: b.w, h: b.h}, pixels: b.pixels}; });
  const pairs = [];
  for (let i = 0; i + 1 < images.length; i++) pairs.push({from: i, to: i + 1, ...changedBetween(images[i], images[i + 1])});
  if (loop && images.length > 1) pairs.push({from: images.length - 1, to: 0, seam: true, ...changedBetween(images.at(-1), images[0])});
  return {frames, pairs};
}

/**
 * Connected groups of opaque pixels (8-neighbour), largest first: [{pixels, box, at: [x, y]}].
 * A frame is one body plus, sometimes, pieces that float apart from it.
 */
export function components(img) {
  const {width: w, height: h} = img;
  const seen = new Uint8Array(w * h), out = [];
  const stack = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !opaqueAt(img, start)) continue;
    let count = 0, minX = w, minY = h, maxX = -1, maxY = -1;
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const p = stack.pop(), x = p % w, y = (p - x) / w;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((dx || dy) && nx >= 0 && ny >= 0 && nx < w && ny < h) {
          const q = ny * w + nx;
          if (!seen[q] && opaqueAt(img, q)) { seen[q] = 1; stack.push(q); }
        }
      }
    }
    out.push({pixels: count, box: {x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1}, at: [minX, minY]});
  }
  return out.sort((a, b) => b.pixels - a.pixels);
}

/**
 * Orphan pixels and detached fragments of one frame. Thresholds (from the pack):
 *   orphanMaxPx     a group this small is an orphan pixel (default 1 or 2 pixels)
 *   fragmentMaxPx   a group above that, up to this size, is a detached fragment (a speck or a cut-off piece);
 *                   bigger separate groups are parts of the design (a weapon, a floating orb) and are not reported
 * The largest group is the body and is never reported. Returns {orphans: [{x, y, pixels}], fragments: [...], groups}.
 */
export function detachedPieces(img, {orphanMaxPx = 1, fragmentMaxPx = 4} = {}) {
  const groups = components(img);
  const orphans = [], fragments = [];
  for (const g of groups.slice(1)) {
    const piece = {x: g.at[0], y: g.at[1], pixels: g.pixels};
    if (g.pixels <= orphanMaxPx) orphans.push(piece);
    else if (g.pixels <= fragmentMaxPx) fragments.push(piece);
  }
  return {orphans, fragments, groups: groups.length};
}

const BLUE = [64, 160, 255], RED = [255, 96, 96];

/**
 * An onion-skin picture of a clip: neighbours drawn as faint tinted ghosts (earlier frames red, later frames blue)
 * under the frame at `current`, which is drawn in its own colours. Returns an image {width, height, pixels}.
 * `scale` enlarges by whole-number nearest neighbour; `before` and `after` say how many neighbours to show (looping
 * wraps round). The background is a flat mid grey so ghosts and a dark outline both read.
 */
export function onionSkin(images, {current = 0, before = 2, after = 1, loop = false, scale = 4, background = [128, 122, 134]} = {}) {
  if (!images.length) throw new Error('onionSkin needs at least one frame');
  const w = images[0].width, h = images[0].height;
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([...background, 255], i * 4);
  const pick = (offset) => {
    let k = current + offset;
    if (loop) k = ((k % images.length) + images.length) % images.length;
    return k >= 0 && k < images.length && k !== current ? images[k] : null;
  };
  const ghost = (img, tint, strength) => {
    if (!img || img.width !== w || img.height !== h) return;
    for (let i = 0; i < w * h; i++) {
      if (!opaqueAt(img, i)) continue;
      for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(out[i * 4 + c] * (1 - strength) + tint[c] * strength);
    }
  };
  for (let o = before; o >= 1; o--) ghost(pick(-o), RED, 0.28 + 0.2 / o);
  for (let o = after; o >= 1; o--) ghost(pick(o), BLUE, 0.28 + 0.2 / o);
  const cur = images[current];
  if (cur.width === w && cur.height === h) {
    for (let i = 0; i < w * h; i++) if (opaqueAt(cur, i)) out.set([cur.pixels[i * 4], cur.pixels[i * 4 + 1], cur.pixels[i * 4 + 2], 255], i * 4);
  }
  const s = Math.max(1, Math.floor(scale));
  if (s === 1) return {width: w, height: h, pixels: out};
  const big = Buffer.alloc(w * s * h * s * 4);
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) out.copy(big, (y * w * s + x) * 4, (Math.floor(y / s) * w + Math.floor(x / s)) * 4, (Math.floor(y / s) * w + Math.floor(x / s)) * 4 + 4);
  return {width: w * s, height: h * s, pixels: big};
}

/** The onion-skin picture as PNG bytes. */
export const onionSkinPng = (images, options) => { const i = onionSkin(images, options); return encodePixels(i.width, i.height, i.pixels); };

/**
 * One image with an onion-skin panel per frame of the clip, side by side (at most `maxPanels`, evenly taken), each showing
 * that frame in colour over its neighbours' ghosts. Returns {png: Buffer, panels: [frame index], width, height}.
 */
export function onionStrip(images, {loop = false, scale = 3, maxPanels = 12, gap = 2} = {}) {
  const step = Math.max(1, Math.ceil(images.length / maxPanels));
  const picks = images.map((_, i) => i).filter(i => i % step === 0).slice(0, maxPanels);
  const panels = picks.map(i => onionSkin(images, {current: i, loop, scale}));
  const w = panels.reduce((s, p) => s + p.width, 0) + gap * (panels.length - 1), h = panels[0].height;
  const pixels = Buffer.alloc(w * h * 4, 255);
  let x0 = 0;
  for (const p of panels) {
    for (let y = 0; y < h; y++) p.pixels.copy(pixels, (y * w + x0) * 4, y * p.width * 4, (y + 1) * p.width * 4);
    x0 += p.width + gap;
  }
  return {png: encodePixels(w, h, pixels), panels: picks, width: w, height: h};
}
