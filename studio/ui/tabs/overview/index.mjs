// Overview: every asset by readiness, atlas budget per chunk and wave progress.
// All numbers come from GET /api/studio/overview; nothing here is hard-coded.

import { h } from './dom.mjs';

const stages = ['packed', 'authored', 'planned'];
const MiB = 1024 * 1024;
const num = new Intl.NumberFormat('en');

const humanize = id => id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

function bar(ctx, counts, total, name) {
  const wrap = h('div', 'bar');
  wrap.setAttribute('role', 'img');
  wrap.setAttribute('aria-label', `${name}: ` + stages.map(s => `${ctx.t('stage.' + s)} ${counts[s] ?? 0}`).join(', '));
  for (const stage of stages) {
    const n = counts[stage] ?? 0;
    if (!n) continue;
    const seg = h('span', 'seg stage-' + stage);
    seg.style.flexGrow = n;
    seg.title = `${ctx.t('stage.' + stage)}: ${n}`;
    wrap.append(seg);
  }
  if (!total) wrap.append(h('span', 'seg stage-empty'));
  return wrap;
}

function counts(ctx, c, name) {
  return h('span', 'counts', ...stages.map(s => h('span', 'count stage-' + s, h('b', '', String(c[s] ?? 0)), ' ' + ctx.t('stage.' + s))));
}

function stat(ctx, key, value, note, tone) {
  return h('div', 'stat' + (tone ? ' stat-' + tone : ''), h('dt', '', ctx.t(key)), h('dd', '', value, note ? h('small', '', note) : null));
}

function section(ctx, id, title, intro, ...body) {
  const el = h('section', 'ov-section', h('h2', {}, title), intro ? h('p', 'muted', intro) : null, ...body);
  el.setAttribute('aria-labelledby', id);
  el.firstChild.id = id;
  return el;
}

function readinessTable(ctx, data) {
  const labels = new Map(ctx.project.sources.map(s => [s.id, ctx.label(s.label)]));
  const rows = [];
  for (const [id, c] of Object.entries(data.bySource)) {
    const name = labels.get(id) ?? humanize(id);
    rows.push(h('tr', 'row-source', h('th', {scope: 'row'}, name), h('td', 'num', num.format(c.total)), h('td', 'barcell', bar(ctx, c, c.total, name)), h('td', '', counts(ctx, c))));
    for (const [group, g] of Object.entries(data.bySourceGroup[id] ?? {})) {
      const gname = `${name} · ${humanize(group)}`;
      rows.push(h('tr', 'row-group', h('th', {scope: 'row'}, humanize(group)), h('td', 'num', num.format(g.total)), h('td', 'barcell', bar(ctx, g, g.total, gname)), h('td', '', counts(ctx, g))));
    }
  }
  const table = h('table', 'ov-table', h('caption', 'sr-only', ctx.t('readiness.title')),
    h('thead', '', h('tr', '', h('th', {scope: 'col'}, ctx.t('col.source')), h('th', {scope: 'col', class: 'num'}, ctx.t('col.total')), h('th', {scope: 'col'}, ctx.t('col.pipeline')), h('th', {scope: 'col'}, ctx.t('col.stages')))),
    h('tbody', '', ...rows));
  return h('div', 'table-wrap', table);
}

