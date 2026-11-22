// Overview panels that read only the overview payload: pipeline table, atlas chunk cards, wave progress.
// Chips, stats and slips come from components.css (.ui-kit).
import { h } from './dom.mjs';

const stages = ['packed', 'authored', 'planned'];
export const MiB = 1024 * 1024;
export const num = new Intl.NumberFormat('en');
const CHIP = {ok: 'ok', full: 'warn', over: 'danger', none: ''};
export const humanize = id => id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export function bar(ctx, counts, total, name) {
  const wrap = h('div', {class: 'bar', role: 'img', 'aria-label': `${name}: ` + stages.map(s => `${ctx.t('stage.' + s)} ${counts[s] ?? 0}`).join(', ')});
  for (const stage of stages) {
    const n = counts[stage] ?? 0;
    if (!n) continue;
    const seg = h('span', {class: 'bar-seg stage-' + stage, title: `${ctx.t('stage.' + stage)}: ${n}`});
    seg.style.flexGrow = n;
    wrap.append(seg);
  }
  if (!total) wrap.append(h('span', 'bar-seg stage-empty'));
  return wrap;
}

const counts = (ctx, c) => h('span', 'counts', ...stages.map(s => h('span', 'count stage-' + s, h('b', '', String(c[s] ?? 0)), ' ' + ctx.t('stage.' + s))));

export function stat(ctx, key, value, note, tone) {
  return h('div', {class: 'stat' + (tone ? ' ' + tone : '')}, h('span', 'stat-label', ctx.t(key)), h('span', 'stat-value', value), note ? h('span', 'stat-hint', note) : null);
}

/** A titled section; `aside` (a button or link) sits at the end of the heading row. */
export function section(id, title, intro, aside, ...body) {
  const head = h('div', 'ov-section-head', h('h2', {id}, title), aside);
  return h('section', {class: 'ov-section', 'aria-labelledby': id}, head, intro ? h('p', 'muted', intro) : null, ...body);
}

export function readinessTable(ctx, data) {
  const labels = new Map(ctx.project.sources.map(s => [s.id, ctx.label(s.label)]));
  const row = (cls, name, label, c) => h('tr', cls, h('th', {scope: 'row'}, label), h('td', 'num', num.format(c.total)), h('td', 'barcell', bar(ctx, c, c.total, name)), h('td', '', counts(ctx, c)));
  const rows = [];
  for (const [id, c] of Object.entries(data.bySource)) {
    const name = labels.get(id) ?? humanize(id);
    rows.push(row('row-source', name, name, c));
    for (const [group, g] of Object.entries(data.bySourceGroup[id] ?? {})) rows.push(row('row-group', `${name} · ${humanize(group)}`, humanize(group), g));
  }
  const head = ['source', 'total', 'pipeline', 'stages'].map(k => h('th', {scope: 'col', class: k === 'total' ? 'num' : null}, ctx.t('col.' + k)));
  return h('div', 'table-wrap', h('table', 'ov-table', h('caption', 'sr-only', ctx.t('readiness.title')), h('thead', '', h('tr', '', ...head)), h('tbody', '', ...rows)));
}

export function chunkCards(ctx, chunks) {
  return h('div', 'chunks', ...chunks.map(c => {
    const pageText = ctx.t('chunk.pages', {used: c.pages, max: c.ceilingPages});
    const mib = ctx.t('chunk.mib', {used: (c.bytes / MiB).toFixed(2), max: (c.ceilingBytes / MiB).toFixed(2)});
    const fill = h('span', 'fill state-' + c.state);
    fill.style.width = Math.min(100, c.ceilingPages ? c.pages / c.ceilingPages * 100 : 0) + '%';
    const meter = h('div', {class: 'meter', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': c.ceilingPages, 'aria-valuenow': c.pages, 'aria-label': `${humanize(c.chunk)}: ${pageText}`}, fill);
    const r = c.readiness;
    return h('a', {class: 'slip chunk state-' + c.state, 'data-fk': 'chunk-' + c.chunk, href: ctx.href({tab: 'atlas', params: {}}), title: ctx.t('stat.budgetOpen')},
      h('header', '', h('h3', {title: humanize(c.chunk)}, humanize(c.chunk)), h('span', 'chip ' + CHIP[c.state], ctx.t('state.' + c.state))),
      meter,
      h('dl', 'kv', h('dt', '', ctx.t('chunk.pageLabel')), h('dd', '', pageText), h('dt', '', ctx.t('chunk.memLabel')), h('dd', '', mib),
        h('dt', '', ctx.t('chunk.framesLabel')), h('dd', '', num.format(c.frames)),
        h('dt', '', ctx.t('chunk.assetsLabel')), h('dd', '', ctx.t('chunk.assets', {packed: r.packed ?? 0, total: r.total}))));
  }));
}

export function waves(ctx, data) {
  const entries = Object.entries(data.byWave);
  if (!entries.length) return h('p', 'empty', ctx.t('waves.none'));
  return h('div', 'waves', ...entries.map(([wave, c]) => {
    const pct = c.total ? Math.round((c.packed ?? 0) / c.total * 100) : 0;
    return h('div', 'wave', h('div', 'wave-head', h('h3', '', humanize(wave)), h('span', 'pct', pct + '%')),
      bar(ctx, c, c.total, humanize(wave)), h('p', 'muted', ctx.t('waves.detail', {packed: c.packed ?? 0, total: c.total, planned: c.planned ?? 0})));
  }));
}
