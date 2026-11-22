// Pure helpers for the Atlas tab: route state, zoom, hit-testing frames on a page, formatting, and the view-models of a comparison and the ledger.
export const VIEWS = ['atlas', 'budget', 'pack', 'export', 'ledger'];
/** Ledger gap filters: a field checked and unknown, an asset only planned, a field nobody has checked yet. */
export const GAPS = ['unknown', 'planned', 'open'];
export const ZOOMS = [1, 2, 3, 4, 6, 8];
const idPattern = /^[A-Za-z0-9_.-]{1,64}$/;
const keyPattern = /^[A-Za-z0-9_./-]{1,200}$/;

const int = (v, min, max, fallback) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : fallback; };

/** Every URL parameter the tab keeps. Total: junk gives defaults, never a throw. */
export function parseRoute(route = {}) {
  const p = route.params ?? {};
  const word = v => (typeof v === 'string' && idPattern.test(v) ? v : null);
  return {
    view: VIEWS.includes(p.view) ? p.view : 'atlas',
    set: word(p.set), chunk: word(p.chunk), profile: word(p.profile),
    page: int(p.page, 0, 999, 0),
    zoom: ZOOMS.includes(Number(p.zoom)) ? Number(p.zoom) : null,
    key: typeof p.key === 'string' && keyPattern.test(p.key) ? p.key : null,
    q: typeof p.q === 'string' ? p.q.trim().slice(0, 64) : '',
    origin: typeof p.origin === 'string' && /^[a-z-]{1,20}$/.test(p.origin) ? p.origin : null,
    gap: GAPS.includes(p.gap) ? p.gap : null,
    ledgerQ: typeof p.lq === 'string' ? p.lq.trim().slice(0, 64) : '',
    show: ['frames', 'borders', 'unused'].includes(p.show) ? p.show : 'borders'
  };
}

export function stateParams(s) {
  const out = {};
  if (s.view !== 'atlas') out.view = s.view;
  for (const [name, value] of [['set', s.set], ['chunk', s.chunk], ['profile', s.profile], ['key', s.key], ['origin', s.origin], ['gap', s.gap]]) if (value) out[name] = value;
  if (s.page) out.page = String(s.page);
  if (s.zoom) out.zoom = String(s.zoom);
  if (s.q) out.q = s.q;
  if (s.ledgerQ) out.lq = s.ledgerQ;
  if (s.show !== 'borders') out.show = s.show;
  return out;
}

/** The largest zoom in ZOOMS (integers only) at which `width` still fits `available` pixels; 1 when nothing does. */
export const fitZoom = (width, available) => ZOOMS.filter(z => width * z <= available).at(-1) ?? 1;

/** The next zoom up or down, staying inside ZOOMS. */
export const stepZoom = (zoom, direction) => ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(zoom) + direction))] ?? zoom;

/** The frame under a point in page pixels (the topmost: the last one drawn), or null. Frames never overlap, so this is the one frame. */
export function hitFrame(frames, x, y) {
  for (let i = frames.length - 1; i >= 0; i--) { const f = frames[i]; if (x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h) return f; }
  return null;
}

/** The rectangle a frame reserves: itself plus extrude plus padding on every side. */
export const reservedRect = (f, {padding = 0, extrude = 0}) => ({x: f.x - padding - extrude, y: f.y - padding - extrude, w: f.w + 2 * (padding + extrude), h: f.h + 2 * (padding + extrude)});

export const fmtBytes = n => (n == null ? '–' : n >= 1048576 ? `${+(n / 1048576).toFixed(2)} MiB` : n >= 1024 ? `${+(n / 1024).toFixed(1)} KiB` : `${n} B`);
export const fmtPct = r => `${(r * 100).toFixed(r < 0.1 && r > 0 ? 1 : 0)}%`;
export const shortSha = s => (typeof s === 'string' ? s.slice(0, 10) : '–');

/** ok | full | over | none | empty, as a tone: how loudly to show a budget state. */
export const budgetTone = state => ({ok: 'good', full: 'warn', over: 'bad', none: 'muted', empty: 'muted'}[state] ?? 'muted');
export const verdictTone = verdict => ({identical: 'good', equivalent: 'good', differs: 'bad', empty: 'muted'}[verdict] ?? 'muted');
export const statusTone = status => ({identical: 'good', equivalent: 'warn', differs: 'bad', not_produced: 'muted', absent: 'muted'}[status] ?? 'muted');

/** Used of the budget as a 0..1 meter (capped at 1), or null when there is no ceiling. */
export const meter = (used, ceiling) => (ceiling ? Math.min(1, used / ceiling) : null);

/** Frames whose asset id or key contains the text, in page order (an empty text matches nothing). */
export function matchFrames(frames, text) {
  const q = text.trim().toLowerCase();
  return q ? frames.filter(f => f.key.toLowerCase().includes(q) || (f.asset ?? '').toLowerCase().includes(q)) : [];
}

/** Rows of a comparison worth showing first: what differs, then what is only equivalent, then the rest. */
export function sortFiles(files) {
  const rank = {differs: 0, equivalent: 1, identical: 2, not_produced: 3, absent: 4};
  return [...files].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (a.name < b.name ? -1 : 1));
}

/** The first difference of a file comparison as short text parts: [key, vars]. */
export function describeDifference(file) {
  const d = file.firstDifference;
  if (!d || file.status === 'identical' || file.status === 'not_produced') return null;
  if (file.reason === 'pixels') return ['diff.pixels', {x: d.x, y: d.y, staged: `[${d.staged}]`, shipped: `[${d.shipped}]`}];
  if (file.reason === 'size') return ['diff.size', {staged: d.staged.join('×'), shipped: d.shipped.join('×')}];
  if (file.reason === 'content') return ['diff.content', {path: d.path, staged: JSON.stringify(d.staged), shipped: JSON.stringify(d.shipped)}];
  if (file.reason === 'bytes' || file.reason === 'formatting') return ['diff.bytes', {offset: d.offset, line: d.line}];
  if (file.reason === 'png_hash') return ['diff.pngHash', {path: d.path}];
  if (file.reason === 'png_bytes') return ['diff.pngBytes', {}];
  if (file.reason === 'missing_staged' || file.reason === 'extra_staged') return ['diff.' + file.reason, {}];
  return ['diff.other', {message: d.message ?? ''}];
}

/** Ledger rows filtered by origin kind and a text (id, source, category, tool, script). */
export function filterLedger(assets, {origin, text, gap}) {
  const q = (text ?? '').trim().toLowerCase();
  const gapOk = a => !gap || (gap === 'planned' ? a.planned === true : gap === 'open' ? (a.open ?? []).length > 0 : Object.values(a.reasons ?? {}).some(r => r.status === 'unknown'));
  return assets.filter(a => (!origin || a.origin.kind === origin) && gapOk(a) &&
    (!q || [a.id, a.source, a.category, a.origin.tool, a.origin.script, a.origin.producer].some(v => typeof v === 'string' && v.toLowerCase().includes(q))));
}

/** A path of a staged or exported file for the download route, from the export result. */
export const downloadPath = (base, name) => `${base}/${name}`;
