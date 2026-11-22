// Pure data shaping for the VFX tab's server side: no file access, so node:test can drive it.
import { createHash } from 'node:crypto';

export const roles = ['start', 'loop', 'end'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Hash of a text file as the generators record it: LF line endings. */
export const sha256Lf = bytes => sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')));

/** A descriptor tag ({name, from, to, repeat?}) or an index tag ([name, from, to, kind]) as one section. */
export function normalizeSection(tag) {
  const [name, from, to, kind] = Array.isArray(tag) ? tag : [tag?.name, tag?.from, tag?.to, tag?.repeat === undefined ? 'loop' : 'once'];
  if (typeof name !== 'string' || !Number.isInteger(from) || !Number.isInteger(to) || to < from) return null;
  return {name, from, to, kind: kind === 'loop' ? 'loop' : 'once', role: roles.includes(name) ? name : null};
}

/** One core effect (index entry + descriptor) as the tab's effect shape. Frames are the descriptor's, in order. */
export function coreEffect(entry, descriptor, sourceLabel, readiness) {
  const d = descriptor ?? {};
  const frames = Array.isArray(d.frames) ? d.frames : [];
  const sections = (d.tags ?? entry.tags ?? []).map(normalizeSection).filter(Boolean);
  const events = (d.events ?? entry.events ?? []).map(e => Array.isArray(e) ? {name: e[0], frame: e[1]} : {name: e.name, frame: e.frame}).filter(e => typeof e.name === 'string' && Number.isInteger(e.frame));
  const paths = frames.map(f => f.key);
  return {
    id: entry.id, source: 'vfx', sourceLabel, group: 'core', readiness, chunk: null,
    size: entry.frame_size, anchor: entry.anchor, loop: Boolean(entry.loop), fps: entry.fps ?? null,
    sheet: entry.sheet ?? d.sheet ?? null, descriptor: entry.descriptor ?? null,
    variants: [],
    clips: [{id: 'all', kind: entry.loop ? 'loop' : 'once', ms: frames.map(f => f.duration_ms), totalMs: entry.total_ms ?? frames.reduce((a, f) => a + f.duration_ms, 0),
      paths: {'': paths}, sections, events}]
  };
}

const clipExt = '.png';
/** One Longtime effect (manifest entry) as the tab's effect shape; frame paths follow `pathTemplate`. */
export function longtimeEffect(entry, {sourceLabel, readiness, pathTemplate, existing}) {
  const variants = Object.entries(entry.palettes ?? {}).map(([id, v]) => ({id, ramps: v.ramps ?? [], uses: v.uses ?? []}));
  const clips = Object.entries(entry.clips ?? {}).map(([id, c]) => {
    const paths = {};
    for (const v of variants) {
      paths[v.id] = Array.from({length: c.n}, (_, n) => pathTemplate.replace('{clip}', id).replace('{palette}', v.id).replace('{n}', n));
      if (existing) paths[v.id] = paths[v.id].map(p => existing.has(p) ? p : null);
    }
    return {id, kind: c.kind === 'loop' ? 'loop' : 'once', ms: c.ms, totalMs: c.ms.reduce((a, b) => a + b, 0), paths,
      sections: [{name: id, from: 0, to: c.n - 1, kind: c.kind === 'loop' ? 'loop' : 'once', role: null}],
      events: (entry.events ?? []).filter(e => e[1] === id).map(e => ({name: e[0], frame: e[2]}))};
  });
  return {
    id: entry.id, source: 'longtime', sourceLabel, group: 'longtime', readiness, chunk: entry.chunk_group ?? null,
    size: entry.native_px, anchor: entry.pivot_px, loop: entry.loop === 'loop', fps: null, sheet: null, descriptor: null,
    variants, clips, related: entry.related ?? [], event: entry.event ?? null, reads: entry.reads ?? null,
    acceptance: entry.acceptance ?? null, modes: entry.modes ?? []
  };
}

/** Frame count and total duration across a whole effect, for the browser cards. */
export function effectTotals(e) {
  const clip = e.clips[0];
  if (e.group === 'core') return {frames: clip.ms.length, totalMs: clip.totalMs};
  return {frames: e.clips.reduce((a, c) => a + c.ms.length, 0), totalMs: e.clips.reduce((a, c) => a + c.totalMs, 0)};
}

/** Summaries only: card-sized, no frame paths. */
export function cardOf(e) {
  const {frames, totalMs} = effectTotals(e);
  return {id: e.id, source: e.source, group: e.group, readiness: e.readiness, chunk: e.chunk, size: e.size, anchor: e.anchor, loop: e.loop,
    frames, totalMs, clips: e.clips.map(c => c.id), variants: e.variants.map(v => v.id),
    first: e.clips[0].paths[Object.keys(e.clips[0].paths)[0]]?.find(Boolean) ?? null};
}

/** Summary of a SpriteFX spec: what the left column shows. Ramps carry the palette ids of their colours. */
export function specSummary(spec, hexToId = new Map()) {
  const s = spec && typeof spec === 'object' ? spec : {};
  const ramps = Object.entries(s.ramps ?? {}).map(([name, r]) => ({name,
    colors: (Array.isArray(r) ? r : r?.colors ?? []).filter(c => typeof c === 'string').map(hex => ({hex: hex.toLowerCase(), paletteId: hexToId.get(hex.toLowerCase()) ?? null}))}));
  return {
    type: s.type ?? null, canvas: s.canvas ?? null, anchor: s.anchor ?? null, fps: s.fps ?? null, seed: s.seed ?? null, palette: s.palette ?? null,
    outline: s.outline ?? null, ramps,
    phases: (s.phases ?? []).map(p => ({name: p.name, ticks: p.ticks, fast: Boolean(p.fast), events: p.events ?? []})),
    layers: (s.layers ?? []).map(l => ({id: l.id, kind: l.kind, ramp: l.ramp ?? null, role: l.role ?? null, during: l.during ?? []}))
  };
}

/** Pixel-count metrics of decoded RGBA frames: opaque share per frame and colour count. */
export function frameMetrics(frames) {
  const colors = new Set();
  const pct = frames.map(({width, height, pixels}) => {
    let opaque = 0;
    for (let i = 0; i < width * height; i++) {
      if (pixels[i * 4 + 3] > 0) { opaque++; colors.add((pixels[i * 4] << 16) | (pixels[i * 4 + 1] << 8) | pixels[i * 4 + 2]); }
    }
    return Math.round(opaque / (width * height) * 1000) / 10;
  });
  return {opaquePct: pct, colors: colors.size};
}

/** Check a clip's measured series against a Longtime `acceptance` block. Each check says measured, limit and pass. */
export function checkAcceptance(metrics, acceptance) {
  if (!acceptance || !metrics.opaquePct.length) return [];
  const s = metrics.opaquePct, first = s[0], last = s[s.length - 1], peak = Math.max(...s);
  let jump = 0;
  for (let i = 1; i < s.length; i++) jump = Math.max(jump, Math.abs(s[i] - s[i - 1]));
  jump = Math.round(jump * 10) / 10;
  const out = [];
  if (typeof acceptance.first_frame_max_opaque_pct === 'number') out.push({id: 'first', measured: first, limit: `≤ ${acceptance.first_frame_max_opaque_pct}`, pass: first <= acceptance.first_frame_max_opaque_pct});
  if (typeof acceptance.last_frame_max_opaque_pct === 'number') out.push({id: 'last', measured: last, limit: `≤ ${acceptance.last_frame_max_opaque_pct}`, pass: last <= acceptance.last_frame_max_opaque_pct});
  if (Array.isArray(acceptance.peak_opaque_pct)) out.push({id: 'peak', measured: peak, limit: `${acceptance.peak_opaque_pct[0]}–${acceptance.peak_opaque_pct[1]}`, pass: peak >= acceptance.peak_opaque_pct[0] && peak <= acceptance.peak_opaque_pct[1]});
  if (typeof acceptance.max_frame_jump_pct === 'number') out.push({id: 'jump', measured: jump, limit: `≤ ${acceptance.max_frame_jump_pct}`, pass: jump <= acceptance.max_frame_jump_pct});
  if (typeof acceptance.max_colors_per_palette === 'number') out.push({id: 'colors', measured: metrics.colors, limit: `≤ ${acceptance.max_colors_per_palette}`, pass: metrics.colors <= acceptance.max_colors_per_palette});
  return out;
}

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/^`|`$/g, ''));
const tableRows = (text, heading) => {
  const lines = text.split('\n');
  const start = lines.findIndex(l => heading.test(l));
  if (start < 0) return [];
  const rows = [];
  let seen = false;
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('|')) { seen = true; rows.push(cells(line)); }
    else if (seen) break;
  }
  return rows.filter(r => !/^[-: ]+$/.test(r[0]));
};

