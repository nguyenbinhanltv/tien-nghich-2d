// Rig baker: native turnaround frames + rig + resolved motion -> native frames per facing.
// Everything composites at native resolution, the outline is rebuilt on every key, the canvas (and so the
// pivot) never moves, and a facing is mirrored only when the rig says it is a mirror of another facing.
import { cloneFrame, createFrame, flipHorizontal, isColor, maskPart, outline, place, polygonMask, rotateNearest, setPixel, alphaAt } from '../image.mjs';
import { resolveClip } from '../motion/resolve.mjs';
import { applyPatch, patchKey } from './patch.mjs';

export const frameName = (clip, facing, index) => `${clip}_${facing}_${index}`;

function clearPolygon(frame, polygon) {
  const mask = polygonMask(frame.width, frame.height, polygon);
  for (let i = 0; i < mask.length; i++) if (mask[i]) frame.pixels.fill(0, i * 4, i * 4 + 4);
}

/**
 * Prepare one facing: apply the landmark repairs, then cut every part out of the turnaround.
 * Returns {parts: [{spec, pixels}]} in draw order; the `body` entry is what remains after every `remove`.
 */
export function prepareFacing(native, facing, palette) {
  const layer = cloneFrame(native);
  for (const mark of facing.landmarks ?? []) {
    if (!mark.color) continue;
    const color = palette.rgb(mark.color);
    // Stray marker pixels from the source image are toned down first, then the authored pixels are set.
    if (mark.fallback) {
      const fallback = palette.rgb(mark.fallback);
      for (let y = 0; y < layer.height; y++) for (let x = 0; x < layer.width; x++) if (isColor(layer, x, y, color)) setPixel(layer, x, y, fallback);
    }
    for (const [x, y] of mark.pixels ?? []) {
      if (alphaAt(layer, x, y) !== 255) throw new Error(`landmark "${mark.id}" pixel ${x},${y} is outside the silhouette`);
      setPixel(layer, x, y, color);
    }
  }
  const body = cloneFrame(layer);
  for (const spec of facing.parts) if (spec.role !== 'body') clearPolygon(body, spec.remove);
  const parts = facing.parts.map(spec => ({spec, pixels: spec.role === 'body' ? body : maskPart(layer, spec.cut)}));
  return {parts};
}

/** Composite one key. `pose` is one entry of resolveClip(...).poses. Returns {frame, contacts}. */
export function bakeKey(prepared, facing, pose, palette, {edgeSafe = true} = {}) {
  const {width, height} = prepared.parts[0].pixels;
  const frame = createFrame(width, height);
  const contacts = [];
  for (const {spec, pixels} of prepared.parts) {
    const slot = pose.parts[spec.id] ?? {dx: 0, dy: 0, rotate: 0};
    const source = slot.rotate ? rotateNearest(pixels, slot.rotate, spec.joint) : pixels;
    const footprint = place(frame, source, slot.dx, slot.dy);
    if (spec.contact) {
      const x = spec.contact[0] + slot.dx, y = spec.contact[1] + slot.dy;
      if (!footprint[y * width + x]) throw new Error(`contact of "${spec.id}" missing from its cut at ${x},${y}`);
      contacts.push({id: spec.id, xy: [x, y], planted: pose.contacts[spec.id]?.planted ?? true});
    }
  }
  for (const c of contacts) {
    if (alphaAt(frame, c.xy[0], c.xy[1]) !== 255) throw new Error('contact disappeared in composite');
  }
  if (edgeSafe) {
    for (let x = 0; x < width; x++) if (alphaAt(frame, x, 0) || alphaAt(frame, x, height - 1)) throw new Error('baked sprite reaches canvas boundary');
    for (let y = 0; y < height; y++) if (alphaAt(frame, 0, y) || alphaAt(frame, width - 1, y)) throw new Error('baked sprite reaches canvas boundary');
  }
  return {frame: outline(frame, palette.outline), contacts};
}

export function mirrorFacing(source, facing, palette, canvasWidth) {
  const swap = Object.entries(facing.swapColors ?? {}).map(([from, to]) => [palette.rgb(from), palette.rgb(to)]);
  const frames = source.frames.map(f => {
    const flipped = flipHorizontal(f);
    for (let y = 0; y < flipped.height; y++) for (let x = 0; x < flipped.width; x++) {
      for (const [from, to] of swap) if (isColor(flipped, x, y, from)) { setPixel(flipped, x, y, to); break; }
    }
    return flipped;
  });
  const contacts = source.contacts.map(list => list.map(c => ({...c, xy: [canvasWidth - 1 - c.xy[0], c.xy[1]]})));
  return {frames, contacts};
}

/**
 * Bake one clip for every facing of the rig.
 * options: {rig, native: {facing: Frame}, template, clip: {frames, durationMs}, clipName, palette, plan, patch}
 * Returns {clip, durationMs, loop, facings: {facing: {frames, contacts, poses}}}.
 */
export function bakeClip({rig, native, template, clip, clipName, palette, plan, patch, edgeSafe}) {
  const result = {clip: clipName, durationMs: clip.durationMs, loop: template.loop !== false, facings: {}};
  const prepared = {};
  const baked = {};
  const bakeOne = name => {
    if (baked[name]) return baked[name];
    const facing = rig.facings[name];
    if (facing.mirrorOf) {
      const src = bakeOne(facing.mirrorOf);
      return (baked[name] = {...mirrorFacing(src, facing, palette, rig.canvas[0]), poses: src.poses});
    }
    if (!native[name]) throw new Error(`no native turnaround frame for facing "${name}"`);
    prepared[name] ??= prepareFacing(native[name], facing, palette);
    const resolved = resolveClip(template, clip, facing, plan);
    const frames = [], contacts = [];
    for (let i = 0; i < clip.frames; i++) {
      const out = bakeKey(prepared[name], facing, resolved.poses[i], palette, {edgeSafe});
      frames.push(out.frame); contacts.push(out.contacts);
    }
    return (baked[name] = {frames, contacts, poses: resolved.poses});
  };
  for (const name of Object.keys(rig.facings)) bakeOne(name);
  // Patches apply to the finished frames of each facing, after every bake and mirror has completed.
  const lookup = (facing, index) => baked[facing]?.frames[index] ?? null;
  for (const name of Object.keys(rig.facings)) {
    const out = baked[name];
    const frames = patch
      ? out.frames.map((f, i) => applyPatch(f, patch.frames?.[patchKey(clipName, name, i)], palette, {lookup}))
      : out.frames;
    result.facings[name] = {...out, frames};
  }
  return result;
}
