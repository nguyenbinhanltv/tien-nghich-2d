// Pure helpers for the Review tab (no DOM, no fetch): route state, comment parsing, pixel diff, inbox filters.
export const states = ['waiting', 'agent', 'decided', 'all'];
export const kinds = ['art', 'audio'];
const idPattern = /^[A-Za-z0-9_.-]+$/;

export function parseRoute(route = {}) {
  const p = route.params ?? {};
  return {
    asset: route.asset ?? null, clip: route.asset ? route.clip ?? null : null, direction: route.asset ? route.direction ?? null : null,
    frame: route.asset ? route.frame ?? null : null,
    key: typeof p.key === 'string' && /^[A-Za-z0-9_./-]{1,200}$/.test(p.key) && !p.key.includes('..') ? p.key : null,
    rev: /^(0|[1-9]\d{0,5})$/.test(p.rev ?? '') ? Number(p.rev) : null,
    state: states.includes(p.state) ? p.state : 'waiting',
    kind: kinds.includes(p.kind) ? p.kind : null,
    agent: typeof p.agent === 'string' && idPattern.test(p.agent) ? p.agent : null,
    zoom: /^[1-8]$/.test(p.zoom ?? '') ? Number(p.zoom) : 4
  };
}

export function stateParams(s) {
  const out = {};
  if (s.key) out.key = s.key;
  if (s.rev != null) out.rev = String(s.rev);
  if (s.state !== 'waiting') out.state = s.state;
  if (s.kind) out.kind = s.kind;
  if (s.agent) out.agent = s.agent;
  if (s.zoom !== 4) out.zoom = String(s.zoom);
  return out;
}

const frameName = /^(?<clip>[a-z0-9]+(?:_[a-z0-9]+)*)_(?<direction>south|east|north|west|none|f\d+)_(?<n>\d+)$/;

/** `group/hero/idle_south_2` → {asset, clip, direction, n}; null when the last segment is not a sprite name. */
export function parseKey(key) {
  const parts = String(key).split('/');
  const m = frameName.exec(parts.at(-1) ?? '');
  if (parts.length < 3 || !m) return null;
  return {asset: parts[1], clip: m.groups.clip, direction: m.groups.direction, n: Number(m.groups.n)};
}

// The VFX tab stores a human's 1x readability read as a typed comment on the effect's first frame:
// `[vfx-1x-read score=4/5 variant=x] note`. It is recognised only at the very start of a comment that
// carries no agent tag, so an agent (whose comments always open with its tag) cannot post one.
const readNote = /^\[vfx-1x-read((?: score=[1-5]\/5)?(?: variant=[A-Za-z0-9_.-]+)?)\]\s*([\s\S]*)$/;

const tag = /^\[agent (?<agent>.+?) · (?<session>[0-9a-f]{1,16})\] (?<rest>[\s\S]*)$/;

/**
 * One stored comment as the thread shows it. Agent comments are marked with `[agent <name> · <session>]`
 * by studio/core/review.mjs; everything else is a human's. A human cannot be impersonated by text alone
 * for the purposes of a decision: decisions are statuses, never comment text.
 */
export function parseComment(text) {
  const t = tag.exec(text ?? '');
  const read = !t && readNote.exec(text ?? '');
  if (read) return {by: 'human', kind: 'read', score: Number(/score=([1-5])/.exec(read[1])?.[1]) || null, variant: /variant=([A-Za-z0-9_.-]+)/.exec(read[1])?.[1] ?? null, body: read[2], questions: []};
  if (!t) return {by: 'human', kind: 'comment', body: String(text ?? ''), questions: []};
  const {agent, session, rest} = t.groups;
  let m;
  if ((m = /^REVIEW REQUEST (rq-[0-9a-f]+): ([\s\S]*)$/.exec(rest))) {
    const [note, ...q] = m[2].split(/\nQuestions:\n/);
    const questions = (q[0] ?? '').split('\n').map(l => /^\d+\. (.+)$/.exec(l)?.[1]).filter(Boolean);
    return {by: 'agent', agent, session, kind: 'request', request: m[1], body: note, questions};
  }
  if ((m = /^REPLY to #(\d+)( \(handled\))?: ([\s\S]*)$/.exec(rest))) return {by: 'agent', agent, session, kind: 'reply', replyTo: Number(m[1]), handled: !!m[2], body: m[3], questions: []};
  if ((m = /^NOTE: ([\s\S]*)$/.exec(rest))) return {by: 'agent', agent, session, kind: 'note', body: m[1], questions: []};
  return {by: 'agent', agent, session, kind: 'note', body: rest, questions: []};
}

/** Comments with their parsed form, and for each human comment whether an agent reply marked it handled. */
export function thread(comments) {
  const parsed = comments.map((c, index) => ({index, status: c.status, ...parseComment(c.text)}));
  const handled = new Set(parsed.filter(c => c.kind === 'reply' && c.handled).map(c => c.replyTo));
  // A readability read is a note about the effect, not a message that waits for an answer.
  const replied = new Set(parsed.filter(c => c.kind === 'reply').map(c => c.replyTo));
  return parsed.map(c => ({...c, handled: c.by === 'human' ? handled.has(c.index) : c.handled, replied: c.by === 'human' && replied.has(c.index), answerable: c.by === 'human' && c.kind !== 'read'}));
}

/** Changed pixels between two same-size RGBA buffers: {mask, count, width, height, bbox} or {error:'size'}. */
export function diffPixels(a, b, width, height) {
  if (!a || !b || a.length !== b.length || a.length !== width * height * 4) return {error: 'size'};
  const mask = new Uint8Array(width * height);
  let count = 0, x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    // Transparent pixels are equal whatever their RGB, as in the project's alpha rule.
    const ta = a[o + 3] === 0, tb = b[o + 3] === 0;
    const same = ta && tb ? true : a[o] === b[o] && a[o + 1] === b[o + 1] && a[o + 2] === b[o + 2] && a[o + 3] === b[o + 3];
    if (same) continue;
    mask[i] = 1; count++;
    const x = i % width, y = (i / width) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return {mask, count, width, height, bbox: count ? {x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1} : null};
}

/** Which revision is "before" the selected one: its parent, or null for a lineage root. */
export const beforeOf = (history, revision) => history.find(h => h.revision === revision)?.parent ?? null;

export function visibleItems(items, state) {
  return items.filter(i => (state.state === 'all' || (state.state === 'waiting' ? i.state === 'waiting' : state.state === 'agent' ? i.state === 'agent' : i.state === 'decided'))
    && (!state.agent || i.requests.some(r => r.agent === state.agent)));
}

export const countsByState = items => items.reduce((all, i) => (all[i.state] = (all[i.state] ?? 0) + 1, all), {});

/**
 * Should a poll-driven repaint of the open item wait? Yes when the human has typed, or is typing, in it:
 * the thread changed under them, so tell them and let them choose, instead of rebuilding the form.
 * A navigation (another item, revision or zoom) always repaints.
 */
export const shouldDeferRepaint = ({poll, sameItem, hasDraft}) => !!(poll && sameItem && hasDraft);

export const draftKey = (kind, id, revision = '') => `${kind}:${id}@${revision}`;

/** hh:mm:ss on a 24-hour clock in the page language's own locale conventions. */
export const clock = (date, lang) => date.toLocaleTimeString(lang === 'vi' ? 'vi-VN' : 'en-GB', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'});

/** Whole seconds waited since `since` (ms); never negative. */
export const elapsedSeconds = (since, now) => Math.max(0, Math.floor((now - since) / 1000));
