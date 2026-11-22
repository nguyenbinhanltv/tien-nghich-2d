// Pure contact-sheet geometry, shared by the server (which draws the sheet) and the client (which
// only offers scales the server will accept). No imports, so it runs in both.
export const glyphHeight = 7;
export const GUTTER = 2, PAD = 6, LABEL_SCALE = 1;

/** Largest sheet the server will build, in pixels: 16 MP is about 64 MB of RGBA. */
export const maxSheetPixels = 16_000_000;

/**
 * Where everything goes. Rows are clips in the order of first appearance, then facings in the given order
 * (facings the character lacks are skipped). `size` is the native frame size; all frames of a character share it.
 */
export function layoutSheet({frames, facings, scale, clip = null, size, labelWidth}) {
  const clips = [...new Set(frames.map(f => f.clip))].filter(c => !clip || c === clip);
  const rows = [];
  let y = PAD + glyphHeight * 2 + PAD;
  for (const name of clips) {
    y += glyphHeight + GUTTER;
    for (const facing of facings) {
      const list = frames.filter(f => f.clip === name && f.direction === facing).sort((a, b) => a.n - b.n);
      if (!list.length) continue;
      rows.push({clip: name, facing, y, frames: list.map((f, i) => ({path: f.path, n: f.n, x: PAD + labelWidth + i * (size[0] * scale + GUTTER)}))});
      y += size[1] * scale + GUTTER;
    }
    y += PAD;
  }
  const columns = Math.max(0, ...rows.map(r => r.frames.length));
  return {rows, width: PAD * 2 + labelWidth + columns * (size[0] * scale + GUTTER), height: y};
}


/** Label column width for the longest facing name. */
export const labelWidthFor = facings => (Math.max(...facings.map(f => f.length)) * 6 + 2) * LABEL_SCALE + PAD;

/** The largest integer scale (1..8) whose sheet fits the pixel budget, or 0 if even 1x does not fit. */
export function largestScale({frames, facings, clip = null, size}) {
  const labelWidth = labelWidthFor(facings);
  for (let scale = 8; scale >= 1; scale--) {
    const {width, height} = layoutSheet({frames, facings, scale, clip, size, labelWidth});
    if (width * height <= maxSheetPixels) return scale;
  }
  return 0;
}
