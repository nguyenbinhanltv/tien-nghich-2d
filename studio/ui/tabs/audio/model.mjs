// Audio tab: pure logic shared by the browser modules and the tests (no DOM, no fetch, no Node APIs).

export const views = ['listen', 'pictures', 'sprite', 'patch'];
export const codecs = ['master', 'ogg', 'm4a'];
export const stages = ['planned', 'master', 'packed'];
export const listeningStates = ['approved', 'needs_work', 'stale', 'pending', 'none'];
export const kinds = ['bed', 'effect'];

const text = v => (typeof v === 'string' && v ? v : null);
const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/** `a~b` from the URL; both ids must look like ids. */
export function parsePair(value) {
  const m = /^([A-Za-z0-9_.-]{1,64})~([A-Za-z0-9_.-]{1,64})$/.exec(value ?? '');
  return m && m[1] !== m[2] ? [m[1], m[2]] : null;
}

/** Total: any route gives a state. */
export function parseRoute(route) {
  const p = route?.params && typeof route.params === 'object' ? route.params : {};
  return {
    asset: text(route?.asset), view: pick(p.view, views, 'listen'), codec: pick(p.codec, codecs, 'master'), pack: text(p.pack),
    q: text(p.q) ?? '', kind: pick(p.kind, kinds, null), stage: pick(p.stage, stages, null), listening: pick(p.listening, listeningStates, null),
    family: text(p.family), ab: parsePair(p.ab), bed: text(p.bed)
  };
}

/** The non-default part of a state as URL parameters (insertion order is stable). */
export function stateParams(state) {
  const out = {};
  if (state.view && state.view !== 'listen') out.view = state.view;
  if (state.codec && state.codec !== 'master') out.codec = state.codec;
  for (const key of ['pack', 'q', 'kind', 'stage', 'listening', 'family', 'bed']) if (state[key]) out[key] = state[key];
  if (state.ab) out.ab = state.ab.join('~');
  return out;
}

/** Stage of a catalog readiness: planned (a design only), master (a WAV exists), packed (in an audio pack). */
export const stageOf = readiness => (readiness === 'packed' ? 'packed' : readiness === 'authored' ? 'master' : 'planned');

/**
 * Listening state of one cue. `signoff` is the Review store's latest verdict for the id, `masterSha` the hash of
 * the master now on disk, `evidence` the pack evidence's `human_listening` word (or null).
 */
export function listeningOf({stage, signoff, masterSha, evidence}) {
  if (stage === 'planned') return 'none';
  if (signoff) {
    if (signoff.verdict === 'needs_work') return signoff.content === masterSha ? 'needs_work' : 'stale';
    if (signoff.verdict === 'signed') return signoff.content === masterSha ? 'approved' : 'stale';
  }
  return evidence === 'approved' ? 'approved' : 'pending';
}

export function filterEntries(entries, state) {
  const q = (state.q ?? '').trim().toLowerCase();
  return entries.filter(e =>
    (!state.kind || e.kind === state.kind) && (!state.stage || e.stage === state.stage) && (!state.listening || e.listening === state.listening) &&
    (!state.pack || e.packs.includes(state.pack)) && (!state.family || e.families.some(f => f.family === state.family)) &&
    (!q || e.id.toLowerCase().includes(q) || e.group?.toLowerCase().includes(q) || e.families.some(f => f.family.toLowerCase().includes(q))));
}

export function facets(entries, field) {
  const counts = new Map();
  for (const e of entries) for (const v of (Array.isArray(e[field]) ? e[field] : [e[field]])) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

/** Linear gains that bring every loudness (LUFS) to the quietest one, so matching never adds level. null loudness leaves a gain of 1. */
export function matchedGains(loudness) {
  const known = loudness.filter(v => Number.isFinite(v));
  if (known.length < loudness.length || !known.length) return loudness.map(() => 1);
  const target = Math.min(...known);
  return loudness.map(v => 10 ** ((target - v) / 20));
}

/**
 * Gain that plays a cue at `targetLufs` by its ungated K-weighted loudness, never pushing the sample peak above
 * `ceilingDbfs`. Returns 1 when the measurement is missing.
 */
export function levelGain(measurements, targetLufs = -23, ceilingDbfs = -1) {
  const lufs = measurements?.loudness?.ungatedLufs, peak = measurements?.peak?.sampleDbfs;
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) return 1;
  return Math.min(10 ** ((targetLufs - lufs) / 20), 10 ** ((ceilingDbfs - peak) / 20));
}

export const dbOf = gain => (gain > 0 ? Math.round(20 * Math.log10(gain) * 10) / 10 : -Infinity);

// ---- blind A/B ---------------------------------------------------------------------------------

/** `n` trials, half with the target as "1" and half as "2", in a random order from `rand()` in [0, 1). */
export function makeTrials(n, rand) {
  const flags = Array.from({length: n}, (_, i) => i % 2 === 0);
  for (let i = flags.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [flags[i], flags[j]] = [flags[j], flags[i]]; }
  return flags.map(targetFirst => ({targetFirst}));
}

/** One-sided exact binomial p-value: the chance of k or more right answers out of n by guessing. */
export function binomialP(k, n) {
  let p = 0, c = 1;
  for (let i = 0; i <= n; i++) {
    if (i >= k) p += c;
    c = c * (n - i) / (i + 1);
  }
  return Math.min(1, p / 2 ** n);
}

