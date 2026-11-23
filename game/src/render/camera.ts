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
