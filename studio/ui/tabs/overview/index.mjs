// Overview ("the abode"): a hero with the project's greeting, three "today" cards, the totals, the pipeline by readiness,
// recent agent activity, the characters, atlas budget per chunk and wave progress.
// Totals, pipeline, chunks and waves come from GET /api/studio/overview; nothing here is hard-coded. The cards, the activity
// and the characters read other tabs' read-only routes (today.mjs), each on its own.
//
// The frame (hero, slots, importer) is built once per mount and each slot is redrawn on its own through fill(), which keeps
// keyboard focus; a refresh therefore never closes or resets anything the person is using.

import { h, fill } from './dom.mjs';
import { renderPlanImport } from './plan-import.mjs';
import { createHero } from './scene.mjs';
import { stat, section, readinessTable, chunkCards, waves, num } from './panels.mjs';
import { SOURCES, todayCards, failedSources, activityList, castRow } from './today.mjs';

const apps = new WeakMap();
const NAV = {review: 'nav.review', jobs: 'nav.jobs', roster: 'nav.characters'};

function buildFrame(ctx, app) {
  const hero = createHero(ctx, () => load(ctx, app, {manual: true}));
  const slot = (cls, attrs) => h('div', {class: cls, ...attrs});
  const slots = {
    notice: slot('ov-notice'),
    today: slot('today', {role: 'group'}),
    stats: slot('stats'),
    error: slot('ov-error'),
    pipeline: slot('ov-body'), activity: slot('ov-body'), cast: slot('ov-body'), chunks: slot('ov-body'), waves: slot('ov-body'),
    activityHead: slot('ov-aside')
  };
  const w = hero.words;
  app.slots = slots;
  app.hero = hero;
  app.data = null;
  app.extra = {review: {status: 'loading'}, jobs: {status: 'loading'}, roster: {status: 'loading'}};
  app.importer = renderPlanImport(ctx, () => load(ctx, app));
  const data = h('div', 'ov-data', slots.stats,
    section('ov-pipeline', w.pipeline, ctx.t('readiness.intro'), null, slots.pipeline),
    h('div', 'ov-pair',
      section('ov-activity', ctx.t('activity.title'), ctx.t('activity.intro'), slots.activityHead, slots.activity),
      section('ov-cast', ctx.t('cast.title'), ctx.t('cast.intro'), null, slots.cast)),
    section('ov-chunks', ctx.t('chunks.title'), ctx.t('chunks.intro'), null, slots.chunks),
    section('ov-waves', ctx.t('waves.title'), ctx.t('waves.intro'), null, slots.waves));
  app.dataEl = data;
  slots.today.setAttribute('aria-label', ctx.t('today.title'));
  ctx.root.replaceChildren(hero.el, slots.notice, slots.today, slots.error, data, app.importer);
  // before the first answer: skeletons where numbers will appear
  fill(slots.stats, ...[0, 1, 2, 3].map(() => h('div', {class: 'stat', role: 'status'}, h('span', 'skeleton line'), h('span', 'skeleton line'))));
  for (const key of ['pipeline', 'chunks', 'waves']) fill(slots[key], h('div', {role: 'status'}, h('span', 'sr-only', ctx.t('common.loading')), h('span', 'skeleton block')));
  paintExtras(ctx, app);
}

function paintToday(ctx, app) {
  fill(app.slots.today, ...todayCards(ctx, app));
  const failed = failedSources(app)?.filter(key => key !== 'roster');
  fill(app.slots.notice, failed && h('div', {class: 'toast warn', role: 'status'}, h('span', '', ctx.t('notice.failed', {what: failed.map(key => ctx.t(NAV[key])).join(', ')})),
    h('button', {type: 'button', class: 'btn', 'data-fk': 'notice-retry', onclick: () => failed.forEach(key => loadExtra(ctx, app, key))}, ctx.t('common.retry'))));
}

function paintActivity(ctx, app) {
  const {open, body} = activityList(ctx, app.extra.jobs, () => loadExtra(ctx, app, 'jobs'));
  fill(app.slots.activityHead, open);
  fill(app.slots.activity, body);
}

function paintCast(ctx, app) { fill(app.slots.cast, castRow(ctx, app.extra.roster, () => loadExtra(ctx, app, 'roster'))); }

function paintExtras(ctx, app) { paintToday(ctx, app); paintActivity(ctx, app); paintCast(ctx, app); }

function paintData(ctx, app) {
  const data = app.data, o = data.overall;
  const packedPct = o.total ? Math.round(o.packed / o.total * 100) : 0;
  app.dataEl.hidden = false;
  fill(app.slots.error);
  fill(app.slots.stats,
    stat(ctx, 'stat.total', num.format(o.total), ctx.t('stat.totalNote', {sources: Object.keys(data.bySource).length})),
    stat(ctx, 'stat.packed', num.format(o.packed), packedPct + '%', 'ok'),
    stat(ctx, 'stat.authored', num.format(o.authored), ctx.t('stat.authoredNote')),
    stat(ctx, 'stat.planned', num.format(o.planned), ctx.t('stat.plannedNote')));
  fill(app.slots.pipeline, readinessTable(ctx, data));
  fill(app.slots.chunks, data.chunks.length ? chunkCards(ctx, data.chunks) : h('p', 'empty', ctx.t('chunks.none')));
  fill(app.slots.waves, waves(ctx, data));
  paintToday(ctx, app);
}

function paintFailure(ctx, app, error) {
  const retry = h('button', {type: 'button', class: 'btn primary', 'data-fk': 'retry', onclick: () => load(ctx, app, {manual: true})}, ctx.t('common.retry'));
  if (!app.data) app.dataEl.hidden = true;
  fill(app.slots.error, h('div', {class: 'empty', role: 'alert'}, h('p', 'empty-title', ctx.t('error.title')), h('p', 'empty-body', ctx.t('common.error', {message: error.message})), retry));
}

async function loadExtra(ctx, app, key) {
  if (app.extra[key].status === 'error') { app.extra[key] = {status: 'loading'}; paintExtras(ctx, app); }
  try { app.extra[key] = {status: 'ok', value: SOURCES[key].pick(await ctx.fetchJson(SOURCES[key].url))}; }
  catch (error) {
    if (error.name === 'AbortError' || app.dead) return;
    app.extra[key] = {status: 'error', error: error.message};
  }
  if (!app.dead) paintExtras(ctx, app);
}

async function load(ctx, app, {manual = false} = {}) {
  const mine = ++app.token;
  ctx.root.setAttribute('aria-busy', 'true');
  const extras = Promise.all(Object.keys(SOURCES).map(key => loadExtra(ctx, app, key)));
  try {
    const data = await ctx.api('overview');
    if (mine !== app.token || app.dead) return;
    app.data = data;
    paintData(ctx, app);
    if (manual) { await extras; ctx.announce(ctx.t('refreshed')); }
  } catch (error) {
    if (error.name === 'AbortError' || mine !== app.token || app.dead) return;
    paintFailure(ctx, app, error);
  } finally { if (mine === app.token) ctx.root.removeAttribute('aria-busy'); }
}

/** Overview has no asset-level state: any URL parameters are ignored. */
export function parseRoute() { return {}; }

export async function mount(ctx) {
  ctx.root.classList.add('ui-kit');
  ctx.loadCss(new URL('../../components.css', import.meta.url));
  ctx.loadCss(new URL('./overview.css', import.meta.url));
  const app = {token: 0, dead: false};
  apps.set(ctx, app);
  buildFrame(ctx, app);
  await load(ctx, app);
}

export function unmount(ctx) { const app = apps.get(ctx); if (app) app.dead = true; }
