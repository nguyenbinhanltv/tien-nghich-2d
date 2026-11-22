// "Today": the three cards that say what needs a person, what agents are doing and how full the atlases are; the recent
// agent activity; the row of characters. The cards and lists read other tabs' read-only routes, each on its own, so one
// that is slow or down shows "–" and a retry without blocking the numbers that came from the overview.
import { h } from './dom.mjs';
import { num } from './panels.mjs';

/** Read-only routes of the other tabs, and the part of each answer the Overview keeps. */
export const SOURCES = {
  review: {url: '/api/tabs/review/inbox', pick: d => ({
    waiting: (d.items ?? []).filter(i => i.state === 'waiting').length + (d.audio ?? []).filter(a => a.state === 'waiting').length})},
  jobs: {url: '/api/tabs/jobs/feed?since=0', pick: d => {
    const items = d.jobs?.items ?? [];
    return {available: Boolean(d.jobs?.available), active: items.filter(j => j.status === 'queued' || j.status === 'running').length,
      failed: items.filter(j => j.status === 'failed').length, events: (d.activity?.events ?? []).slice(-8).reverse()};
  }},
  roster: {url: '/api/tabs/characters/roster', pick: d => ({characters: d.characters ?? [], total: d.counts?.total ?? (d.characters ?? []).length})}
};

const CAST_LIMIT = 24;

function card(ctx, {key, tab, label, value, hint, tone, attention}) {
  return h('a', {class: 'slip today-card' + (tone ? ' ' + tone : ''), href: ctx.href({tab, params: {}}), 'data-fk': 'today-' + key, title: ctx.t('today.open', {tab: ctx.t('nav.' + tab)})},
    h('span', 'today-label', label), attention ? h('span', 'seal-badge', ctx.t('today.attention')) : null,
    h('span', 'today-value', value), h('span', 'today-hint', hint));
}

const pending = ctx => h('span', {class: 'skeleton line', role: 'status'}, h('span', 'sr-only', ctx.t('common.loading')));
const dash = () => h('span', {}, '–');

export function todayCards(ctx, app) {
  const {review, jobs} = app.extra;
  const unread = ctx.t('today.unavailable');
  const risk = app.data ? app.data.chunks.filter(c => c.state === 'full' || c.state === 'over').length : null;
  const atlas = {key: 'atlas', tab: 'atlas', label: ctx.t('today.atlas'), tone: risk ? 'danger' : '',
    value: risk == null ? pending(ctx) : String(risk), hint: risk == null ? '' : app.data.chunks.length ? ctx.t('today.atlasHint', {chunks: app.data.chunks.length}) : ctx.t('chunks.none')};
  const waiting = review.status === 'ok' ? review.value.waiting : null;
  const rev = {key: 'review', tab: 'review', label: ctx.t('today.review'), attention: waiting > 0, tone: waiting > 0 ? 'attention' : '',
    value: review.status === 'loading' ? pending(ctx) : waiting == null ? dash() : num.format(waiting),
    hint: review.status === 'loading' ? '' : waiting == null ? unread : ctx.t(waiting ? 'today.reviewHint' : 'today.reviewClear')};
  const job = jobs.status === 'ok' && jobs.value.available ? jobs.value : null;
  const agents = {key: 'jobs', tab: 'jobs', label: ctx.t('today.agents'), tone: job?.active ? 'busy' : '',
    value: jobs.status === 'loading' ? pending(ctx) : job ? num.format(job.active) : dash(),
    hint: jobs.status === 'loading' ? '' : !job ? unread : [ctx.t(job.active ? 'today.agentsHint' : 'today.agentsIdle'), job.failed ? ctx.t('today.agentsFailed', {n: job.failed}) : ''].filter(Boolean).join(' · ')};
  return [card(ctx, rev), card(ctx, agents), card(ctx, atlas)];
}

