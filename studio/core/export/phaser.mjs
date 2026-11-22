// Phaser 3: the multi-atlas JSON (what `load.multiatlas` reads), a hash-form JSON per page (what `load.atlas` reads for a single page),
// and the animations as Phaser's `anims.fromJSON` document. Written to the documented format; not opened in Phaser.
import { json, clipName, pagesOf } from './common.mjs';

export const id = 'phaser';
export const label = {en: 'Phaser 3', vi: 'Phaser 3'};

const frameBody = f => ({rotated: false, trimmed: false, sourceSize: {w: f.w, h: f.h}, spriteSourceSize: {x: 0, y: 0, w: f.w, h: f.h}, frame: {x: f.x, y: f.y, w: f.w, h: f.h},
  ...(f.pivotPx ? {pivot: {x: f.pivotPx[0] / f.w, y: f.pivotPx[1] / f.h}} : {})});

export async function build(desc, {atlasKey = desc.name} = {}) {
  const files = [], copies = desc.pages.map(p => ({page: p.index, name: `phaser/${p.image}`}));
  const meta = {app: 'Pixel Kiln export', version: '1', format: 'RGBA8888', scale: '1'};
  files.push({name: 'phaser/multiatlas.json', data: json({textures: desc.pages.map(p => ({image: p.image, format: 'RGBA8888', size: {w: p.width, h: p.height}, scale: 1,
    frames: desc.frames.filter(f => f.page === p.index).map(f => ({filename: f.key, ...frameBody(f)}))})), meta})});
  for (const p of desc.pages) {
    const frames = Object.fromEntries(desc.frames.filter(f => f.page === p.index).map(f => [f.key, frameBody(f)]));
    files.push({name: `phaser/${p.name}.hash.json`, data: json({frames, meta: {...meta, image: p.image, size: {w: p.width, h: p.height}}})});
  }
  const anims = desc.clips.map(c => {
    const repeat = c.loop === false ? 0 : -1;
    return {key: `${c.asset}/${clipName(c)}`, type: 'frame', frames: c.frames.map(k => { const f = desc.frames.find(x => x.key === k); return {key: atlasKey, frame: k, ...(f.durationMs ? {duration: f.durationMs} : {})}; }), repeat};
  });
  files.push({name: 'phaser/animations.json', data: json({anims, globalTimeScale: 1})});
  return {files, copies, notes: [
    'Load with `this.load.multiatlas(KEY, "multiatlas.json")` and `this.anims.fromJSON(animations)`; the atlas key used in the animations is "' + atlasKey + '".',
    'Per-frame durations are Phaser frame `duration` values in milliseconds; a clip that records no loop flag repeats forever.',
    ...(desc.frames.some(f => f.pivotPx) ? ['Pivots are written as the per-frame `pivot` Phaser 3.60 and later read.'] : ['This atlas records no pivots.']),
    'Written to the documented format, not opened in Phaser.']};
}