function chunkCards(ctx, chunks) {
  return h('div', 'chunks', ...chunks.map(c => {
    const pageText = ctx.t('chunk.pages', {used: c.pages, max: c.ceilingPages});
    const mib = ctx.t('chunk.mib', {used: (c.bytes / MiB).toFixed(2), max: (c.ceilingBytes / MiB).toFixed(2)});
    const fill = h('span', 'fill state-' + c.state);
    fill.style.width = Math.min(100, c.ceilingPages ? c.pages / c.ceilingPages * 100 : 0) + '%';
    const meter = h('div', 'meter', fill);
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', String(c.ceilingPages));
    meter.setAttribute('aria-valuenow', String(c.pages));
    meter.setAttribute('aria-label', `${humanize(c.chunk)}: ${pageText}`);
    const r = c.readiness;
    return h('article', 'chunk state-' + c.state,
      h('header', '', h('h3', '', humanize(c.chunk)), h('span', 'badge state-' + c.state, ctx.t('state.' + c.state))),
      meter,
      h('dl', 'kv', h('dt', '', ctx.t('chunk.pageLabel')), h('dd', '', pageText), h('dt', '', ctx.t('chunk.memLabel')), h('dd', '', mib),
        h('dt', '', ctx.t('chunk.framesLabel')), h('dd', '', num.format(c.frames)),
        h('dt', '', ctx.t('chunk.assetsLabel')), h('dd', '', ctx.t('chunk.assets', {packed: r.packed ?? 0, total: r.total}))));
  }));
}

function waves(ctx, data) {
  const entries = Object.entries(data.byWave);
  if (!entries.length) return h('p', 'muted', ctx.t('waves.none'));
  return h('div', 'waves', ...entries.map(([wave, c]) => {
    const pct = c.total ? Math.round((c.packed ?? 0) / c.total * 100) : 0;
    return h('div', 'wave', h('div', 'wave-head', h('h3', '', humanize(wave)), h('span', 'pct', pct + '%')),
      bar(ctx, c, c.total, humanize(wave)), h('p', 'muted', ctx.t('waves.detail', {packed: c.packed ?? 0, total: c.total, planned: c.planned ?? 0})));
  }));
}

function render(ctx, data) {
  const o = data.overall;
  const packedPct = o.total ? Math.round(o.packed / o.total * 100) : 0;
  const budgetRisk = data.chunks.filter(c => c.state === 'full' || c.state === 'over').length;
  ctx.root.replaceChildren(
    h('header', 'ov-head', h('div', '', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle', {project: ctx.project.name}))),
      (() => { const b = h('button', 'plain', ctx.t('refresh')); b.type = 'button'; b.addEventListener('click', () => load(ctx)); return b; })()),
    h('dl', 'stats',
      stat(ctx, 'stat.total', num.format(o.total), ctx.t('stat.totalNote', {sources: Object.keys(data.bySource).length})),
      stat(ctx, 'stat.packed', num.format(o.packed), packedPct + '%', 'packed'),
      stat(ctx, 'stat.authored', num.format(o.authored), ctx.t('stat.authoredNote'), 'authored'),
      stat(ctx, 'stat.planned', num.format(o.planned), ctx.t('stat.plannedNote'), 'planned'),
      stat(ctx, 'stat.budget', String(budgetRisk), ctx.t('stat.budgetNote', {chunks: data.chunks.length}), budgetRisk ? 'warn' : '')),
    section(ctx, 'ov-readiness', ctx.t('readiness.title'), ctx.t('readiness.intro'), readinessTable(ctx, data)),
    section(ctx, 'ov-chunks', ctx.t('chunks.title'), ctx.t('chunks.intro'), chunkCards(ctx, data.chunks)),
    section(ctx, 'ov-waves', ctx.t('waves.title'), ctx.t('waves.intro'), waves(ctx, data)));
}

async function load(ctx) {
  ctx.root.setAttribute('aria-busy', 'true');
  try { render(ctx, await ctx.api('overview')); }
  catch (error) {
    if (error.name === 'AbortError') return;
    const retry = h('button', 'plain', ctx.t('common.retry'));
    retry.type = 'button';
    retry.addEventListener('click', () => load(ctx));
    ctx.root.replaceChildren(h('p', {role: 'alert'}, ctx.t('common.error', {message: error.message})), retry);
  } finally { ctx.root.removeAttribute('aria-busy'); }
}

/** Overview has no asset-level state: any URL parameters are ignored. */
export function parseRoute() { return {}; }

export async function mount(ctx) {
  ctx.loadCss(new URL('./overview.css', import.meta.url));
  await load(ctx);
}
