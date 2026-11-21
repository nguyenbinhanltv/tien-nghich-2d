// Objects: everything that is not a character (tilesets, props, weapons and their projectiles, icons,
// UI sets, towers, facilities). Catalog from GET /api/studio/*; links and provenance from this tab's server.mjs.
import { h, humanize, button } from './dom.mjs';
import { parseRoute as parse, stateParams, objectKinds, inScope, tools } from './model.mjs';
import { renderFilters, renderGrid } from './browser.mjs';
import { renderDetail } from './detail.mjs';
import { renderTool } from './tools.mjs';

export function parseRoute(route) { return parse(route); }

let app;

function makeApp(ctx, state) {
  const details = new Map(), provenance = new Map();
  const key = a => a.source + '/' + a.id;
  const self = {
    ctx, state, assets: [], kinds: [], links: {}, byId: new Map(), frames: [], shown: [], token: 0, cleanups: [], editableMap: null, dup: new Set(),
    onCleanup(fn) { self.cleanups.push(fn); },
    runCleanups() { for (const fn of self.cleanups.splice(0)) fn(); },
    detail(a) { if (!details.has(key(a))) details.set(key(a), ctx.api('asset/' + encodeURIComponent(a.id) + '?source=' + encodeURIComponent(a.source)).catch(e => { details.delete(key(a)); throw e; })); return details.get(key(a)); },
    provenance(a) { if (!provenance.has(key(a))) provenance.set(key(a), ctx.tabApi('provenance?id=' + encodeURIComponent(a.id) + '&source=' + encodeURIComponent(a.source)).catch(e => { provenance.delete(key(a)); throw e; })); return provenance.get(key(a)); },
    async editable() {
      if (!self.editableMap) {
        try { self.editableMap = new Map((await ctx.fetchJson('/api/editor/frames')).frames.map(f => [f.processedUrl, f])); }
        catch (error) { if (error.name === 'AbortError') throw error; self.editableMap = new Map(); }
      }
      return self.editableMap;
    },
    selected() { return self.assets.find(a => a.id === self.state.asset && (!self.state.source || a.source === self.state.source)) ?? null; },
    /** A route for `patch` merged into the current state. `asset: entry|null` switches asset; `clip`/`frame` pick a frame. */
    route(patch = {}, opts = {}) {
      const next = {...self.state, ...patch};
      let asset = self.state.asset, clip = self.state.clip, frame = self.state.frame;
      if ('asset' in opts) {
        asset = opts.asset?.id ?? null; clip = null; frame = null;
        next.source = opts.asset && self.dup.has(opts.asset.id) ? opts.asset.source : null;
      }
      if ('clip' in opts) clip = opts.clip;
      if ('frame' in opts) frame = opts.frame;
      return {tab: 'objects', asset, clip: asset ? clip : null, frame: asset ? frame : null, params: stateParams(next)};
    },
    go(patch, opts = {}) { ctx.navigate(self.route(patch, opts), {replace: opts.replace}); }
  };
  return self;
}

function layout(ctx) {
  const search = h('input', {type: 'search', id: 'ob-q', class: 'search', placeholder: ctx.t('filter.search'), 'aria-label': ctx.t('filter.search'), autocomplete: 'off'});
  const filters = h('div', 'filters');
  const tabs = h('nav', {class: 'tooltabs', 'aria-label': ctx.t('tool.label')});
  const center = h('div', 'work');
  const aside = h('aside', {class: 'detail', 'aria-label': ctx.t('detail.label')});
  ctx.root.replaceChildren(
    h('header', 'ob-head', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle'))),
    h('div', 'ob', h('aside', {class: 'side', 'aria-label': ctx.t('filter.label')}, h('label', {class: 'sr-only', for: 'ob-q'}, ctx.t('filter.search')), search, filters),
      h('section', 'center', tabs, center), aside));
  return {search, filters, tabs, center, aside};
}

function renderTabs(app, el) {
  const {ctx, state} = app;
  const link = (tool, label) => h('a', {class: 'tooltab' + (state.tool === tool ? ' on' : ''), 'aria-current': state.tool === tool ? 'true' : null, href: ctx.href(app.route({tool}))}, label);
  el.replaceChildren(link(null, ctx.t('tool.grid')), ...tools.map(t => link(t, ctx.t('tool.' + t))),
    h('span', {class: 'newid', title: ctx.t('tool.newIdHint'), 'aria-disabled': 'true'}, ctx.t('tool.newId')));
}

async function paint(ui) {
  const token = ++app.token;
  app.runCleanups();
  if (ui.search.value !== app.state.q && document.activeElement !== ui.search) ui.search.value = app.state.q;
  renderFilters(app, ui.filters);
  renderTabs(app, ui.tabs);
  const scroll = ui.center.firstElementChild?.scrollTop ?? 0;
  if (app.state.tool) await renderTool(app, ui.center).catch(error => { if (error.name !== 'AbortError') ui.center.replaceChildren(h('p', {role: 'alert', class: 'pad'}, ctx.t('common.error', {message: error.message}))); });
  else { renderGrid(app, ui.center); ui.center.scrollTop = scroll; }
  await renderDetail(app, ui.aside, token);
  ui.aside.toggleAttribute('hidden', false);
}

export async function mount(ctx, state) {
  ctx.loadCss(new URL('./objects.css', import.meta.url));
  const mine = app = makeApp(ctx, state);
  ctx.onUnmount(() => mine.runCleanups());
  const ui = layout(ctx);
  app.ui = ui;
  ctx.root.setAttribute('aria-busy', 'true');
  try {
    const [list, links] = await Promise.all([ctx.api('assets?limit=1000'), ctx.tabApi('links').catch(() => ({links: {}}))]);
    app.kinds = objectKinds(ctx.project.categoryTabs);
    app.assets = inScope(list.assets, app.kinds);
    app.byId = new Map(app.assets.map(a => [a.id, a]));
    const seen = new Set();
    for (const a of app.assets) { if (seen.has(a.id)) app.dup.add(a.id); seen.add(a.id); }
    // links may mention ids that live in other tabs (character-free by design); keep what this tab can show
    app.links = links.links;
  } catch (error) {
    if (error.name === 'AbortError') return;
    ctx.root.removeAttribute('aria-busy');
    ctx.root.replaceChildren(h('p', {role: 'alert'}, ctx.t('common.error', {message: error.message})), button(ctx.t('common.retry'), () => mount(ctx, state)));
    return;
  }
  let timer;
  ui.search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => app.go({q: ui.search.value}, {replace: true}), 250); });
  ctx.onUnmount(() => clearTimeout(timer));
  ui.search.value = state.q;
  ctx.root.removeAttribute('aria-busy');
  await paint(ui);
}

export async function update(ctx, state) {
  app.state = state;
  await paint(app.ui);
}

export async function unmount() { app?.runCleanups(); }
