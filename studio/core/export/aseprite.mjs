// Aseprite JSON array format (what `aseprite --sheet-type … --data` writes, and Aseprite-aware loaders read): per asset and page a
// `frames` array with durations and a `meta.frameTags` list, one tag per clip and direction. Not opened in Aseprite.
import { json, clipName, byAsset, stem, pagesOf } from './common.mjs';

export const id = 'aseprite';
export const label = {en: 'Aseprite JSON', vi: 'Aseprite JSON'};

export async function build(desc) {
  const files = [], copies = desc.pages.map(p => ({page: p.index, name: `aseprite/${p.image}`}));
  const assets = [...byAsset(desc)].filter(([asset]) => asset);
  for (const [asset, frames] of assets) {
    for (const page of pagesOf(frames)) {
      const p = desc.pages.find(q => q.index === page);
      const mine = [];
      const tags = [];
      for (const c of desc.clips.filter(x => x.asset === asset)) {
        const list = c.frames.map(k => frames.find(f => f.key === k)).filter(f => f && f.page === page);
        if (!list.length) continue;
        tags.push({name: clipName(c), from: mine.length, to: mine.length + list.length - 1, direction: 'forward', color: '#000000ff'});
        mine.push(...list);
      }
      const rest = frames.filter(f => f.page === page && !mine.includes(f));
      mine.push(...rest);
      const doc = {frames: mine.map(f => ({filename: f.key, frame: {x: f.x, y: f.y, w: f.w, h: f.h}, rotated: false, trimmed: false, spriteSourceSize: {x: 0, y: 0, w: f.w, h: f.h},
        sourceSize: {w: f.w, h: f.h}, duration: f.durationMs ?? 100})),
        meta: {app: 'tien-nghich studio export', version: '1', image: p.image, format: 'RGBA8888', size: {w: p.width, h: p.height}, scale: '1', frameTags: tags}};
      files.push({name: `aseprite/${stem(asset)}${desc.pages.length > 1 ? `.${p.name}` : ''}.json`, data: json(doc)});
    }
  }
  return {files, copies, notes: [
    'Each JSON lists one asset\'s frames in play order with their durations in milliseconds; `meta.frameTags` has one tag per clip and direction (e.g. `idle_south`), with `from` and `to` as indexes into `frames`.',
    'A frame with no recorded duration is written as 100 ms, the Aseprite default. Pivots have no place in this format and are not written.',
    'Aseprite reads its own .aseprite files, not this JSON: the JSON is for loaders and importers that understand the Aseprite sheet data format.',
    'Written to the documented format, not opened in Aseprite.']};
}
