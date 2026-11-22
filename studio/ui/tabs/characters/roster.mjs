import { h, humanize, badge, notice, skeleton } from './dom.mjs';
import { filterRoster, sortRoster } from './state.mjs';

/** Left column: filters and the list of characters, each a real link so keyboard and middle-click work. */
export function renderRoster(app) {
  const {ctx, roster, state} = app;
  const root = app.els.roster;
  const title = h('h2', {}, ctx.t('roster.title'));
  if (!roster) {
    root.replaceChildren(title, app.rosterError
      ? notice(ctx, {title: ctx.t('roster.errorTitle'), body: ctx.t('common.error', {message: app.rosterError}), retry: () => app.loadRoster(), alert: true})
      : h('div', {role: 'status'}, h('span', 'sr-only', ctx.t('common.loading')), skeleton(6)));
    return;
  }
  const searching = document.activeElement?.matches?.('.roster .search');
  const filter = state.filter;
  const set = patch => app.navigate({filter: {...filter, ...patch}}, {replace: true});
  const counts = roster.counts;
  const chip = (value, label, count) => h('button', {type: 'button', class: 'chip', 'aria-pressed': String(filter.category === value),
    onclick: () => set({category: value})}, label, h('b', 'count', String(count)));
  const search = h('input', {type: 'search', value: filter.q, class: 'field search', 'aria-label': ctx.t('roster.search'), placeholder: ctx.t('roster.search'),
    oninput: event => { clearTimeout(app.searchTimer); app.searchTimer = setTimeout(() => set({q: event.target.value}), 200); }});
  const ready = h('select', {class: 'field', 'aria-label': ctx.t('roster.readiness'), onchange: event => set({readiness: event.target.value})},
    ...['', 'packed', 'authored', 'planned'].map(value => h('option', {value, selected: filter.readiness === value},
      value ? ctx.t('stage.' + value) + ' (' + (counts.byReadiness[value] ?? 0) + ')' : ctx.t('roster.allReadiness'))));
  const active = (filter.category ? 1 : 0) + (filter.readiness ? 1 : 0);
  const toggle = h('button', {type: 'button', class: 'btn filters-toggle', 'aria-expanded': String(Boolean(app.filtersOpen)), 'aria-controls': 'roster-filters',
    onclick: () => { app.filtersOpen = !app.filtersOpen; renderRoster(app); }}, ctx.t('roster.filters'), active ? h('span', 'chip', String(active)) : null);
  const shown = sortRoster(filterRoster(roster.characters, {category: filter.category, readiness: filter.readiness, q: filter.q}), roster.categories);
  const list = h('ul', {class: 'roster-list', 'aria-label': ctx.t('roster.title')}, ...shown.map(c => {
    const selected = c.id === state.id, name = c.name ?? humanize(c.id);
    const link = h('a', {href: ctx.href({tab: 'characters', asset: c.id, params: {...(c.source !== 'core' && roster.characters.filter(x => x.id === c.id).length > 1 ? {source: c.source} : {}),
      ...(filter.category ? {cat: filter.category} : {}), ...(filter.readiness ? {ready: filter.readiness} : {}), ...(filter.q ? {q: filter.q} : {})}}),
      class: 'roster-item readiness-' + c.readiness, 'aria-current': selected ? 'true' : false, 'data-id': c.id},
    h('span', 'thumb', c.thumb ? h('img', {src: '/' + c.thumb, alt: '', loading: 'lazy', width: 32, height: 32}) : h('span', {class: 'thumb-empty', 'aria-hidden': 'true'}, '？')),
    h('span', 'who', h('strong', {title: name}, name), h('code', {title: c.id}, c.id),
      h('span', 'line', badge('readiness', c.readiness, ctx.t('stage.' + c.readiness)),
        h('small', {title: humanize(c.category) + (c.chunk ? ' · ' + humanize(c.chunk) : '')}, humanize(c.category) + (c.chunk ? ' · ' + humanize(c.chunk) : '')))));
    return h('li', {}, link);
  }));
  root.dataset.filters = app.filtersOpen ? 'open' : 'closed';
  root.replaceChildren(title,
    h('div', 'find', search, toggle),
    h('div', {class: 'filters-body', id: 'roster-filters'}, h('div', 'chips', chip('', ctx.t('roster.all'), counts.total), ...roster.categories.map(c => chip(c, humanize(c), counts.byCategory[c] ?? 0))), ready),
    h('p', {class: 'muted small', role: 'status'}, ctx.t('roster.shown', {shown: shown.length, total: counts.total})),
    shown.length ? list : notice(ctx, {body: ctx.t('roster.none')}));
  if (searching) { const box = root.querySelector('.search'); box.focus(); box.setSelectionRange?.(box.value.length, box.value.length); }
  list.querySelector('[aria-current]')?.scrollIntoView({block: 'nearest'});
}
