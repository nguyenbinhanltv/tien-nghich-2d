// Audio: the library of beds and effects, audition (master, Ogg, AAC; loop across the seam; solo or over a bed; mono; blind A/B),
// the pictures and numbers, the sprite map of a pack, the listening checklist and sign-off, and patch/score viewing with a
// scratch preview. The page never listens for anyone: sign-off is a human action in this UI, recorded by the Review tab's route.
import { h, button, humanize, put } from './dom.mjs';
import { parseRoute as parse, stateParams, views, listeningOf, listeningFromInbox, filterEntries } from './model.mjs';
import { createEngine } from './engine.mjs';
import { renderLibrary } from './library.mjs';
import { renderListen } from './listen.mjs';
import { renderPictures } from './pictures.mjs';
import { renderSprite } from './sprite.mjs';
import { renderPatch } from './patch.mjs';
import { renderSide } from './side.mjs';

export function parseRoute(route) { return parse(route); }

let app;

function makeApp(ctx, state) {
  const details = new Map(), measures = new Map();
  const self = {
    ctx, state, entries: [], byId: new Map(), families: [], packs: [], review: {available: false, items: new Map()}, token: 0,
    engine: createEngine({onChange: () => self.onEngine?.()}),
    cleanups: [], checklist: {},
    onCleanup(fn) { self.cleanups.push(fn); },
    runCleanups() { for (const fn of self.cleanups.splice(0)) fn(); },
    cue(id) { if (!details.has(id)) details.set(id, ctx.tabApi('cue?id=' + encodeURIComponent(id)).catch(e => { details.delete(id); throw e; })); return details.get(id); },
    measure(id) { if (!measures.has(id)) measures.set(id, ctx.tabApi('measure?id=' + encodeURIComponent(id)).catch(e => { measures.delete(id); throw e; })); return measures.get(id); },
    selected() { return self.byId.get(self.state.asset) ?? null; },
    route(patch = {}, opts = {}) {
      const next = {...self.state, ...patch};
      const asset = 'asset' in opts ? opts.asset : self.state.asset;
      if ('asset' in opts) { next.pack = null; next.ab = null; next.codec = null; next.bed = null; if (!(patch.view)) next.view = null; }
      return {tab: 'audio', asset, clip: null, direction: null, frame: null, params: stateParams(next)};
    },
    go(patch, opts = {}) { ctx.navigate(self.route(patch, opts), {replace: opts.replace}); },
    mergeListening() {
      for (const e of self.entries) {
        const item = self.review.items.get(e.id);
        e.signoff = item?.signoff ?? null;
        const own = listeningOf({stage: e.stage, signoff: null, masterSha: e.masterSha, evidence: e.evidenceListening});
        e.listening = e.stage === 'planned' ? own : listeningFromInbox(item, own);
      }
    },
    async refreshReview() {
      try {
        const inbox = await ctx.fetchJson('/api/tabs/review/inbox');
        self.review = {available: true, items: new Map((inbox.audio ?? []).map(a => [a.id, a]))};
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        self.review = {available: false, items: new Map()};
      }
      self.mergeListening();
    }
  };
  return self;
}

function layout(ctx) {
  const side = h('aside', {class: 'au-lib', 'aria-label': ctx.t('library.label')});
  const center = h('section', 'au-center');
  const right = h('aside', {class: 'au-side', 'aria-label': ctx.t('side.label')});
  put(ctx.root, 
    h('header', 'au-head', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle')),
      h('p', {class: 'au-notice', role: 'note'}, ctx.t('notice'))),
    h('div', 'au', side, center, right));
  return {side, center, right};
}

function renderViewTabs(app, el) {
  const {ctx, state} = app;
  put(el, ...views.map(v => {
    const a = h('a', {class: 'au-tab' + (state.view === v ? ' on' : ''), href: ctx.href(app.route({view: v}))}, ctx.t('view.' + v));
    if (state.view === v) a.setAttribute('aria-current', 'page');
    return a;
  }));
}

function chip(ctx, kind, value) { return h('span', `chip ${kind[0]}-${value}`, ctx.t(`${kind}.${value}`)); }

