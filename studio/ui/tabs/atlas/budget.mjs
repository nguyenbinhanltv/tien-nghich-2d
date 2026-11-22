// Chunk budget: pages, pixels and bytes of the shipped atlases against the mobile budget the project defines, and what packing the staged assets would change.
import { h, button, fill } from './dom.mjs';
import { badge, bar, failure, stateBadge } from './common.mjs';
import { fmtBytes } from './model.mjs';

function whatIfBlock(app, sel, result) {
  const {ctx} = app;
  if (!result) return null;
  if (!result.staged.length) return h('p', 'muted', ctx.t('budget.whatif.none'));
  const rows = sel.set.profiles.map(p => {
    const x = result.profiles[p];
    return h('tr', '', h('th', {scope: 'row'}, p), h('td', 'num', `${x.before.pages} → ${x.after.pages}`), h('td', 'num', `${fmtBytes(x.before.bytes)} → ${fmtBytes(x.after.bytes)}`), h('td', '', x.budget ? stateBadge(ctx, x.budget.state) : '–'));
  });
  return h('div', 'whatif', h('p', '', ctx.t('budget.whatif.intro', {n: result.staged.length, frames: result.frames.after - result.frames.before})),
    h('ul', 'plain', ...result.staged.map(a => h('li', '', h('code', '', a.id), ' ', h('span', 'muted', ctx.t('budget.whatif.frames', {n: a.frames}))))),
    h('table', 'tbl', h('thead', '', h('tr', '', ...['budget.col.profile', 'budget.col.pages', 'budget.col.bytes', 'budget.col.state'].map(k => h('th', {scope: 'col'}, ctx.t(k))))), h('tbody', '', ...rows)));
}

function chunkRow(app, set, c, sel) {
  const {ctx} = app;
  const mobile = c.shipped[set.design?.profile ?? 'mobile'] ?? Object.values(c.shipped)[0];
  const b = mobile.budget;
  const open = sel.chunk === c.id;
  const whatif = app.whatif.get(`${set.id}|${c.id}`);
  const tr = h('tr', {class: open ? 'on' : ''},
    h('th', {scope: 'row'}, h('a', {href: ctx.href(app.route({chunk: c.id, page: 0, key: null}))}, h('code', '', c.id))),
    h('td', 'num', String(c.assets)), h('td', 'num', String(mobile.frames)),
    h('td', '', bar(ctx, {used: mobile.pages, ceiling: b.ceilingPages, label: ctx.t('budget.col.pages'), format: String})),
    h('td', '', bar(ctx, {used: mobile.bytes, ceiling: b.ceilingBytes, label: ctx.t('budget.col.bytes'), format: fmtBytes})),
    h('td', '', stateBadge(ctx, b.state)),
    h('td', '', button(ctx.t('budget.whatif.button'), async ev => {
      ev.target.disabled = true;
      try { app.whatif.set(`${set.id}|${c.id}`, await ctx.tabApi('whatif?' + new URLSearchParams({set: set.id, chunk: c.id}))); } catch (error) { app.whatif.set(`${set.id}|${c.id}`, {error: error.message, staged: [], profiles: {}, frames: {before: 0, after: 0}}); }
      app.render();
    })));
  return [tr, whatif ? h('tr', 'sub', h('td', {colspan: '7'}, whatif.error ? h('p', {class: 'banner bad', role: 'alert'}, ctx.t('error.generic', {message: whatif.error})) : whatIfBlock(app, {set}, whatif))) : null];
}

export function renderBudget(app, sel, box) {
  const {ctx} = app, set = sel.set;
  const cols = ['budget.col.chunk', 'budget.col.assets', 'budget.col.frames', 'budget.col.pages', 'budget.col.bytes', 'budget.col.state', 'budget.col.whatif'];
  if (set.chunked) {
    return fill(box, h('p', 'muted', ctx.t('budget.intro', {profile: set.design?.profile ?? 'mobile'})),
      h('div', 'tblwrap', h('table', 'tbl', h('caption', 'sr-only', ctx.t('budget.title')),
        h('thead', '', h('tr', '', ...cols.map(k => h('th', {scope: 'col'}, ctx.t(k))))), h('tbody', '', ...set.chunks.flatMap(c => chunkRow(app, set, c, sel))))));
  }
  const rows = set.profiles.map(p => {
    const s = set.shipped[p];
    return h('tr', '', h('th', {scope: 'row'}, h('code', '', p)), h('td', 'num', String(s.frames)), h('td', 'num', String(s.pages)), h('td', 'num', fmtBytes(s.bytes)),
      h('td', 'mono', s.sizes.map(([w, hh]) => `${w}×${hh}`).join(', ') || '–'), h('td', '', stateBadge(ctx, s.budget.state)));
  });
  fill(box, h('p', 'muted', ctx.t('budget.noCeiling')),
    h('div', 'tblwrap', h('table', 'tbl', h('thead', '', h('tr', '', ...['budget.col.profile', 'budget.col.frames', 'budget.col.pages', 'budget.col.bytes', 'budget.col.sizes', 'budget.col.state'].map(k => h('th', {scope: 'col'}, ctx.t(k))))), h('tbody', '', ...rows))));
}
