// Second fixture: a code-drawn biped with its own twelve-colour palette (nothing shared with the marten
// or the project palette). East is a mirror of west, so the asymmetric badge has to be swapped away there.
import { createFrame, makePalette, outline, setPixel } from '../../raster.mjs';

export const bipedPaletteData = {
  outline_id: 'bp_ink',
  colors: [
    ['bp_ink', '#0d1b2a'], ['bp_skin', '#e0a46f'], ['bp_skin_lo', '#b97c4a'], ['bp_hair', '#3b2a6f'],
    ['bp_eye', '#17324d'], ['bp_cloth', '#2f7f5f'], ['bp_cloth_hi', '#58b383'], ['bp_belt', '#c9a227'],
    ['bp_trouser', '#4a4f6a'], ['bp_boot', '#6b3f2a'], ['bp_badge', '#f2f06a'], ['bp_spare', '#8a8fa8']
  ].map(([id, hex]) => ({id, hex}))
};
export const bipedPalette = () => makePalette(bipedPaletteData);

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

function paint(frame, palette, color, x0, y0, x1, y1) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPixel(frame, x, y, palette.rgb(color));
}

/** Outline-free layer for one drawn facing (south, west, north). */
function layer(facing, palette) {
  const f = createFrame(32, 32);
  const p = (c, ...box) => paint(f, palette, c, ...box);
  if (facing === 'west') {
    p('bp_cloth', 14, 11, 17, 19); p('bp_cloth_hi', 14, 11, 14, 19); p('bp_belt', 14, 17, 17, 17);
    p('bp_cloth', 12, 11, 13, 16); p('bp_skin', 12, 17, 13, 18);
    p('bp_cloth', 18, 11, 19, 16); p('bp_skin_lo', 18, 17, 19, 18);
    p('bp_trouser', 13, 20, 15, 25); p('bp_boot', 13, 26, 15, 27);
    p('bp_trouser', 16, 20, 18, 25); p('bp_boot', 16, 26, 18, 27);
    p('bp_skin', 12, 5, 17, 10); p('bp_hair', 12, 5, 17, 6); p('bp_hair', 15, 7, 17, 10); p('bp_eye', 12, 8, 12, 8);
    setPixel(f, 15, 13, palette.rgb('bp_badge')); setPixel(f, 15, 14, palette.rgb('bp_badge'));
    return f;
  }
  const front = facing === 'south';
  p('bp_cloth', 12, 11, 19, 19); p('bp_cloth_hi', 12, 11, 13, 19); p('bp_belt', 12, 17, 19, 17);
  p('bp_cloth', 10, 11, 11, 16); p('bp_skin', 10, 17, 11, 18);
  p('bp_cloth', 20, 11, 21, 16); p('bp_skin', 20, 17, 21, 18);
  p('bp_trouser', 12, 20, 15, 25); p('bp_boot', 12, 26, 15, 27);
  p('bp_trouser', 16, 20, 19, 25); p('bp_boot', 16, 26, 19, 27);
  p(front ? 'bp_skin' : 'bp_hair', 13, 5, 18, 10);
  p('bp_hair', 13, 5, 18, 6);
  if (front) { setPixel(f, 14, 8, palette.rgb('bp_eye')); setPixel(f, 17, 8, palette.rgb('bp_eye')); }
  // Badge on the anatomical left chest: screen-right facing the camera, screen-left from behind.
  const bx = front ? 18 : 13;
  setPixel(f, bx, 13, palette.rgb('bp_badge')); setPixel(f, bx, 14, palette.rgb('bp_badge'));
  return f;
}

const leg = (id, phase, x0, x1, cx) => ({id, role: 'leg', phase, contact: [cx, 27], cut: rect(x0, 18, x1, 27), remove: rect(x0, 20, x1, 27)});
const arm = (id, phase, x0, x1, jx) => ({id, role: 'arm', phase, joint: [jx, 11], cut: rect(x0, 11, x1, 18), remove: rect(x0, 11, x1, 18)});
const head = (x0, x1, jx) => ({id: 'head', role: 'head', joint: [jx, 10], cut: rect(x0, 4, x1, 11), remove: rect(x0, 4, x1, 10)});
const body = {id: 'body', role: 'body'};
const badge = (box, pixels, extra = {}) => ({id: 'badge', color: 'bp_badge', box, pixels, follows: 'body', ...extra});

export const bipedRig = {
  schema: 'studio.rig', version: 1, id: 'fx_biped', bodyPlan: 'biped', canvas: [32, 32], pivot: [16, 29],
  facings: {
    south: {
      forward: [0, 1],
      parts: [arm('arm_0', 0, 10, 11, 11), arm('arm_1', 1, 20, 21, 20), leg('leg_0', 0, 12, 15, 13), leg('leg_1', 1, 16, 19, 18), head(13, 18, 15), body],
      landmarks: [badge([17, 12, 20, 16], [[18, 13], [18, 14]])],
      features: [{id: 'face', box: [13, 5, 19, 11], minAccents: 2}]
    },
    west: {
      forward: [-1, 0],
      parts: [arm('arm_far', 1, 18, 19, 18), arm('arm_near', 0, 12, 13, 13), leg('leg_0', 0, 13, 15, 14), leg('leg_1', 1, 16, 18, 17), head(12, 17, 15), body],
      landmarks: [badge([14, 12, 17, 16], [[15, 13], [15, 14]])]
    },
    north: {
      forward: [0, -1],
      parts: [arm('arm_0', 0, 10, 11, 11), arm('arm_1', 1, 20, 21, 20), leg('leg_0', 0, 12, 15, 13), leg('leg_1', 1, 16, 19, 18), head(13, 18, 15), body],
      landmarks: [badge([12, 12, 15, 16], [[13, 13], [13, 14]])]
    },
    east: {
      mirrorOf: 'west',
      // The badge is on the left side, which faces away from the camera when walking east.
      swapColors: {bp_badge: 'bp_cloth_hi'},
      landmarks: [badge([14, 12, 18, 16], [], {expect: 'absent'})]
    }
  }
};

/** Native turnaround frames (outlined) for the drawn facings. */
export function bipedNative(palette = bipedPalette()) {
  return Object.fromEntries(['south', 'west', 'north'].map(f => [f, outline(layer(f, palette), palette.outline)]));
}
