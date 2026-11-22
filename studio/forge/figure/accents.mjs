// Named accent colours in a brief ("an orange scarf") against the project palette. An image tool is asked for a colour the
// palette may not have: pixelisation then snaps it to the nearest palette colour, and the accent comes back a different
// colour than the brief said (orange became salmon). This module finds the colour words in a brief and says, for each, which
// palette colours are nearest and how far, so the drawing can be prompted for a colour that survives. It never changes the
// palette. The word list is generic English colour naming; nothing here knows a project.

/** Colour word -> a typical sRGB value for it. */
export const COLOUR_WORDS = Object.freeze({
  red: [220, 40, 40], crimson: [190, 20, 50], scarlet: [255, 36, 0], orange: [255, 140, 0], amber: [255, 191, 0], yellow: [255, 225, 40],
  gold: [230, 190, 60], green: [50, 170, 70], lime: [160, 230, 40], teal: [20, 160, 150], cyan: [40, 210, 230], blue: [50, 90, 220],
  azure: [60, 150, 240], indigo: [75, 60, 170], purple: [140, 60, 190], violet: [150, 90, 220], magenta: [220, 40, 180], pink: [250, 130, 180],
  brown: [130, 85, 50], tan: [200, 160, 110], white: [245, 245, 245], black: [20, 20, 20], grey: [128, 128, 128], gray: [128, 128, 128], silver: [190, 195, 200],
});

const hexRgb = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex)); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const rgbHex = rgb => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

function lab([r, g, b]) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const xyz = [(0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, 0.2126 * R + 0.7152 * G + 0.0722 * B, (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883];
  const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** CIE76 colour difference: about 2 is the smallest a person notices; above about 25 reads as another colour. */
export const colourDistance = (a, b) => { const [x, y] = [lab(a), lab(b)]; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };

/** A palette colour that is this close (or closer) to the wanted colour reads as that colour. */
export const NEAR = 25;

/** The `count` palette colours nearest to an sRGB colour: [{id, hex, distance}] (palette: [{id, hex}]). */
export function nearestColours(rgb, palette, count = 3) {
  return palette.map(c => ({ id: c.id, hex: c.hex, rgb: hexRgb(c.hex) })).filter(c => c.rgb)
    .map(c => ({ id: c.id, hex: c.hex, distance: Number(colourDistance(rgb, c.rgb).toFixed(1)) }))
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id)).slice(0, count);
}

/**
 * The colour words of a brief with their nearest palette colours:
 * [{word, item, wanted, nearest: [{id, hex, distance}], survives, advice}] in the order they first appear, one per word.
 * `item` is the word that follows the colour ("scarf"), `survives` is false when no palette colour is within NEAR of the wanted colour.
 */
export function accentsInBrief(brief, palette) {
  const out = [], seen = new Set();
  const re = new RegExp(`\\b(${Object.keys(COLOUR_WORDS).join('|')})\\b(?:[ -]+([a-z]+))?`, 'gi');
  for (const m of String(brief ?? '').matchAll(re)) {
    const word = m[1].toLowerCase();
    if (seen.has(word)) continue;
    seen.add(word);
    const wanted = COLOUR_WORDS[word], nearest = nearestColours(wanted, palette);
    if (!nearest.length) continue;
    const survives = nearest[0].distance <= NEAR;
    const list = nearest.map(n => `${n.id} ${n.hex}`).join(', ');
    out.push({ word, ...(m[2] && !(m[2].toLowerCase() in COLOUR_WORDS) ? { item: m[2].toLowerCase() } : {}), wanted: rgbHex(wanted), nearest, survives,
      advice: survives
        ? `"${word}" has a close palette colour: ${nearest[0].id} ${nearest[0].hex}. Name it in the image prompt and in studio_process accents.`
        : `No palette colour is close to "${word}" (the nearest are ${list}); pixelisation will turn it into one of them. Prompt for the colour you want to see (for example ${nearest[0].id} ${nearest[0].hex}), not "${word}", and name it in studio_process accents.` });
  }
  return out;
}