/**
 * The self-scoring tables the generators' authors recorded. Core: "| id | v1 | v4 | audit v1 → v4 |" with scores
 * "originality/read/consistency/wow". Longtime: "| id | read | total | weakness |". Returns Map id → record.
 * Aura rows are written for a family ("breakthrough_aura ×4") and fanned out to its members.
 */
export function parseCoreRubric(text, ids) {
  const out = new Map();
  const rows = tableRows(String(text), /^## Rubric/).slice(1);
  for (const r of rows) {
    if (r.length < 4) continue;
    const members = ids.filter(id => id === r[0] || (/×\d+$/.test(r[0]) && id.startsWith(r[0].replace(/\s*×\d+$/, '').replace(/\{.*\}$/, ''))));
    const score = s => { const p = s.split('/').map(Number); return p.length === 4 && p.every(Number.isFinite) ? {originality: p[0], readability: p[1], consistency: p[2], wow: p[3]} : null; };
    const errors = r[3].match(/^(\d+(?:-\d+)?)\D*→\s*(\d+)/);
    for (const id of members) out.set(id, {v1: score(r[1]), v4: score(r[2]), auditErrors: errors ? {v1: errors[1], v4: Number(errors[2])} : null});
  }
  return out;
}

export function parseLongtimeSelfScores(text, ids) {
  const out = new Map();
  const rows = tableRows(String(text), /^### 8\.4/).slice(1);
  for (const r of rows) {
    if (r.length < 4 || !ids.includes(r[0])) continue;
    out.set(r[0], {readability: Number(r[1]), overall: Number(r[2]), weakness: r.slice(3).join(' | ')});
  }
  return out;
}

/** What changed between a round's spec summary and the final one, as plain comparable facts. */
export function diffSummaries(a, b) {
  const sum = s => s.phases.reduce((n, p) => n + (p.ticks ?? 0), 0);
  const ids = s => s.layers.map(l => l.id);
  const colors = s => new Set(s.ramps.flatMap(r => r.colors.map(c => c.hex)));
  const [ca, cb] = [colors(a), colors(b)];
  return {
    ticks: [sum(a), sum(b)], layers: [a.layers.length, b.layers.length], fps: [a.fps, b.fps], seed: [a.seed, b.seed],
    layersAdded: ids(b).filter(i => !ids(a).includes(i)), layersRemoved: ids(a).filter(i => !ids(b).includes(i)),
    colorsAdded: [...cb].filter(c => !ca.has(c)), colorsRemoved: [...ca].filter(c => !cb.has(c)),
    same: JSON.stringify(a) === JSON.stringify(b)
  };
}
