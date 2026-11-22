// The left column: filters and the list of cues with their stage, listening state and packs.
import { h, select, put, chipClass } from './dom.mjs';
import { filterEntries, stages, listeningStates, kinds } from './model.mjs';

export function renderLibrary(app, el) {
  const {ctx, state} = app;
  const shown = filterEntries(app.entries, state);
  const search = h('input', {type: 'search', class: 'field', id: 'au-q', value: state.q, placeholder: ctx.t('library.search'), 'aria-label': ctx.t('library.search'), autocomplete: 'off'});
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => app.go({q: search.value.trim()}, {replace: true}), 250); });
  const any = ctx.t('library.any');
  const active = ['kind', 'stage', 'listening', 'pack', 'family'].filter(k => state[k]).length;
  const toggle = h('button', {type: 'button', class: 'btn au-filter-toggle', 'aria-expanded': app.filtersOpen ? 'true' : 'false', 'aria-controls': 'au-filters'}, ctx.t('library.filters'), active ? h('span', 'chip', String(active)) : null);
  toggle.addEventListener('click', () => { app.filtersOpen = !app.filtersOpen; renderLibrary(app, el); el.querySelector('.au-filter-toggle')?.focus(); });
  const filters = h('div', {class: 'au-filters' + (app.filtersOpen ? ' open' : ''), id: 'au-filters'},
    select(ctx.t('filter.kind'), state.kind ?? '', [['', any], ...kinds.map(k => [k, ctx.t('kind.' + k)])], v => app.go({kind: v || null})),
    select(ctx.t('filter.stage'), state.stage ?? '', [['', any], ...stages.map(k => [k, ctx.t('stage.' + k)])], v => app.go({stage: v || null})),
    select(ctx.t('filter.listening'), state.listening ?? '', [['', any], ...listeningStates.map(k => [k, ctx.t('listening.' + k)])], v => app.go({listening: v || null})),
    select(ctx.t('filter.pack'), state.pack ?? '', [['', any], ...app.packs.map(p => [p.id, p.id])], v => app.go({pack: v || null})),
    select(ctx.t('filter.family'), state.family ?? '', [['', any], ...app.families.map(f => [f, f])], v => app.go({family: v || null})));
  const list = h('ul', {class: 'au-list', role: 'list'}, ...shown.map(e => {
    const on = e.id === state.asset;
    const a = h('a', {class: 'au-row' + (on ? ' on' : '') + ' s-' + e.stage, href: ctx.href(app.route({}, {asset: e.id})), 'aria-current': on ? 'true' : false},
      h('span', {class: 'au-row-id', title: e.id}, e.id),
      h('span', 'au-row-badges', h('span', 'chip k-' + e.kind, ctx.t('kind.' + e.kind)), h('span', chipClass('stage', e.stage), ctx.t('stage.' + e.stage)),
        h('span', chipClass('listening', e.listening), ctx.t('listening.' + e.listening))));
    return h('li', '', a);
  }));
  const none = h('div', 'empty', h('p', 'empty-title', ctx.t('library.noneTitle')), h('p', 'empty-body', ctx.t('library.noneBody')),
    h('a', {class: 'btn', href: ctx.href(app.route({kind: null, stage: null, listening: null, pack: null, family: null, q: ''}))}, ctx.t('library.clear')));
  put(el, h('h2', 'sr-only', ctx.t('library.label')), search, toggle, filters,
    h('p', 'muted au-count', ctx.t('library.count', {shown: shown.length, total: app.entries.length})), shown.length ? list : none);
}
