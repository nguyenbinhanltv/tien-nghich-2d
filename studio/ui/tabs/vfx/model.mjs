// Pure helpers for the VFX tab: route state, the playback plan, frame timing, timeline layout,
// overlay geometry, readability notes. No DOM, no fetch.
import { ZOOMS, isZoom } from '../../pixelview.mjs';

/** Integer zooms only: the pixel viewer's list (1, 2, 3, 4, 6, 8, 12, 16). */
export const scales = ZOOMS;
export const defaultScale = 2;
export const views = ['spec', 'audit', 'provenance', 'rounds', 'read'];
const idPattern = /^[A-Za-z0-9_.-]+$/;
const pick = (value, ok) => (typeof value === 'string' && ok.test(value) ? value : null);
const int = (value, min, max, fallback) => {
  const n = /^-?\d+$/.test(value ?? '') ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** URL → state. Total: junk gives defaults, never a throw. */
export function parseRoute(route = {}) {
  const p = route.params ?? {};
  const scale = int(p.scale, 1, 16, defaultScale);
  return {
    asset: route.asset ?? null, clip: route.asset ? route.clip ?? null : null, frame: route.asset ? route.frame ?? null : null,
    source: pick(p.source, idPattern), variant: pick(p.variant, idPattern),
    floor: pick(p.floor, idPattern), scale: isZoom(scale) ? scale : defaultScale,
    overlay: p.overlay === '1', char: pick(p.char, idPattern), cclip: pick(p.cclip, idPattern), cdir: pick(p.cdir, idPattern),
    cn: int(p.cn, 0, 999, 0), oy: int(p.oy, 0, 48, 0),
    view: views.includes(p.view) ? p.view : 'spec', ra: int(p.ra, 1, 9, 1), rb: int(p.rb, 1, 9, 4),
    ready: pick(p.ready, /^(planned|authored|packed)$/), grp: pick(p.grp, idPattern), q: typeof p.q === 'string' ? p.q.slice(0, 60) : ''
  };
}

/** State → the query parameters that carry it; defaults are omitted. */
export function stateParams(state) {
  const out = {};
  for (const key of ['source', 'variant', 'floor', 'ready', 'grp', 'char', 'cclip', 'cdir']) if (state[key]) out[key] = state[key];
  if (state.q) out.q = state.q;
  if (state.scale !== defaultScale) out.scale = String(state.scale);
  if (state.overlay) out.overlay = '1';
  if (state.cn) out.cn = String(state.cn);
  if (state.oy) out.oy = String(state.oy);
  if (state.view !== 'spec') out.view = state.view;
  if (state.ra !== 1) out.ra = String(state.ra);
  if (state.rb !== 4) out.rb = String(state.rb);
  return out;
}

export function applyFilters(cards, state) {
  const q = state.q.trim().toLowerCase();
  return cards.filter(c => (!state.ready || c.readiness === state.ready) && (!state.grp || c.group === state.grp) && (!q || c.id.toLowerCase().includes(q)));
}

/** Frames are 0-based and the frame count is `ms.length`; clamp whatever the URL asked for. */
export const clampFrame = (frame, count) => (count <= 0 ? 0 : Math.min(Math.max(Number.isInteger(frame) ? frame : 0, 0), count - 1));

/**
 * The clip the URL selects. Design effects have real clips (`place`, `release`); a core effect has one clip
 * and `clip` may name one of its sections (`#/vfx/<id>?clip=<clip>`), which narrows playback to that range.
 */
export function resolveClip(effect, name) {
  const real = effect.clips.find(c => c.id === name);
  if (real) return {clip: real, focus: null};
  const clip = effect.clips[0];
  const focus = effect.group === 'core' ? clip.sections.find(s => s.name === name && !s.role) ?? clip.sections.find(s => s.name === name) ?? null : null;
  return {clip, focus: focus ?? null};
}

/** Variant for the URL, falling back to the first the effect has; '' for effects without variants. */
export function resolveVariant(effect, variant) {
  if (!effect.variants.length) return '';
  return effect.variants.some(v => v.id === variant) ? variant : effect.variants[0].id;
}

/**
 * How a clip plays, as segments `{name, from, to, kind, role}` in order.
 *   start/loop/end sections (any subset that has a `loop`): start once, loop while held, end once.
 *   otherwise the non-role sections in frame order: a `loop` section repeats while held, others play once.
 *   no sections: the whole clip, looping if the clip is a loop.
 * `focus` (one section) replaces all of it: that range only.
 */
export function buildPlan(clip, focus = null) {
  const count = clip.ms.length;
  if (!count) return [];
  const whole = {name: clip.id, from: 0, to: count - 1, kind: clip.kind, role: null};
  if (focus) return [{...focus}];
  const sections = clip.sections.filter(s => s.from >= 0 && s.to < count);
  const roles = sections.filter(s => s.role);
  if (roles.some(s => s.role === 'loop')) return ['start', 'loop', 'end'].map(r => roles.find(s => s.role === r)).filter(Boolean).map(s => ({...s}));
  const phases = sections.filter(s => !s.role).sort((a, b) => a.from - b.from);
  return phases.length ? phases.map(s => ({...s})) : [whole];
}

/** The part of the plan a frame belongs to, for highlighting. */
export const segmentIndexOf = (plan, frame) => plan.findIndex(s => frame >= s.from && frame <= s.to);

/**
 * The next frame after `frame`, or null when the plan has played out.
 * A loop segment repeats while `held`; once released it falls through to the next segment.
 */
export function nextFrame(plan, frame, held) {
  const i = segmentIndexOf(plan, frame);
  if (i < 0) return plan.length ? plan[0].from : null;
  const seg = plan[i];
  if (frame < seg.to) return frame + 1;
  if (seg.kind === 'loop' && held) return seg.from;
  return plan[i + 1] ? plan[i + 1].from : null;
}

/** Previous frame for stepping back: stays inside the file's frame order, wrapping at 0. */
export const stepFrame = (frame, delta, count) => (count <= 0 ? 0 : ((frame + delta) % count + count) % count);

/** Cumulative start time (ms) of every frame, and the total. */
export function frameStarts(ms) {
  const starts = [];
  let t = 0;
  for (const d of ms) { starts.push(t); t += d; }
  return {starts, total: t};
}

/** Frame showing at time `t` ms from the start (clamped to the last frame). Used for scrubbing by time. */
export function frameAtTime(ms, t) {
  const {starts, total} = frameStarts(ms);
  if (!ms.length) return 0;
  if (t >= total) return ms.length - 1;
  for (let i = ms.length - 1; i >= 0; i--) if (t >= starts[i]) return i;
  return 0;
}

/**
 * Timeline geometry in percent of total duration: one lane per kind of marker.
 * sections: [{name, left, width, kind, role}], cells: per-frame [{frame, left, width}], events: [{name, frame, left}].
 */
export function layoutTimeline(clip) {
  const {starts, total} = frameStarts(clip.ms);
  const pct = v => (total ? v / total * 100 : 0);
  const cells = clip.ms.map((d, frame) => ({frame, left: pct(starts[frame]), width: pct(d), ms: d}));
  const span = (from, to) => ({left: pct(starts[from]), width: pct(starts[to] + clip.ms[to] - starts[from])});
  const sections = clip.sections.filter(s => s.from >= 0 && s.to < clip.ms.length).map(s => ({...s, ...span(s.from, s.to)}));
  const events = clip.events.filter(e => e.frame >= 0 && e.frame < clip.ms.length).map(e => ({...e, left: pct(starts[e.frame])}));
  return {cells, sections, events, total};
}

/** Section names a frame belongs to (a frame can be in a phase and a start/loop/end role at once). */
export const sectionsAt = (clip, frame) => clip.sections.filter(s => frame >= s.from && frame <= s.to).map(s => s.name);
export const eventsAt = (clip, frame) => clip.events.filter(e => e.frame === frame).map(e => e.name);

/**
 * Overlay geometry at scale 1, in a canvas that holds both sprites with a margin: the effect's anchor lands on the
 * character's pivot, lifted by `oy` pixels (a hit spark at the feet is poor context).
 */
export function overlayLayout(character, effect, oy = 0, margin = 8) {
  const px = character.pivot[0], py = character.pivot[1] - oy;
  const fx = px - effect.anchor[0], fy = py - effect.anchor[1];
  const left = Math.min(0, fx), top = Math.min(0, fy);
  const right = Math.max(character.width, fx + effect.width), bottom = Math.max(character.height, fy + effect.height);
  return {width: right - left + margin * 2, height: bottom - top + margin * 2,
    charX: -left + margin, charY: -top + margin, fxX: fx - left + margin, fxY: fy - top + margin};
}

/** Character pivot from anchor.json (`anchor_px`), else bottom centre; `assumed` says which. */
export function characterPivot(anchorJson, width, height) {
  const a = anchorJson?.anchor_px;
  if (Array.isArray(a) && a.length === 2 && a.every(Number.isFinite)) return {pivot: a, assumed: false};
  return {pivot: [Math.floor(width / 2), height - 1], assumed: true};
}

// ---- human 1x readability notes: a typed comment on the effect's first frame, never a status ----
export const notePrefix = '[vfx-1x-read';
export const scoreRange = [1, 5];

export function encodeNote({score, variant, text}) {
  const s = Number.isInteger(score) && score >= scoreRange[0] && score <= scoreRange[1] ? score : null;
  const head = `${notePrefix}${s ? ` score=${s}/5` : ''}${variant ? ` variant=${variant}` : ''}]`;
  return `${head} ${String(text ?? '').trim()}`.trim();
}

/** Parse a stored comment back; null when it is not a readability note. */
export function parseNote(text) {
  const m = /^\[vfx-1x-read((?: score=[1-5]\/5)?(?: variant=[A-Za-z0-9_.-]+)?)\]\s*([\s\S]*)$/.exec(String(text ?? ''));
  if (!m) return null;
  return {score: Number(/score=([1-5])/.exec(m[1])?.[1]) || null, variant: /variant=([A-Za-z0-9_.-]+)/.exec(m[1])?.[1] ?? null, text: m[2]};
}

export const canSaveNote = ({score, text}) => Boolean((Number.isInteger(score) && score >= 1 && score <= 5) || String(text ?? '').trim());

export const fmtMs = ms => (ms >= 1000 ? (ms / 1000).toFixed(2).replace(/0$/, '') + ' s' : Math.round(ms) + ' ms');