async function renderCenter(app, el) {
  const {ctx, state} = app, token = ++app.token;
  const entry = app.selected();
  if (!entry) {
    put(el, h('div', 'au-empty', h('h2', '', ctx.t('empty.title')), h('p', 'muted', ctx.t('empty.body')), renderSummary(app)));
    return;
  }
  const tabs = h('nav', {class: 'au-tabs', 'aria-label': ctx.t('view.label')});
  const body = h('div', {class: 'au-body', 'aria-live': 'polite'});
  const head = h('div', 'au-cue',
    h('div', 'au-cue-id', h('h2', '', entry.id), h('span', 'chip k-' + entry.kind, ctx.t('kind.' + entry.kind)), chip(ctx, 'stage', entry.stage), chip(ctx, 'listening', entry.listening)),
    h('p', 'muted au-cue-meta', [entry.category, entry.group].filter(Boolean).map(humanize).join(' · '),
      entry.packs.length ? ' · ' + ctx.t('cue.packs', {packs: entry.packs.join(', ')}) : ' · ' + ctx.t('cue.unpacked')),
    h('div', 'chips', ...entry.families.map(f => h('a', {class: 'chip fam', href: ctx.href(app.route({family: f.family}, {asset: null}))}, `${f.family} · ${f.role}`)),
      ...entry.modes.map(m => h('span', 'chip mode', `${m.mode} · ${m.event}`))));
  put(el, head, tabs, body);
  renderViewTabs(app, tabs);
  if (entry.stage === 'planned') { put(body, h('p', 'au-empty muted', ctx.t('cue.planned'))); return; }
  let detail;
  try { detail = await app.cue(entry.id); } catch (error) { if (error.name === 'AbortError') return; put(body, h('p', 'au-error', ctx.t('error.load', {message: error.message}))); return; }
  if (token !== app.token) return;
  app.detail = detail;
  const render = {listen: renderListen, pictures: renderPictures, sprite: renderSprite, patch: renderPatch}[state.view];
  await render(app, body, detail, entry, () => token === app.token);
}

function renderSummary(app) {
  const {ctx} = app, count = (f) => app.entries.filter(f).length;
  const row = (label, n) => h('tr', '', h('th', {scope: 'row'}, label), h('td', '', String(n)));
  return h('table', 'au-summary', h('caption', 'sr-only', ctx.t('summary.caption')),
    row(ctx.t('summary.beds'), count(e => e.kind === 'bed')), row(ctx.t('summary.effects'), count(e => e.kind === 'effect')),
    row(ctx.t('summary.packed'), count(e => e.stage === 'packed')), row(ctx.t('summary.masterOnly'), count(e => e.stage === 'master')),
    row(ctx.t('summary.planned'), count(e => e.stage === 'planned')), row(ctx.t('summary.approved'), count(e => e.listening === 'approved')),
    row(ctx.t('summary.pending'), count(e => e.listening === 'pending')));
}

function renderAll(app) {
  const parts = app.parts;
  renderLibrary(app, parts.side);
  renderCenter(app, parts.center);
  renderSide(app, parts.right);
}

export async function mount(ctx, state) {
  ctx.loadCss(new URL('./audio.css', import.meta.url));
  app = makeApp(ctx, state);
  app.parts = layout(ctx);
  ctx.onUnmount(() => { app?.engine.dispose(); app?.runCleanups(); });
  try {
    const [library] = await Promise.all([ctx.tabApi('library'), app.refreshReview()]);
    app.entries = library.entries; app.families = library.families; app.packs = library.packs;
    app.byId = new Map(app.entries.map(e => [e.id, e]));
    app.mergeListening();
  } catch (error) {
    if (error.name === 'AbortError') return;
    put(app.parts.center, h('p', 'au-error', ctx.t('error.load', {message: error.message}), ' ', button(ctx.t('retry'), () => ctx.navigate(app.route(), {replace: true}))));
    return;
  }
  app.onEngine = () => app.parts && renderSide(app, app.parts.right, {keepForm: true});
  renderAll(app);
}

export async function update(ctx, state) {
  if (!app) return mount(ctx, state);
  const changedAsset = state.asset !== app.state.asset, changedView = state.view !== app.state.view;
  app.state = state;
  if (changedAsset) { app.engine.stopAll(); app.runCleanups(); app.detail = null; }
  else if (changedView) app.runCleanups();
  renderAll(app);
}

export async function unmount() { app?.engine.dispose(); app?.runCleanups(); app = null; }

export { filterEntries };
