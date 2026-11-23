// Telegraph shapes as plain geometry (testable without Phaser). Each kind has its own SHAPE so the warning is never
// colour-only (plan 8.3): claw = long bar, seal = full disc with a rim, wail = disc with an open safe wedge, circle/ring = outline.
import type { Hazard } from '../contracts/combat.ts';

export type Shape =
  | { type: 'bar'; points: [number, number][] }
  | { type: 'disc'; x: number; y: number; r: number; rim: boolean }
  | { type: 'wedge-disc'; x: number; y: number; r: number; centre: number; half: number }
  | { type: 'ring'; x: number; y: number; r: number };

export function hazardShape(h: Hazard): Shape {
  switch (h.kind) {
    case 'claw': {
      // rectangle from the owner along dir: `length` long, 2*radius wide
      const nx = -h.dir.y, ny = h.dir.x;
      const ex = h.x + h.dir.x * h.length, ey = h.y + h.dir.y * h.length;
      return { type: 'bar', points: [[h.x + nx * h.radius, h.y + ny * h.radius], [ex + nx * h.radius, ey + ny * h.radius], [ex - nx * h.radius, ey - ny * h.radius], [h.x - nx * h.radius, h.y - ny * h.radius]] };
    }
    case 'seal': return { type: 'disc', x: h.x, y: h.y, r: h.radius, rim: true };
    case 'wail': return { type: 'wedge-disc', x: h.x, y: h.y, r: h.radius, centre: Math.atan2(h.wedge.y, h.wedge.x), half: Math.acos(Math.min(1, Math.max(-1, h.gapCos))) };
    case 'circle': return { type: 'disc', x: h.x, y: h.y, r: h.radius, rim: false };
    default: return { type: 'ring', x: h.x, y: h.y, r: h.radius };
  }
}

/** 0..1 progress of the telegraph (0 just shown, 1 about to land). */
export function hazardProgress(h: Pick<Hazard, 'timer' | 'duration'>): number {
  return h.duration > 0 ? Math.min(1, Math.max(0, 1 - h.timer / h.duration)) : 1;
}
