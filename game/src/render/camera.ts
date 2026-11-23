// Pixel-perfect view (plan E0.4): the logical 384x216 canvas is shown at a WHOLE-NUMBER multiple of DEVICE pixels,
// centred, with letterbox bars. Working in device pixels (css * devicePixelRatio) matters on phones: an 844x390 CSS-px
// landscape iPhone at DPR 3 is 2532x1170 device px, which fits x5 (1920x1080), where css-px maths would only allow x1.
import { VIEW_H, VIEW_W } from '../contracts/world.ts';

export interface ViewFit {
  /** Integer device-pixel multiple of the logical canvas (>= 1). */
  scale: number;
  /** Size and offset of the canvas in CSS px (fractional when devicePixelRatio is not an integer). */
  cssW: number;
  cssH: number;
  left: number;
  top: number;
}

export function fitView(cssWidth: number, cssHeight: number, dpr: number): ViewFit {
  const d = dpr > 0 ? dpr : 1;
  const scale = Math.max(1, Math.floor(Math.min((cssWidth * d) / VIEW_W, (cssHeight * d) / VIEW_H) + 1e-9));
  const cssW = (VIEW_W * scale) / d;
  const cssH = (VIEW_H * scale) / d;
  return { scale, cssW, cssH, left: (cssWidth - cssW) / 2, top: (cssHeight - cssH) / 2 };
}

/** Portrait means the window is taller than wide: the game asks the player to rotate (landscape only). */
export function isPortrait(cssWidth: number, cssHeight: number): boolean {
  return cssHeight > cssWidth;
}

/**
 * Scroll and shake offsets are applied in WHOLE logical pixels. A fractional offset on a pixel-art canvas that is then
 * scaled by an integer makes some pixel columns wider than others (shimmer); rounding keeps every pixel the same size.
 * Half-way values round toward +infinity consistently (Math.round), and -0 is normalised to 0.
 */
export function snapPx(v: number): number { return Math.round(v) + 0; }

/**
 * Follow scroll inside a room bigger than the view (a 24x14-cell room is 384x224, the view 384x216): centre on the
 * player, clamped to the room edges so the last wall row is always reachable and no background shows past the room.
 * Whole logical pixels; a room that fits the view does not scroll on that axis.
 */
export function followScroll(roomW: number, roomH: number, px: number, py: number): { x: number; y: number } {
  const axis = (room: number, view: number, p: number): number => (room <= view ? 0 : snapPx(Math.min(room - view, Math.max(0, p - view / 2))));
  return { x: axis(roomW, VIEW_W, px), y: axis(roomH, VIEW_H, py) };
}
