// Render the blank labelled template PNG an agent draws on. Guide marks are a dimmed key colour, so
// they still key out as background if the drawer leaves them in place.
import { createImage } from '../image.mjs';
import { assertLayout, cellRect } from './layout.mjs';
import { drawText, glyphHeight, glyphWidth } from './font.mjs';
import { drawGuide, guideShapes } from '../figure/figure.mjs';
import { ghostFigure } from '../figure/lineup.mjs';

/**
 * `figure` (a pack figure guide) adds a silhouette guide with its proportions to every cell, in the same dimmed key colour.
 * `ghost` ((cell) => native frame | null) draws an approved reference character in every cell, to the left of the guide, on the
 * same ground line and at the height of the guide, as a green ghost that keys out as background: the newcomer is drawn next to it.
 */
export function renderTemplate(layoutDoc, {figure, ghost} = {}) {
  const layout = assertLayout(layoutDoc);
  const [width, height] = layout.size;
  const img = createImage(width, height, layout.key.rgb);
  const guide = layout.key.rgb.map(v => Math.round(v * 0.7));
  const plot = (x, y, color = [0, 0, 0]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    img.pixels.set([...color, 255], (y * width + x) * 4);
  };
  const line = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) plot(x, y, guide); };
  for (const cell of layout.cells) {
    const [x0, y0, x1, y1] = cellRect(cell, width, height);
    const cw = x1 - x0, ch = y1 - y0, band = Math.round(ch * layout.labelBand.fraction);
    line(x0, y0, x1 - 1, y0); line(x0, y1 - 1, x1 - 1, y1 - 1); line(x0, y0, x0, y1 - 1); line(x1 - 1, y0, x1 - 1, y1 - 1);
    line(x0, y0 + band, x1 - 1, y0 + band);
    const groundY = y0 + Math.round(ch * layout.ground.fraction);
    for (let x = x0 + 4; x < x1 - 4; x += 12) line(x, groundY, Math.min(x + 5, x1 - 5), groundY + 1);
    const basis = layout.landmarkBasis === 'cell_width' ? cw : ch, m = cell.landmarks;
    const centerX = x0 + Math.round(basis * m.centerX);
    line(centerX, groundY - 8, centerX, groundY + 8);
    const [fa, fb] = m.footWindow.map(f => x0 + Math.round(basis * f));
    line(fa, groundY + 6, fb, groundY + 7);
    line(fa, groundY + 2, fa, groundY + 7); line(fb, groundY + 2, fb, groundY + 7);
    const top = y0 + band + Math.round(ch * 0.06);
    const thick = Math.max(2, Math.round(cw / 170)), pad = 4 + thick;
    const reference = ghost ? ghost(cell) : null;
    if (reference) {
      const H = groundY - top, room = Math.max(0, centerX - Math.round(H * 0.3) - 8 - (x0 + pad));
      let g = ghostFigure(reference, H);
      if (g && g.image.width > room) g = room > 24 ? ghostFigure(reference, Math.floor(H * room / g.image.width)) : null;
      if (g) for (let y = 0; y < g.image.height; y++) for (let x = 0; x < g.image.width; x++) {
        const k = (y * g.image.width + x) * 4;
        if (g.image.pixels[k + 3]) plot(x0 + pad + x + Math.max(0, room - g.image.width), groundY - g.image.height + y, [g.image.pixels[k], g.image.pixels[k + 1], g.image.pixels[k + 2]]);
      }
    }
    if (figure?.guide) {
      drawGuide(guideShapes(figure, {cx: centerX, ground: groundY, top, minX: x0 + pad, maxX: x1 - pad}), (x, y) => plot(x, y, guide), thick);
    }
    const textWidth = cell.label.length * (glyphWidth + 1) - 1;
    const scale = Math.max(1, Math.min(Math.floor((band - 4) / glyphHeight), Math.floor((cw - 8) / textWidth)));
    drawText(cell.label, x0 + 4, y0 + Math.max(1, Math.floor((band - glyphHeight * scale) / 2)), scale, (x, y) => plot(x, y));
  }
  return img;
}
