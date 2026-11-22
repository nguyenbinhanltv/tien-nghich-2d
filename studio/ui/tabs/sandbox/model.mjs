// Pure logic for the Sandbox tab: URL state, the draft room a URL describes, playback at a time t, stepping, due cues.
// No DOM, no fetch, no project knowledge: node:test drives it.
import { SCENE_SCHEMA, SCENE_VERSION, frameAt, frameStart, totalMs, pathAt, directionOf, anchorOffset, validateScene } from '../../../core/scene.mjs';

export const scales = [1, 2, 4];
export const overlays = ['pivot', 'hitbox', 'anchor'];
export const defaultRoom = Object.freeze({w: 160, h: 112});
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
const pick = (v, re) => (typeof v === 'string' && re.test(v) ? v : null);
const int = (v, lo, hi, d) => { const n = /^-?\d+$/.test(v ?? '') ? Number(v) : NaN; return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
const list = (v, ok) => (typeof v === 'string' ? v.split(',').filter(x => x && ok(x)).slice(0, 12) : []);
const token = x => /^[A-Za-z0-9_.-]{1,64}(~[A-Za-z0-9_.-]{0,40}){0,2}$/.test(x);

/** `id~clip~dir` → {asset, clip, direction}; clip and direction are optional. */
export function parseActor(tok) {
  const [asset, clip, direction] = tok.split('~');
  return {asset, ...(clip ? {clip} : {}), ...(direction ? {direction} : {})};
}
export const formatActor = a => [a.asset, a.clip ?? '', a.direction ?? ''].join('~').replace(/~+$/, '');

/** `click`, `key:E` or `time:300` → a scene `when`/`on` object; null if it is none of those. */
export function parseTrigger(text, fallback = {input: 'click'}) {
  if (text === 'click') return {input: 'click'};
  if (/^key:[A-Za-z0-9]$/.test(text ?? '')) return {input: text};
  const m = /^time:(\d{1,6})$/.exec(text ?? '');
  return m ? {time: Number(m[1])} : fallback;
}
export const formatTrigger = t => (t.input ? t.input : `time:${t.time}`);

/** URL → state. Total: junk gives defaults. A saved scene is `route.asset`; without one the room is a draft built from the lists. */
export function parseRoute(route = {}) {
  const p = route.params ?? {};
  const scale = int(p.scale, 1, 4, 2);
  const floor = /^(flat|checker):[a-z]+_[0-9]{2}$|^tile:[A-Za-z0-9_.-]{1,64}$/.test(p.floor ?? '') ? p.floor : null;
  return {
    scene: route.asset && ID.test(route.asset) ? route.asset : null,
    actors: list(p.actor, token), fx: list(p.fx, x => ID.test(x)), cues: list(p.cue, x => ID.test(x)),
    anchor: pick(p.anchor, /^(feet|center|head)$/) ?? 'head', fxOn: parseTrigger(p.fxon, {input: 'click'}), cueOn: parseTrigger(p.cueon, {input: 'click'}),
    bed: pick(p.bed, ID),
    scale: scales.includes(scale) ? scale : 2, floor, w: int(p.w, 16, 512, defaultRoom.w), h: int(p.h, 16, 512, defaultRoom.h),
    sel: pick(p.sel, ID), ov: new Set(list(p.ov, x => overlays.includes(x))), t: int(p.t, 0, 3600000, 0), play: p.play === '1', q: typeof p.q === 'string' ? p.q.slice(0, 60) : ''
  };
}

/** State → query parameters; defaults are omitted. */
export function stateParams(state) {
  const out = {};
  if (state.actors.length) out.actor = state.actors.join(',');
  if (state.fx.length) out.fx = state.fx.join(',');
  if (state.cues.length) out.cue = state.cues.join(',');
  if (state.anchor !== 'head') out.anchor = state.anchor;
  if (formatTrigger(state.fxOn) !== 'click') out.fxon = formatTrigger(state.fxOn);
  if (formatTrigger(state.cueOn) !== 'click') out.cueon = formatTrigger(state.cueOn);
  if (state.bed) out.bed = state.bed;
  if (state.scale !== 2) out.scale = String(state.scale);
  if (state.floor) out.floor = state.floor;
  if (state.w !== defaultRoom.w) out.w = String(state.w);
  if (state.h !== defaultRoom.h) out.h = String(state.h);
  if (state.sel) out.sel = state.sel;
  if (state.ov.size) out.ov = [...state.ov].sort().join(',');
  if (state.t) out.t = String(state.t);
  if (state.play) out.play = '1';
  if (state.q) out.q = state.q;
  return out;
}

const unique = (base, taken) => { let id = base, n = 2; while (taken.has(id)) id = `${base}_${n++}`; taken.add(id); return id; };

/**
 * The room a draft URL describes, as a scene document. Actors stand in a row on the lower third; effects fire at the
 * first actor's `anchor` (or the room centre when there is no actor); cues play on the trigger. `defaults.color` is a palette id.
 */
export function draftScene(state, defaults) {
  const taken = new Set();
  const actors = state.actors.map(parseActor);
  const n = actors.length;
  const doc = {schema: SCENE_SCHEMA, version: SCENE_VERSION, id: 'draft', room: {size: [state.w, state.h], floor: floorOf(state.floor, defaults.color)},
    camera: {scale: state.scale}, actors: [], effects: [], audio: {cues: []}};
  actors.forEach((a, i) => doc.actors.push({id: unique(a.asset, taken), asset: a.asset, ...(a.clip ? {clip: a.clip} : {}), direction: a.direction ?? 'south',
    at: [Math.round(state.w * (i + 1) / (n + 1)), Math.round(state.h * 0.78)]}));
  const first = doc.actors[0];
  state.fx.forEach(asset => doc.effects.push({id: unique(asset, taken), asset, at: first ? {actor: first.id, anchor: state.anchor} : {point: [Math.round(state.w / 2), Math.round(state.h / 2)]}, when: {...state.fxOn}}));
  state.cues.forEach(asset => doc.audio.cues.push({id: unique(asset, taken), asset, on: {...state.cueOn}}));
  if (state.bed) doc.audio.bed = state.bed;
  return doc;
}

export function floorOf(text, color) {
  if (!text) return {kind: 'flat', color};
  const [kind, value] = text.split(':');
  return kind === 'tile' ? {kind, asset: value} : {kind, color: value};
}
export const floorText = f => (f.kind === 'tile' ? `tile:${f.asset}` : `${f.kind}:${f.color}`);

/** A draft or saved document as a valid scene, with the draft's name given. Errors are returned, never thrown. */
export function sceneForSave(doc, id, name, colors) {
  const out = {...structuredClone(doc), id, ...(name ? {name: {en: name}} : {})};
  if (!out.audio?.cues?.length && !out.audio?.bed) delete out.audio;
  return validateScene(out, {colors});
}

// ---- playback ---------------------------------------------------------------------------------------------------
/**
 * What `sprites` must hold for `sceneAt`: Map assetId → {size, pivot, clips: {clip: {direction: {ms: [..], frames: [..]}}}} for
 * actors, and Map assetId → {size, anchor, ms: [..], frames: [..]} for effects (a variant already chosen).
 */
const pickClip = (sprite, name) => sprite.clips[name] ?? sprite.clips[Object.keys(sprite.clips).find(c => /idle/.test(c)) ?? Object.keys(sprite.clips)[0]];
export function pickDirection(clip, want) {
  if (clip[want]) return want;
  return clip.south ? 'south' : Object.keys(clip)[0];
}

/** Where each actor is at time t, and which clip frame it shows. `player` positions override a path/at. */
export function actorsAt(scene, sprites, t, player = {}) {
  return scene.actors.map(a => {
    const sprite = sprites.get(a.asset);
    let at = a.at, heading = [0, 0];
    if (a.control === 'player' && player[a.id]) ({at, heading} = player[a.id]);
    else if (a.path) { const r = pathAt(a.path, t); at = r.at; heading = r.heading; }
    const moving = Boolean(heading[0] || heading[1]);
    if (!sprite) return {id: a.id, asset: a.asset, at, missing: true};
    const clipName = a.clip && sprite.clips[a.clip] ? a.clip : null;
    const clip = clipName ? sprite.clips[clipName] : pickClip(sprite, a.clip);
    const faced = a.direction === 'auto' || (!a.direction && (a.path || a.control)) ? directionOf(heading[0], heading[1]) ?? player[a.id]?.facing ?? 'south' : a.direction ?? 'south';
    const dir = pickDirection(clip, faced);
    const {ms, frames} = clip[dir];
    const {frame} = frameAt(ms, t, {loop: true});
    return {id: a.id, asset: a.asset, at, moving, direction: dir, frame, count: frames.length, path: frames[frame], size: sprite.size, pivot: sprite.pivot, hitbox: sprite.hitbox ?? null, ms: ms[frame], list: ms};
  });
}

/** When an effect that started at `start` (ms) shows which frame at `t`; null before it starts or after a once-effect ends. */
export function effectFrame(effect, fx, start, t) {
  if (start === null || start === undefined || t < start) return null;
  const pinned = Number.isInteger(effect.frame);
  if (pinned) return {frame: Math.min(effect.frame, fx.ms.length - 1), done: false};
  const r = frameAt(fx.ms, t - start, {loop: Boolean(effect.loop)});
  return effect.loop || !r.done ? {frame: r.frame, done: false} : null;
}

/** Where the effect's pivot lands in the room: at a point, or at an anchor of an actor that is on the stage. */
export function effectPosition(effect, placed) {
  if (effect.at.point) return effect.at.point;
  const a = placed.find(x => x.id === effect.at.actor);
  if (!a || a.missing) return null;
  const off = anchorOffset(effect.at.anchor, a.size, a.pivot);
  return [a.at[0] + off[0], a.at[1] + off[1]];
}

/** Effect start times: `{time}` effects start at that time, input effects when `fired` (a Map effectId → ms) says. */
export function startOf(effect, fired) { return effect.when.time !== undefined ? effect.when.time : fired.get(effect.id) ?? null; }

/**
 * Cues that become due in (prev, t]: those with `on.time` in that window and those with `on.effect` whose effect started
 * in it. Input cues are not here: the page plays them straight from the click or key.
 */
export function cuesDue(scene, fired, prev, t) {
  const inWindow = at => at !== null && at !== undefined && at > prev && at <= t;
  return (scene.audio?.cues ?? []).filter(c => (c.on.time !== undefined && inWindow(c.on.time))
    || (c.on.effect && inWindow(startOf(scene.effects.find(e => e.id === c.on.effect) ?? {when: {}}, fired)))).map(c => c.id);
}

/** Effects and cues an input triggers (`click`, `key:E`). */
export const triggeredBy = (scene, input) => ({
  effects: scene.effects.filter(e => e.when.input === input).map(e => e.id),
  cues: (scene.audio?.cues ?? []).filter(c => c.on.input === input).map(c => c.id)
});

/** The time of the next (dir 1) or previous (dir -1) frame boundary of a frame list, for the Step buttons. */
export function stepTime(ms, t, dir) {
  const total = totalMs(ms);
  if (!ms.length || total <= 0) return t;
  const cycle = Math.floor(t / total) * total, local = t - cycle;
  const starts = ms.map((_, i) => frameStart(ms, i));
  if (dir > 0) { const next = starts.find(s => s > local); return cycle + (next ?? total); }
  const prev = [...starts].reverse().find(s => s < local);
  return prev !== undefined ? cycle + prev : Math.max(0, cycle - (ms.length > 1 ? total - starts[ms.length - 1] : total));
}

/** Which clock a draft shows in the readout: the longest-running thing on stage decides how long one loop is. */
export function sceneSpan(scene, sprites) {
  const spans = [];
  for (const a of scene.actors) { const s = sprites.get(a.asset); const c = s && pickClip(s, a.clip); if (c) { const d = c[pickDirection(c, a.direction ?? 'south')]; spans.push(totalMs(d.ms)); } }
  return Math.max(0, ...spans);
}
