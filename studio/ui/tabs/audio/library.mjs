// The left column: filters and the list of cues with their stage, listening state and packs.
import { h, select } from './dom.mjs';
import { filterEntries, stages, listeningStates, kinds } from './model.mjs';

export function renderLibrary(app, el) {
  const {ctx, state} = app;
  const shown = filterEntries(app.entries, state);
  const search = h('input', {type: 'search', class: 'search', id: 'au-q', value: state.q, placeholder: ctx.t('library.search'), 'aria-label': ctx.t('library.search'), autocomplete: 'off'});
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => app.go({q: search.value.trim()}, {replace: true}), 250); });
  const any = ctx.t('library.any');
  const filters = h('div', 'au-filters',
    select(ctx.t('filter.kind'), state.kind ?? '', [['', any], ...kinds.map(k => [k, ctx.t('kind.' + k)])], v => app.go({kind: v || null})),
    select(ctx.t('filter.stage'), state.stage ?? '', [['', any], ...stages.map(k => [k, ctx.t('stage.' + k)])], v => app.go({stage: v || null})),
    select(ctx.t('filter.listening'), state.listening ?? '', [['', any], ...listeningStates.map(k => [k, ctx.t('listening.' + k)])], v => app.go({listening: v || null})),
    select(ctx.t('filter.pack'), state.pack ?? '', [['', any], ...app.packs.map(p => [p.id, p.id])], v => app.go({pack: v || null})),
    select(ctx.t('filter.family'), state.family ?? '', [['', any], ...app.families.map(f => [f, f])], v => app.go({family: v || null})));
  const list = h('ul', {class: 'au-list', role: 'list'}, ...shown.map(e => {
    const on = e.id === state.asset;
    const a = h('a', {class: 'au-row' + (on ? ' on' : '') + ' s-' + e.stage, href: ctx.href(app.route({}, {asset: e.id})), 'aria-current': on ? 'true' : false},
      h('span', 'au-row-id', e.id),
      h('span', 'au-row-badges', h('span', 'chip k-' + e.kind, ctx.t('kind.' + e.kind)), h('span', `chip s-${e.stage}`, ctx.t('stage.' + e.stage)),
        h('span', `chip l-${e.listening}`, ctx.t('listening.' + e.listening))));
    return h('li', '', a);
  }));
  el.replaceChildren(h('h2', 'sr-only', ctx.t('library.label')), search, filters,
    h('p', 'muted au-count', ctx.t('library.count', {shown: shown.length, total: app.entries.length})), list);
}
