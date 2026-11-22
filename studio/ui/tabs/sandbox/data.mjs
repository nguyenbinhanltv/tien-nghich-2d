// Loading what a scene names: sprite sheets and frame durations come from the Characters and VFX tabs' read-only routes,
// tile frames and the asset list from the catalog API. A missing asset stays missing and is reported, never faked.
import { loadImage } from './dom.mjs';

const baseName = path => path.split('/').pop().replace(/\.png$/, '');

export async function loadCatalog(ctx) {
  const {assets} = await ctx.api('assets?limit=1000');
  const tab = ctx.project.categoryTabs ?? {};
  const usable = a => a.readiness !== 'planned';
  return {
    characters: assets.filter(a => tab[a.category] === 'characters' && usable(a) && (a.clips?.length ?? 0) > 0),
    tilesets: assets.filter(a => a.category === 'tileset' && usable(a)),
    effects: assets.filter(a => a.category === 'vfx' && usable(a)),
    cues: assets.filter(a => tab[a.category] === 'audio' && usable(a)),
    byId: new Map(assets.map(a => [a.id, a]))
  };
}

/** A character as the model wants it: {size, pivot, hitbox, hitboxDerived, clips: {clip: {direction: {ms, frames: [Image]}}}}. */
export async function loadActor(ctx, id) {
  const detail = await ctx.fetchJson('/api/tabs/characters/asset?id=' + encodeURIComponent(id));
  const clips = {};
  for (const f of detail.frames ?? []) ((clips[f.clip] ??= {})[f.direction] ??= []).push(f);
  const out = {};
  for (const [clip, dirs] of Object.entries(clips)) for (const [dir, list] of Object.entries(dirs)) {
    list.sort((a, b) => a.n - b.n);
    const ms = detail.clips?.[clip]?.ms || detail.defaultFrameMs;
    const images = await Promise.all(list.map(f => loadImage(f.path).catch(() => null)));
    if (images.some(i => !i)) continue;
    (out[clip] ??= {})[dir] = {ms: list.map(() => ms), frames: images};
  }
  const first = Object.values(Object.values(out)[0] ?? {})[0]?.frames[0];
  if (!first) return null;
  return {size: [first.width, first.height], pivot: detail.foot ?? [first.width >> 1, first.height - 1], hitbox: detail.hitbox ?? null, clips: out, name: ctx.label(detail.name) || id};
}

/** An effect: {size, anchor, ms, frames: [Image|null]}. `variant` picks one of a multi-palette effect's variants. */
export async function loadEffect(ctx, id, {variant, clip} = {}) {
  const {effect} = await ctx.fetchJson('/api/tabs/vfx/effect?id=' + encodeURIComponent(id));
  const c = effect.clips.find(x => x.id === clip) ?? effect.clips[0];
  const key = variant && c.paths[variant] ? variant : Object.keys(c.paths)[0];
  const paths = c.paths[key] ?? [];
  const frames = await Promise.all(paths.map(p => (p ? loadImage(p).catch(() => null) : null)));
  return {size: effect.size, anchor: effect.anchor, ms: c.ms, frames, missing: frames.filter(f => !f).length};
}

/** A tile image of a tileset asset: the named frame, else the first one named like a floor, else the first. */
export async function loadTile(ctx, id, frame) {
  const detail = await ctx.api('assets/' + encodeURIComponent(id));
  const frames = (detail.frames ?? []).filter(f => f.path);
  const pick = (frame && frames.find(f => baseName(f.path) === frame)) ?? frames.find(f => /floor/.test(baseName(f.path))) ?? frames[0];
  return pick ? {image: await loadImage(pick.path), frame: baseName(pick.path), frames: frames.map(f => baseName(f.path))} : null;
}

/** Everything a scene document names, loaded. Returns {actors, effects, tiles, missing: [ids]}. */
export async function loadScene(ctx, scene) {
  const missing = new Set();
  const actors = new Map(), effects = new Map(), tiles = new Map();
  const once = (map, id, load) => map.has(id) ? null : (map.set(id, null), load().then(v => { map.set(id, v); if (!v) missing.add(id); }).catch(() => { missing.add(id); }));
  const jobs = [];
  for (const a of scene.actors) jobs.push(once(actors, a.asset, () => loadActor(ctx, a.asset)));
  for (const e of scene.effects) jobs.push(once(effects, e.asset, () => loadEffect(ctx, e.asset, e)));
  const floor = scene.room.floor;
  if (floor.kind === 'tile') jobs.push(once(tiles, floor.asset, () => loadTile(ctx, floor.asset, floor.frame)));
  if (scene.room.wall) jobs.push(once(tiles, scene.room.wall.asset, () => loadTile(ctx, scene.room.wall.asset, scene.room.wall.frame)));
  await Promise.all(jobs.filter(Boolean));
  for (const [id, v] of [...actors, ...effects]) if (v && v.missing) missing.add(id);
  return {actors, effects, tiles, missing: [...missing].sort()};
}
