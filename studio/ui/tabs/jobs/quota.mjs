// Generations and wall time per agent and per kind of work, with the ceiling the pack sets. Counts what the studio recorded; it knows no prices.
import { h, fill } from './dom.mjs';
import { fmtDuration } from './model.mjs';

const cap = (v, unit) => (v === undefined || v === null ? '–' : unit === 'ms' ? fmtDuration(v) : String(v));

export function renderQuota(ctx, host, q) {
  if (!q) return fill(host);
  const rows = q.byAgentKind;
  const c = q.ceilings;
  const limits = [c.all?.generations !== undefined ? ctx.t('quota.ceiling.generations', {n: c.all.generations}) : null, c.all?.wallMs !== undefined ? ctx.t('quota.ceiling.time', {t: cap(c.all.wallMs, 'ms')}) : null,
    c.perAgent?.generations !== undefined ? ctx.t('quota.ceiling.agentGenerations', {n: c.perAgent.generations}) : null, c.perAgent?.wallMs !== undefined ? ctx.t('quota.ceiling.agentTime', {t: cap(c.perAgent.wallMs, 'ms')}) : null,
    c.perRun?.generations !== undefined ? ctx.t('quota.ceiling.run', {n: c.perRun.generations}) : null].filter(Boolean);
  fill(host, h('h2', '', ctx.t('quota.title')), h('p', 'muted', ctx.t('quota.intro')),
    h('p', '', ctx.t('quota.total', {generations: q.all.generations, time: fmtDuration(q.all.wallMs), window: ctx.t(q.window === 'day' ? 'quota.window.day' : 'quota.window.all')})),
    h('p', 'muted', limits.length ? ctx.t('quota.ceilings', {limits: limits.join(' · ')}) : ctx.t('quota.noCeiling')),
    rows.length ? h('div', 'tblwrap', h('table', 'tbl', h('caption', 'sr-only', ctx.t('quota.title')),
      h('thead', '', h('tr', '', ...['quota.col.agent', 'quota.col.kind', 'quota.col.runs', 'quota.col.generations', 'quota.col.time'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
      h('tbody', '', ...rows.map(r => h('tr', '', h('td', '', r.agent || '?'), h('td', '', r.kind === 'image-tool' ? ctx.t('quota.kind.image') : ctx.t('quota.kind.toolchain')), h('td', 'num', String(r.runs)), h('td', 'num', String(r.generations)), h('td', 'num', fmtDuration(r.wallMs))))))) : h('p', 'muted', ctx.t('quota.none')));
}
