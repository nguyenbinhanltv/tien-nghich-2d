// PixiJS spritesheet JSON, one file per page (the format `Spritesheet` parses): frames with an `anchor` from the pivot, `animations`
// listing frame names in play order, and `meta`. A multi-page atlas gets `related_multi_packs`. Loaded in PixiJS 8.23.0.
import { json, clipName } from './common.mjs';

export const id = 'pixi';
export const label = {en: 'PixiJS', vi: 'PixiJS'};

export async function build(desc) {
  const files = [], copies = desc.pages.map(p => ({page: p.index, name: `pixi/${p.image}`}));
  for (const p of desc.pages) {
    const mine = desc.frames.filter(f => f.page === p.index), keys = new Set(mine.map(f => f.key));
    const frames = Object.fromEntries(mine.map(f => [f.key, {frame: {x: f.x, y: f.y, w: f.w, h: f.h}, rotated: false, trimmed: false, spriteSourceSize: {x: 0, y: 0, w: f.w, h: f.h},
      sourceSize: {w: f.w, h: f.h}, ...(f.pivotPx ? {anchor: {x: f.pivotPx[0] / f.w, y: f.pivotPx[1] / f.h}} : {})}]));
    // Only clips that lie wholly on this page: Pixi resolves an animation's frame names inside its own sheet, and two sheets holding
    // different parts of one name would overwrite each other once every page is loaded. Split clips are in animations.json.
    const animations = Object.fromEntries(desc.clips.filter(c => c.frames.length && c.frames.every(k => keys.has(k))).map(c => [`${c.asset}/${clipName(c)}`, c.frames]));
    files.push({name: `pixi/${p.name}.json`, data: json({frames, animations, meta: {app: 'Pixel Kiln export', version: '1', image: p.image, format: 'RGBA8888', size: {w: p.width, h: p.height}, scale: '1',
      ...(desc.pages.length > 1 ? {related_multi_packs: desc.pages.filter(q => q.index !== p.index).map(q => `${q.name}.json`)} : {})}})});
  }
  files.push({name: 'pixi/animations.json', data: json({note: 'Every clip with all its frame names in play order, including clips whose frames lie on more than one page. After loading every page JSON, build an animation with `frames.map(k => Texture.from(k))`.',
    animations: Object.fromEntries(desc.clips.map(c => [`${c.asset}/${clipName(c)}`, c.frames]))})});
  const split = desc.clips.filter(c => new Set(c.frames.map(k => desc.frames.find(f => f.key === k)?.page)).size > 1).length;
  return {files, copies, notes: [
    ...(split ? [`${split} clip(s) have frames on more than one page; they are left out of each page's \`animations\` and listed in full in animations.json.`] : []),
    'Load each JSON with `Assets.load`; Pixi reads the image named in `meta.image` next to it. Durations are not part of Pixi\'s spritesheet format: use `animationSpeed` per animation (see durations in the Aseprite or Phaser export).',
    ...(desc.pages.length > 1 ? ['A multi-page atlas lists its sibling packs in `related_multi_packs`; load every page.'] : []),
    'Written to the documented format and loaded in PixiJS 8.23.0 (see studio/README.md).']};
}