/** answers[i] is 1 or 2 (what the listener picked as the target). */
export function scoreTrials(trials, answers) {
  const done = trials.map((t, i) => [t, answers[i]]).filter(([, a]) => a === 1 || a === 2);
  const correct = done.filter(([t, a]) => (a === 1) === t.targetFirst).length;
  return {n: done.length, correct, p: done.length ? binomialP(correct, done.length) : 1,
    verdict: !done.length ? 'none' : binomialP(correct, done.length) < 0.05 ? 'distinct' : 'confusable'};
}

/** Closest pairs by feature distance after z-scoring each feature. features: [{id, v: number[]}]. */
export function nearestPairs(features, count = 8) {
  if (features.length < 2) return [];
  const dims = features[0].v.length, mean = Array(dims).fill(0), sd = Array(dims).fill(0);
  for (const f of features) f.v.forEach((x, i) => { mean[i] += x / features.length; });
  for (const f of features) f.v.forEach((x, i) => { sd[i] += (x - mean[i]) ** 2 / features.length; });
  const z = features.map(f => ({id: f.id, v: f.v.map((x, i) => (sd[i] > 0 ? (x - mean[i]) / Math.sqrt(sd[i]) : 0))}));
  const pairs = [];
  for (let i = 0; i < z.length; i++) for (let j = i + 1; j < z.length; j++)
    pairs.push({a: z[i].id, b: z[j].id, distance: Math.round(Math.sqrt(z[i].v.reduce((s, x, k) => s + (x - z[j].v[k]) ** 2, 0)) * 100) / 100});
  return pairs.sort((x, y) => x.distance - y.distance || x.a.localeCompare(y.a) || x.b.localeCompare(y.b)).slice(0, count);
}

// ---- sprite map --------------------------------------------------------------------------------

/**
 * Cues of one sprite sheet as segments with the silent gap before and after each, and the problems a reviewer would
 * want flagged: overlap, a gap shorter than the pack's guard, an entry running past the sheet.
 * cues: [{id, start, onset, tailEnd, end}] in frames (end exclusive); guard in frames.
 */
export function spriteSegments(cues, total, guard) {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const issues = [];
  const segments = sorted.map((c, i) => {
    const before = i === 0 ? c.start : c.start - sorted[i - 1].end;
    const after = (sorted[i + 1]?.start ?? total) - c.end;
    if (before < 0) issues.push({kind: 'overlap', id: c.id, with: sorted[i - 1].id});
    else if (before < guard && i > 0) issues.push({kind: 'gap', id: c.id, frames: before});
    if (i === 0 && c.start < guard) issues.push({kind: 'leadGap', id: c.id, frames: c.start});
    if (c.end > total) issues.push({kind: 'past', id: c.id});
    if (i === sorted.length - 1 && after < guard) issues.push({kind: 'trailGap', id: c.id, frames: after});
    return {...c, gapBefore: before, gapAfter: after, activeFrames: Math.max(0, c.tailEnd - c.onset)};
  });
  return {segments, issues};
}

// ---- checklist and sign-off --------------------------------------------------------------------

export const checklistItems = {
  bed: ['seam', 'headTail', 'mono', 'codecs', 'distinct'],
  effect: ['onset', 'tail', 'mono', 'distinct', 'overBed']
};

/** The note stored with a sign-off: what was checked, the blind result, which versions were heard. At most 1000 characters. */
export function signoffNote({kind, checked, labels, blind, heard, free}) {
  const items = (checklistItems[kind] ?? []).map(id => `${checked?.[id] ? '[x]' : '[ ]'} ${labels?.[id] ?? id}`).join('; ');
  const parts = [items];
  if (blind?.n) parts.push(`blind ${blind.correct}/${blind.n} p=${blind.p.toFixed(3)}`);
  if (heard?.length) parts.push('heard ' + heard.join(','));
  if (free) parts.push(free);
  return parts.filter(Boolean).join(' | ').slice(0, 1000);
}

export const allChecked = (kind, checked) => (checklistItems[kind] ?? []).every(id => checked?.[id]);

export const frameToSeconds = (frames, rate) => frames / rate;
export const formatFrames = (frames, rate) => `${frames.toLocaleString('en-US')} (${(frames / rate).toFixed(3)} s)`;
export const formatDb = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '—');

// ---- editable parameters of an engine document -------------------------------------------------

const skipKeys = new Set(['schema', 'version', 'id', 'sampleRate', 'patterns', 'tracks']);

/** Every numeric leaf a reviewer may tweak, as {path, label, value}; events (patterns, tracks), ids and the sample rate are left out. */
export function numericParams(doc) {
  const out = [];
  (function walk(node, path) {
    if (typeof node === 'number' && Number.isFinite(node)) out.push({path, label: pathLabel(path), value: node});
    else if (Array.isArray(node)) node.forEach((v, i) => walk(v, [...path, i]));
    else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (!(path.length === 0 && skipKeys.has(k))) walk(v, [...path, k]);
  })(doc, []);
  return out;
}

export function pathLabel(path) {
  return path.reduce((s, p) => (typeof p === 'number' ? `${s}[${p}]` : s ? `${s}.${p}` : p), '');
}

/** A copy of `doc` with one numeric leaf replaced. */
export function withParam(doc, path, value) {
  const copy = structuredClone(doc);
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key];
  node[path.at(-1)] = value;
  return copy;
}

/** The top-level group a parameter belongs to (a layer, an instrument, the reverb, the document), for grouping the editor. */
export function paramGroup(path) {
  if (path[0] === 'layers') return `layers[${path[1]}]`;
  if (path[0] === 'instruments') return `instruments.${path[1]}`;
  return path.length > 1 ? String(path[0]) : '';
}

export const stepFor = value => (Math.abs(value) >= 100 ? 1 : Math.abs(value) >= 10 ? 0.5 : Math.abs(value) >= 1 ? 0.05 : 0.005);