/** Names the sources that failed, or null. */
export function failedSources(app) {
  const names = Object.entries(app.extra).filter(([, s]) => s.status === 'error').map(([key]) => key);
  return names.length ? names : null;
}

const timeFormat = lang => new Intl.DateTimeFormat(lang, {hour: '2-digit', minute: '2-digit', hour12: false});

export function activityList(ctx, state, retry) {
  const open = h('a', {class: 'btn quiet', href: ctx.href({tab: 'jobs', params: {}}), 'data-fk': 'activity-open'}, ctx.t('activity.open'));
  let body;
  if (state.status === 'loading') body = h('div', {role: 'status'}, h('span', 'sr-only', ctx.t('common.loading')), h('span', 'skeleton line'), h('span', 'skeleton line'), h('span', 'skeleton line'));
  else if (state.status === 'error' || !state.value.available && !state.value.events.length) {
    const why = state.status === 'error' ? ctx.t('common.error', {message: state.error}) : ctx.t('activity.unavailable');
    body = h('div', 'empty', h('p', 'empty-body', why), h('button', {type: 'button', class: 'btn', 'data-fk': 'activity-retry', onclick: retry}, ctx.t('common.retry')));
  } else if (!state.value.events.length) body = h('div', 'empty', h('p', 'empty-body', ctx.t('activity.none')));
  else {
    const clock = timeFormat(ctx.lang);
    body = h('ul', {class: 'feed', 'aria-label': ctx.t('activity.title')}, ...state.value.events.map(e => {
      const at = new Date(typeof e.ts === 'number' ? e.ts : Date.parse(e.ts));
      return h('li', 'feed-row',
        h('time', {class: 'feed-time', datetime: Number.isNaN(at.getTime()) ? null : at.toISOString()}, Number.isNaN(at.getTime()) ? '–' : clock.format(at)),
        h('span', {class: 'feed-agent', title: e.agent}, e.agent || ctx.t('activity.anon')),
        h('code', {class: 'feed-tool', title: e.tool}, e.tool),
        h('span', 'chip ' + (e.ok === false ? 'danger' : 'ok'), ctx.t(e.ok === false ? 'activity.failed' : 'activity.ok')));
    }));
  }
  return {open, body};
}

export function castRow(ctx, state, retry) {
  if (state.status === 'loading') return h('div', {role: 'status'}, h('span', 'sr-only', ctx.t('common.loading')), h('span', 'skeleton block cast-skeleton'));
  if (state.status === 'error') return h('div', 'empty', h('p', 'empty-body', ctx.t('common.error', {message: state.error})), h('button', {type: 'button', class: 'btn', 'data-fk': 'cast-retry', onclick: retry}, ctx.t('common.retry')));
  const {characters, total} = state.value;
  if (!characters.length) return h('div', 'empty', h('p', 'empty-body', ctx.t('cast.none')));
  const tone = {packed: 'ok', authored: 'warn', planned: ''};
  const items = characters.slice(0, CAST_LIMIT).map(c => h('li', '', h('a', {class: 'cast-item', href: ctx.href({tab: 'characters', asset: c.id}), 'data-fk': 'cast-' + c.id, title: `${c.name ?? c.id} · ${ctx.t('stage.' + c.readiness)}`},
    h('span', 'cast-thumb', c.thumb ? h('img', {src: '/' + c.thumb, alt: '', loading: 'lazy', width: 32, height: 32}) : h('span', {'aria-hidden': 'true'}, '·')),
    h('span', 'cast-id', c.id), h('span', 'chip ' + (tone[c.readiness] ?? ''), ctx.t('stage.' + c.readiness)))));
  if (total > CAST_LIMIT) items.push(h('li', '', h('a', {class: 'cast-item cast-more', href: ctx.href({tab: 'characters', params: {}}), 'data-fk': 'cast-more'}, ctx.t('cast.more', {n: total - CAST_LIMIT}))));
  return h('ul', {class: 'cast', 'aria-label': ctx.t('cast.title')}, ...items);
}
