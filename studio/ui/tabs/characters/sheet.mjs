// Contact sheet: every clip of a character, one row per facing, frames at an integer scale.
// Pure layout plus PNG assembly with the forge's image primitives; deterministic for equal inputs.
import { readInside } from '../../../core/files.mjs';
import { createImage, decodePng, encodePng, blit, upscale, hexToRgb } from '../../../forge/image.mjs';
import { drawText, canDraw } from '../../../forge/sheet/font.mjs';
import { GUTTER, PAD, LABEL_SCALE, glyphHeight, maxSheetPixels, layoutSheet, labelWidthFor, largestScale } from './layout.mjs';

export { layoutSheet, largestScale, maxSheetPixels };

const upper = text => [...text.toUpperCase()].map(ch => canDraw(ch) ? ch : '-').join('');

export async function contactSheet({root, frames, facings, scale, clip, title, background = '#202020', foreground = '#d0d0d0'}) {
  // Size the sheet from the first frame and refuse before decoding or allocating anything large.
  const first = decodePng(await readInside(root, frames[0].path));
  const size = [first.width, first.height];
  const labelWidth = labelWidthFor(facings);
  const layout = layoutSheet({frames, facings, scale, clip, size, labelWidth});
  if (layout.width * layout.height > maxSheetPixels) {
    const largest = largestScale({frames, facings, clip, size});
    throw Object.assign(new Error(`This sheet would be ${layout.width}x${layout.height} px, over the ${maxSheetPixels / 1e6} MP limit. ` +
      (largest ? `The largest scale for this character${clip ? ' and clip' : ''} is ${largest}.` : 'Even scale 1 is too large; export one clip.')), {status: 422, code: 'sheet_too_large', largestScale: largest});
  }
  const images = new Map([[frames[0].path, first]]);
  for (const f of frames) if (!images.has(f.path)) images.set(f.path, decodePng(await readInside(root, f.path)));
  for (const [path, img] of images) if (img.width !== size[0] || img.height !== size[1]) throw new Error(`Frame ${path} is not ${size.join('x')}`);
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
