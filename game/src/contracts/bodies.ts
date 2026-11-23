// Runtime view of bodies.json (schema: game/schemas/bodies.schema.json, spec: docs/KILN_GAME_CONTRACT.md section 2).
export interface Box { x: number; y: number; w: number; h: number }
export interface HitBox extends Box { id: string }
export interface FrameBodies { hurtbox?: Box; hitboxes?: HitBox[] }
export interface Body {
  frameSize: [number, number];
  pivot: [number, number];
  hurtbox: Box;
  review: { status: 'draft-unreviewed' | 'owner-approved'; source: 'alpha-auto' | 'hand'; approvalRef?: string };
  clips?: Record<string, { frames: Record<string, FrameBodies> }>;
}

/** West is east mirrored (art rule): x' = frameWidth - (x + w). The pivot mirrors the same way (pivot x' = frameWidth - 1 - x). */
export function mirrorBox(b: Box, frameWidth: number): Box { return { ...b, x: frameWidth - (b.x + b.w) }; }

/** Boxes of one frame in WORLD space for an actor standing at (wx, wy) on its pivot. `flipX` is true for a mirrored facing. */
export function worldBoxes(body: Body, clip: string, frame: number, wx: number, wy: number, flipX: boolean): { hurtbox: Box; hitboxes: HitBox[] } {
  const f = body.clips?.[clip]?.frames[String(frame)];
  const [fw] = body.frameSize;
  const px = flipX ? fw - 1 - body.pivot[0] : body.pivot[0];
  const place = <T extends Box>(b: T): T => {
    const m = flipX ? mirrorBox(b, fw) : b;
    return { ...b, x: wx + m.x - px, y: wy + m.y - body.pivot[1] };
  };
  return { hurtbox: place(f?.hurtbox ?? body.hurtbox), hitboxes: (f?.hitboxes ?? []).map(place) };
}
