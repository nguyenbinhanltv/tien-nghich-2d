// Left column: filters and the list of every effect with readiness, chunk, native size, frame count, duration, variants.
import { h, imgUrl } from './dom.mjs';
import { applyFilters, fmtMs } from './model.mjs';

export function renderBrowser(app, el) {
  const {ctx, state, cards} = app;
  const shown = applyFilters(cards, state);
  const link = (patch, label, on) => h('a', {class: 'vx-facet' + (on ? ' on' : ''), href: ctx.href(app.route(patch)), 'aria-current': on ? 'true' : null}, label);
  const ready = ['packed', 'authored', 'planned'].filter(r => cards.some(c => c.readiness === r));
  const groups = [...new Set(cards.map(c => c.group))];
  const list = h('ul', {class: 'vx-list', 'aria-label': ctx.t('list.label')}, ...shown.map(c => {
    const on = state.asset === c.id;
    const meta = [ctx.t('ready.' + c.readiness), c.chunk, `${c.size[0]}×${c.size[1]}`, ctx.t('list.frames', {count: c.frames}), fmtMs(c.totalMs)].filter(Boolean).join(' · ');
    return h('li', '', h('a', {class: 'vx-row' + (on ? ' on' : '') + ' state-' + c.readiness, href: ctx.href(app.route({}, {asset: c.id})), 'aria-current': on ? 'true' : null},
      h('span', 'vx-thumb', c.first ? h('img', {src: imgUrl(c.first), alt: '', loading: 'lazy', width: c.size[0], height: c.size[1]}) : h('span', 'muted', '–')),
      h('span', 'vx-rowtext', h('span', 'vx-rowid', c.id), h('span', 'vx-rowmeta', meta),
        c.variants.length > 1 && h('span', 'vx-rowmeta', ctx.t('list.variants', {count: c.variants.length, names: c.variants.join(' · ')})),
        c.loop && h('span', 'vx-rowmeta', ctx.t('kind.loop')))));
  }));
  el.replaceChildren(
    h('div', 'vx-fgroup', h('h2', '', ctx.t('filter.readiness')), h('nav', {'aria-label': ctx.t('filter.readiness')}, link({ready: null}, ctx.t('filter.any'), !state.ready), ...ready.map(r => link({ready: r}, `${ctx.t('ready.' + r)} (${cards.filter(c => c.readiness === r).length})`, state.ready === r)))),
    h('div', 'vx-fgroup', h('h2', '', ctx.t('filter.group')), h('nav', {'aria-label': ctx.t('filter.group')}, link({grp: null}, ctx.t('filter.any'), !state.grp), ...groups.map(g => link({grp: g}, `${ctx.t('group.' + g)} (${cards.filter(c => c.group === g).length})`, state.grp === g)))),
    h('p', 'vx-note', ctx.t('list.count', {shown: shown.length, total: cards.length})),
    shown.length ? list : h('p', 'muted', ctx.t('list.empty')));
}
