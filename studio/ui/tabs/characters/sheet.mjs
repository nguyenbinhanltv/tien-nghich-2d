// Contact sheet: every clip of a character, one row per facing, frames at an integer scale.
// Pure layout plus PNG assembly with the forge's image primitives; deterministic for equal inputs.
import { readInside } from '../../../core/files.mjs';
import { createImage, decodePng, encodePng, blit, upscale, hexToRgb } from '../../../forge/image.mjs';
import { drawText, canDraw, glyphHeight } from '../../../forge/sheet/font.mjs';

const GUTTER = 2, PAD = 6, LABEL_SCALE = 1;

const upper = text => [...text.toUpperCase()].map(ch => canDraw(ch) ? ch : '-').join('');

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

export async function contactSheet({root, frames, facings, scale, clip, title, background = '#14101a', foreground = '#d4d0d8'}) {
  const images = new Map();
  for (const f of frames) images.set(f.path, decodePng(await readInside(root, f.path)));
  const size = [images.get(frames[0].path).width, images.get(frames[0].path).height];
  for (const [path, img] of images) if (img.width !== size[0] || img.height !== size[1]) throw new Error(`Frame ${path} is not ${size.join('x')}`);
  const labelWidth = (Math.max(...facings.map(f => f.length)) * 6 + 2) * LABEL_SCALE + PAD;
  const layout = layoutSheet({frames, facings, scale, clip, size, labelWidth});
  const sheet = createImage(layout.width, layout.height, hexToRgb(background));
  const ink = hexToRgb(foreground);
  const text = (value, x, y) => drawText(upper(value), x, y, LABEL_SCALE, (px, py) => {
    if (px >= 0 && py >= 0 && px < sheet.width && py < sheet.height) sheet.data.set([...ink, 255], (py * sheet.width + px) * 4);
  });
  text(`${title}  ${scale}X`, PAD, PAD);
  let lastClip = null;
  for (const row of layout.rows) {
    if (row.clip !== lastClip) { text(row.clip, PAD, row.y - glyphHeight - GUTTER); lastClip = row.clip; }
    text(row.facing, PAD, row.y + 2);
    for (const cell of row.frames) blit(sheet, upscale(images.get(cell.path), scale), cell.x, row.y, 'opaque');
  }
  return Buffer.from(encodePng(sheet));
}
