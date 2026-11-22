import { h, humanize } from './dom.mjs';
import { filterRoster, sortRoster } from './state.mjs';

/** Left column: filters and the list of characters, each a real link so keyboard and middle-click work. */
export function renderRoster(app) {
  const {ctx, roster, state} = app;
  const root = app.els.roster;
  if (!roster) { root.replaceChildren(h('p', 'muted', ctx.t('common.loading'))); return; }
  const filter = state.filter;
  const set = patch => app.navigate({filter: {...filter, ...patch}}, {replace: true});
  const counts = roster.counts;
  const chip = (value, label, count) => h('button', {type: 'button', class: 'chip-btn', 'aria-pressed': String(filter.category === value),
    onclick: () => set({category: value})}, label, h('span', 'count', String(count)));
  const search = h('input', {type: 'search', value: filter.q, class: 'search', 'aria-label': ctx.t('roster.search'), placeholder: ctx.t('roster.search'),
    oninput: event => { clearTimeout(app.searchTimer); app.searchTimer = setTimeout(() => set({q: event.target.value}), 200); }});
  const ready = h('select', {'aria-label': ctx.t('roster.readiness'), onchange: event => set({readiness: event.target.value})},
    ...['', 'packed', 'authored', 'planned'].map(value => h('option', {value, selected: filter.readiness === value},
      value ? ctx.t('stage.' + value) + ' (' + (counts.byReadiness[value] ?? 0) + ')' : ctx.t('roster.allReadiness'))));
  const shown = sortRoster(filterRoster(roster.characters, {category: filter.category, readiness: filter.readiness, q: filter.q}), roster.categories);
  const list = h('ul', {class: 'roster-list', 'aria-label': ctx.t('roster.title')}, ...shown.map(c => {
    const selected = c.id === state.id;
    const link = h('a', {href: ctx.href({tab: 'characters', asset: c.id, params: {...(c.source !== 'core' && roster.characters.filter(x => x.id === c.id).length > 1 ? {source: c.source} : {}),
      ...(filter.category ? {cat: filter.category} : {}), ...(filter.readiness ? {ready: filter.readiness} : {}), ...(filter.q ? {q: filter.q} : {})}}),
      class: 'roster-item readiness-' + c.readiness, 'aria-current': selected ? 'true' : false, 'data-id': c.id},
    h('span', 'thumb', c.thumb ? h('img', {src: '/' + c.thumb, alt: '', loading: 'lazy', width: 32, height: 32}) : h('span', {class: 'thumb-empty', 'aria-hidden': 'true'}, '？')),
    h('span', 'who', h('strong', {}, c.name ?? humanize(c.id)), h('code', {}, c.id), h('small', {}, humanize(c.category) + (c.chunk ? ' · ' + humanize(c.chunk) : '')),
      h('span', {class: 'badge readiness-' + c.readiness}, ctx.t('stage.' + c.readiness))));
    return h('li', {}, link);
  }));
  root.replaceChildren(h('h2', {}, ctx.t('roster.title')),
    h('div', 'chips', chip('', ctx.t('roster.all'), counts.total), ...roster.categories.map(c => chip(c, humanize(c), counts.byCategory[c] ?? 0))),
    h('div', 'filters', search, ready),
    h('p', {class: 'muted small', role: 'status'}, ctx.t('roster.shown', {shown: shown.length, total: counts.total})),
    shown.length ? list : h('p', 'muted', ctx.t('roster.none')));
  list.querySelector('[aria-current]')?.scrollIntoView({block: 'nearest'});
}
