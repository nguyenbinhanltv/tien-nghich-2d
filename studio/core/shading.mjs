// Palette-bound drawing helpers (idea A6): colour ramps, Bayer dithering, material patterns and directional shading.
// Everything here returns palette ids chosen from the project's own palette; there is no code path that makes a colour,
// so an off-palette colour cannot come out. The ideas are the common ones (hue-shifted ramps, ordered dithering);
// the code is written for this studio. Pure functions: no files, no images, only palette entries ({id, hex, group?}).

export const LIGHTS = { tl: [-1, -1], t: [0, -1], tr: [1, -1], l: [-1, 0], r: [1, 0], bl: [-1, 1], b: [0, 1], br: [1, 1] };
export const PATTERNS = ['checker', 'stripes_h', 'stripes_v', 'diagonal', 'brick', 'scales', 'speckle'];
export const BAYER_SIZES = [2, 4, 8];

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
export const lumaOf = (hex) => { const [r, g, b] = rgbOf(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function toHsl(hex) {
  const [r, g, b] = rgbOf(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** The palette entries a ramp may use: everything but the outline colour. */
const usable = (colors, outlineId) => colors.filter((c) => c.id !== outlineId);

/** The ramp of a palette group: its ids from dark to light. [] for an unknown group. */
export function groupRamp(colors, group, outlineId = null) {
  return usable(colors, outlineId).filter((c) => c.group === group).sort((a, b) => lumaOf(a.hex) - lumaOf(b.hex) || a.id.localeCompare(b.id)).map((c) => c.id);
}

/** The group ramp that holds `id`, with the index of `id` in it; null when `id` has no group or is the outline colour. */
export function rampAround(colors, id, outlineId = null) {
  const entry = colors.find((c) => c.id === id);
  if (!entry || id === outlineId || entry.group == null) return null;
  const ramp = groupRamp(colors, entry.group, outlineId);
  return { ramp, index: ramp.indexOf(id), group: entry.group };
}

/**
 * A hue-shifted ramp around `baseId`, dark to light, every step a palette entry. Shadows lean toward cool (250 degrees), lights toward warm
 * (55 degrees) by up to `shift` degrees; each step takes the NEAREST palette colour to the ideal one, so it can cross groups when the palette
 * has no closer colour. Fewer steps come back when the palette has too few distinct colours near the base.
 */
export function hueShiftRamp(colors, baseId, { steps = 5, shift = 24, outlineId = null } = {}) {
  const pool = usable(colors, outlineId);
  const base = pool.find((c) => c.id === baseId);
  if (!base) throw new Error(`ramp base "${baseId}" is not a palette colour (or is the outline colour)`);
  if (!Number.isFinite(shift) || shift < 0 || shift > 180) throw new Error('ramp shift must be a number of degrees from 0 to 180');
  if (!Number.isInteger(steps) || steps < 2 || steps > 9) throw new Error('ramp steps must be an integer from 2 to 9');
  const b = toHsl(base.hex), hsl = pool.map((c) => ({ id: c.id, ...toHsl(c.hex) }));
  const chosen = new Map();
  for (let i = 0; i < steps; i++) {
    const t = (i - (steps - 1) / 2) / ((steps - 1) / 2);
    const goal = Math.abs(t) * shift, toward = t > 0 ? 55 : 250;
    const delta = ((toward - b.h + 540) % 360) - 180;
    const want = { h: (b.h + Math.sign(delta) * Math.min(Math.abs(delta), goal) + 360) % 360, s: b.s * (1 - 0.12 * Math.abs(t)), l: Math.min(0.94, Math.max(0.06, b.l + t * 0.2)) };
    let best = null;
    for (const c of hsl) {
      if (chosen.has(c.id)) continue;
      const d = (hueGap(c.h, want.h) / 180) * Math.min(c.s, want.s) * 1.5 + Math.abs(c.s - want.s) * 0.6 + Math.abs(c.l - want.l) * 1.6;
      if (!best || d < best.d || (d === best.d && c.id < best.id)) best = { id: c.id, d };
    }
    if (best) chosen.set(best.id, true);
  }
  return [...chosen.keys()].sort((a, c) => lumaOf(pool.find((p) => p.id === a).hex) - lumaOf(pool.find((p) => p.id === c).hex) || a.localeCompare(c));
}

function bayerMatrix(n) {
  if (n === 2) return [[0, 2], [3, 1]];
  const h = bayerMatrix(n / 2), out = [];
  for (let y = 0; y < n; y++) { out.push([]); for (let x = 0; x < n; x++) out[y].push(4 * h[y % (n / 2)][x % (n / 2)] + [[0, 2], [3, 1]][Math.floor(y / (n / 2))][Math.floor(x / (n / 2))]); }
  return out;
}
const MATRICES = Object.fromEntries(BAYER_SIZES.map((n) => [n, bayerMatrix(n)]));

/** Ordered (Bayer) dither threshold in (0, 1) for pixel (x, y). */
export function bayer(x, y, size = 4) {
  const m = MATRICES[size];
  if (!m) throw new Error(`Bayer size must be one of ${BAYER_SIZES.join(', ')}`);
  return (m[((y % size) + size) % size][((x % size) + size) % size] + 0.5) / (size * size);
}

/** True when the dithered mix at (x, y) takes the second colour: `ratio` 0 never, 1 always. */
export const ditherAt = (x, y, ratio, size = 4) => ratio > bayer(x, y, size);

/** A material pattern: 1 where the pattern is its second colour, 0 where its first. Deterministic and tileable. */
export function patternAt(name, x, y) {
  switch (name) {
    case 'checker': return (x + y) & 1;
    case 'stripes_h': return y & 1;
    case 'stripes_v': return x & 1;
    case 'diagonal': return ((x + y) >> 1) & 1;
    case 'brick': { const row = y >> 1; return (y & 1) === 1 || ((x + (row & 1) * 2) & 3) === 0 ? 1 : 0; }
    case 'scales': { const row = y >> 1, xx = x + (row & 1) * 2; return ((xx & 3) === 0 || (y & 1) === 1 && (xx & 3) === 3) ? 1 : 0; }
    case 'speckle': return ((x * 7 + y * 13 + ((x * y) % 5)) % 11) === 0 ? 1 : 0;
    default: throw new Error(`unknown pattern "${name}" (${PATTERNS.join(', ')})`);
  }
}

/** How far along the light, 0 (the lit edge) to 1 (the far edge), pixel (x, y) is inside `box` = [x0, y0, x1, y1). */
export function lightPosition(light, box, x, y) {
  const v = LIGHTS[light];
  if (!v) throw new Error(`unknown light "${light}" (${Object.keys(LIGHTS).join(', ')})`);
  const [x0, y0, x1, y1] = box;
  const proj = (px, py) => -(px * v[0] + py * v[1]);
  const corners = [proj(x0, y0), proj(x1 - 1, y0), proj(x0, y1 - 1), proj(x1 - 1, y1 - 1)];
  const lo = Math.min(...corners), hi = Math.max(...corners);
  return hi === lo ? 0.5 : (proj(x, y) - lo) / (hi - lo);
}

/**
 * Shade one colour for the light: the lit third moves up its ramp, the far third down, the middle stays. The result is always in the SAME
 * group ramp as `id` (clamped at its ends); a colour with no ramp (no group, or the outline) comes back unchanged.
 */
export function shadeId(colors, id, position, { strength = 1, outlineId = null } = {}) {
  const around = rampAround(colors, id, outlineId);
  if (!around) return id;
  const delta = position < 1 / 3 ? strength : position > 2 / 3 ? -strength : 0;
  return around.ramp[Math.min(around.ramp.length - 1, Math.max(0, around.index + delta))];
}
