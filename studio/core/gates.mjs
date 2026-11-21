// Pixel gates: palette membership, binary alpha, canvas size and the silhouette-outline rule.
// Messages and ordering mirror the project Python palette validator so JS and Python agree.
import { decodeRgba } from './png.mjs';

const hex = n => n.toString(16).padStart(6, '0');

export function checkSize(width, height, spec) {
  let ok, want;
  if (spec.sizes) {
    ok = spec.sizes.some(([w, h]) => w === width && h === height);
    want = spec.sizes.map(([w, h]) => `${w}x${h}`).join(' or ');
  } else {
    const {min: lo, max: hi} = spec;
    ok = lo[0] <= width && width <= hi[0] && lo[1] <= height && height <= hi[1] && (width === height || !spec.square);
    want = `${lo[0]}x${lo[1]}..${hi[0]}x${hi[1]}` + (spec.square ? ' square' : '');
  }
  return ok ? null : `canvas ${width}x${height} does not match size class (${want})`;
}

/**
 * Run the gates on RGBA bytes.
 * options: {palette: Set<int>, outline: int|undefined, needOutline = true, borderIsEdge = false, sizeSpec}
 * Returns {errors, warnings}.
 */
export function checkPixels({width, height, pixels}, options) {
  const {palette, outline, needOutline = true, borderIsEdge = false, sizeSpec} = options;
  const errors = [], warnings = [];
  if (sizeSpec) {
    const message = checkSize(width, height, sizeSpec);
    if (message) errors.push(message);
  }
  const at = (x, y) => (y * width + x) * 4;
  const inside = (x, y) => x >= 0 && x < width && y >= 0 && y < height;
  const opaque = (x, y) => inside(x, y) && pixels[at(x, y) + 3] === 255;
  const transparent = (x, y) => inside(x, y) ? pixels[at(x, y) + 3] === 0 : borderIsEdge;
  const rgb = (x, y) => pixels.readUIntBE(at(x, y), 3);
  const offPalette = new Map(), badEdge = [];
  let soft = 0, edges = 0, thick = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[at(x, y) + 3];
      if (alpha === 0) continue;
      if (alpha !== 255) { soft++; continue; }
      const color = rgb(x, y);
      if (!palette.has(color)) offPalette.set(color, (offPalette.get(color) ?? 0) + 1);
      const around = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      if (!around.some(([nx, ny]) => transparent(nx, ny))) continue;
      edges++;
      if (color !== outline) badEdge.push([x, y]);
      else {
        const inward = around.filter(([nx, ny]) => opaque(nx, ny));
        if (inward.length && inward.every(([nx, ny]) => rgb(nx, ny) === outline)) thick++;
      }
    }
  }
  if (edges === 0) errors.push('no opaque pixels / no silhouette edge found');
  if (soft) errors.push(`${soft} semi-transparent pixel(s); alpha must be 0 or 255`);
  [...offPalette].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .forEach(([color, n]) => errors.push(`${n} px off-palette color #${hex(color)}`));
  if (offPalette.size > 5) errors.push(`... ${offPalette.size} distinct off-palette colors total`);
  if (needOutline && badEdge.length) {
    const sample = badEdge.slice(0, 3).map(([x, y]) => `(${x}, ${y})`).join(', ');
    errors.push(`${badEdge.length}/${edges} edge pixel(s) are not outline #${hex(outline)}, e.g. [${sample}]`);
  }
  if (edges && thick * 4 > edges) warnings.push(`outline may be thicker than 1px (${thick}/${edges} edge px backed by outline)`);
  return {errors, warnings};
}

/** Decode PNG bytes and run the gates; unreadable files report a single error. */
export function checkPng(bytes, options) {
  let image;
  try { image = decodeRgba(bytes); }
  catch (error) { return {errors: [`cannot read: ${error.message}`], warnings: []}; }
  return checkPixels(image, options);
}

/**
 * Gate options for a pack: palette ints, outline colour, border rule and an optional size class,
 * all taken from the pack and its palette file data ({colors, outline} already parsed).
 */
export function gateOptions(pack, palette, {sizeClass, outlineOptional = false} = {}) {
  const rule = pack.rules.outline;
  let sizeSpec;
  if (sizeClass) {
    sizeSpec = pack.sizeClasses[sizeClass];
    if (!sizeSpec) throw new Error(`Unknown size class "${sizeClass}"`);
  }
  const outline = rule.color === 'palette' ? palette.outline : parseInt(rule.color.slice(1), 16);
  return {palette: palette.colors, outline, needOutline: rule.mode !== 'none' && !outlineOptional,
    borderIsEdge: rule.borderIsEdge, sizeSpec};
}
