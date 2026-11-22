// Pure logic of the Characters tab: route state, roster filtering, timeline and frame lookup.
// No DOM here, so Node tests cover it.

export const panels = ['frame', 'facing', 'card', 'export'];
export const compares = ['processed', 'raw', 'split', 'diff'];
export const sources = ['library', 'bake'];
export const overlayNames = ['pivot', 'foot', 'hitbox'];
const idPattern = /^[a-z0-9_]+$/;

/** The tab's own state from a parsed shell route. Total: junk in the URL falls back to defaults. */
export function parseRoute(route) {
  const p = route.params ?? {};
  const id = route.asset && idPattern.test(route.asset) ? route.asset : null;
  const overlay = p.ov === undefined ? ['pivot', 'foot'] : p.ov.split(',').filter(x => overlayNames.includes(x));
  const zoom = /^([1-9]|1[0-6])$/.test(p.zoom ?? '') ? Number(p.zoom) : null;
  return {
    id, source: p.source && idPattern.test(p.source) ? p.source : null,
    clip: id ? route.clip : null, direction: id ? route.direction : null, frame: id ? route.frame : null,
    panel: panels.includes(p.panel) ? p.panel : 'frame',
    compare: compares.includes(p.compare) ? p.compare : 'processed', frames: sources.includes(p.src) ? p.src : 'library',
    onion: p.onion === '1', overlay: new Set(overlay), zoom,
    filter: {category: p.cat ?? '', readiness: p.ready ?? '', q: (p.q ?? '').slice(0, 60)}
  };
}

/** Inverse of parseRoute, for ctx.navigate. Defaults are left out so URLs stay short. */
export function toRoute(state) {
  const params = {};
  if (state.source) params.source = state.source;
  if (state.panel !== 'frame') params.panel = state.panel;
  if (state.compare !== 'processed') params.compare = state.compare;
  if (state.frames !== 'library') params.src = state.frames;
  if (state.onion) params.onion = '1';
  const ov = overlayNames.filter(o => state.overlay.has(o)).join(',');
  if (ov !== 'pivot,foot') params.ov = ov;
  if (state.zoom) params.zoom = String(state.zoom);
  if (state.filter.category) params.cat = state.filter.category;
  if (state.filter.readiness) params.ready = state.filter.readiness;
  if (state.filter.q) params.q = state.filter.q;
  return {tab: 'characters', asset: state.id, clip: state.clip, direction: state.direction, frame: state.frame, params};
}

export function filterRoster(characters, {category = '', readiness = '', q = ''}) {
  const needle = q.trim().toLowerCase();
  return characters.filter(c => (!category || c.category === category) && (!readiness || c.readiness === readiness) &&
    (!needle || c.id.includes(needle) || (c.name ?? '').toLowerCase().includes(needle) || (c.brief ?? '').toLowerCase().includes(needle)));
}

/** Roster order: configured category order, then id. */
export function sortRoster(characters, categories) {
  const rank = c => { const i = categories.indexOf(c.category); return i < 0 ? categories.length : i; };
  return [...characters].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/** Frames of one clip and facing, in order. */
export const clipFrames = (detail, clip, direction) =>
  detail.frames.filter(f => f.clip === clip && f.direction === direction).sort((a, b) => a.n - b.n);

/**
 * Settle a requested selection against what the character really has: the clip, facing and frame always
 * exist afterwards (or are null when there are no frames at all).
 */
export function resolveSelection(detail, {clip, direction, frame}, facings) {
  const clips = Object.keys(detail.clips).filter(c => detail.frames.some(f => f.clip === c));
  if (!clips.length) return {clip: null, direction: null, frame: null, clips, directions: []};
  const useClip = clips.includes(clip) ? clip : clips.includes('idle') ? 'idle' : clips[0];
  const present = new Set(detail.frames.filter(f => f.clip === useClip).map(f => f.direction));
  const directions = [...facings.filter(f => present.has(f)), ...[...present].filter(d => !facings.includes(d))];
  const useDir = directions.includes(direction) ? direction : directions[0];
  const count = clipFrames(detail, useClip, useDir).length;
  const useFrame = Number.isInteger(frame) && frame >= 0 && frame < count ? frame : 0;
  return {clip: useClip, direction: useDir, frame: useFrame, clips, directions};
}

/** Per-frame durations of a clip in ms; `assumed` is true when the project defines none. */
export function durations(detail, clip, count) {
  const ms = detail.clips[clip]?.ms;
  return {ms: Array.from({length: count}, () => ms || detail.defaultFrameMs), assumed: !ms};
}

/** Which frame is showing `t` ms into playback. A looping clip wraps; a one-shot holds its last frame. */
export function frameAt(t, ms, loop = true) {
  const total = ms.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let at = loop ? t % total : Math.min(t, total - 1);
  for (let i = 0; i < ms.length; i++) { if (at < ms[i]) return i; at -= ms[i]; }
  return ms.length - 1;
}

/** The raw frame matching a processed frame, if the raw tree has one. */
export const rawFor = (detail, f) => detail.rawFrames.find(r => r.clip === f.clip && r.direction === f.direction && r.n === f.n) ?? null;

/** Integer zoom that fits `columns` canvases in the stage width, each cell costing about 56px of padding and gap: 1..8. */
export function autoZoom(width, size, columns = 4) {
  return Math.max(1, Math.min(8, Math.floor((width - 56 * columns) / (columns * Math.max(size, 1)))));
}
