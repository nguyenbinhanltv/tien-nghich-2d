// Atlas & Provenance: the shipped atlas pages, the chunk budget, packing into staging with a byte comparison against the shipped atlas,
// engine exports, and the licence and provenance ledger with the AI disclosure. Everything it writes goes to staging directories;
// the shipped atlases are never touched, and no action here approves, signs or publishes anything.
import { h, fill } from './dom.mjs';
import { badge, failure, stateBadge } from './common.mjs';
import { VIEWS, parseRoute as parse, stateParams } from './model.mjs';
import { renderViewer } from './viewer.mjs';
import { renderBudget } from './budget.mjs';
import { renderPack } from './pack.mjs';
import { renderExports } from './exports.mjs';
import { renderLedger } from './ledger.mjs';

export function parseRoute(route) { return parse(route); }

let app;

const RENDERERS = {atlas: renderViewer, budget: renderBudget, pack: renderPack, export: renderExports, ledger: renderLedger};

/** What the URL points at, with sensible fallbacks: the set, the chunk (the first with shipped pages) and the profile. */
function selection(app) {
  const {state} = app, sets = app.data.sets;
  const set = sets.find(s => s.id === state.set) ?? sets[0];
  const chunk = set.chunked ? (set.chunks.find(c => c.id === state.chunk) ?? set.chunks.find(c => Object.values(c.shipped).some(s => s.pages)) ?? set.chunks[0])?.id ?? null : null;
  const profile = set.profiles.includes(state.profile) ? state.profile : set.profiles[0];
  return {set, chunk, profile};
}

function makeApp(ctx, state) {
  return {
    ctx, state, data: null, formats: [], pages: new Map(), packs: new Map(), exports: new Map(), whatif: new Map(), ledger: null, busy: null, focus: null, token: 0,
    route(patch = {}) { return {tab: 'atlas', asset: null, clip: null, direction: null, frame: null, params: stateParams({...this.state, ...patch})}; },
    go(patch, opts = {}) { this.focus = opts.focus ?? null; this.ctx.navigate(this.route(patch), {replace: opts.replace}); },
    render() { return render(this); }
  };
}

function sidebar(app, sel) {
  const {ctx} = app;
  return h('nav', {class: 'sets', 'aria-label': ctx.t('sets.label')}, ...app.data.sets.map(set => h('section', 'set' + (set.id === sel.set.id ? ' on' : ''),
    h('h2', '', h('a', {href: ctx.href(app.route({set: set.id, chunk: null, profile: null, page: 0, key: null})), 'aria-current': set.id === sel.set.id && !set.chunked ? 'true' : null}, ctx.label(set.label))),
    set.chunked ? h('ul', 'chunks', ...set.chunks.map(c => {
      const b = c.shipped[set.design?.profile ?? set.profiles.at(-1)]?.budget ?? Object.values(c.shipped)[0].budget;
      return h('li', '', h('a', {href: ctx.href(app.route({set: set.id, chunk: c.id, page: 0, key: null})), 'aria-current': set.id === sel.set.id && c.id === sel.chunk ? 'true' : null}, h('code', '', c.id), stateBadge(ctx, b.state)));
    })) : h('p', 'muted', ctx.t('sets.frames', {n: Object.values(set.shipped).at(0)?.frames ?? 0})))));
}

async function render(app) {
  const {ctx, state} = app, mine = ++app.token;
  if (!app.ui) return;
  const {ui} = app;
  if (app.failed) return fill(ui.body, failure(ctx, app.failed));
  const sel = selection(app);
  fill(ui.side, sidebar(app, sel));
  fill(ui.views, ...VIEWS.map(v => h('a', {class: 'chip' + (v === state.view ? ' on' : ''), 'aria-current': v === state.view ? 'true' : null, href: ctx.href(app.route({view: v}))}, ctx.t('view.' + v))));
  fill(ui.target, h('span', 'muted', ctx.t('target.label')), ' ', h('b', '', ctx.label(sel.set.label)), ...(sel.chunk ? [' / ', h('code', '', sel.chunk)] : []));
  const body = h('div', 'view');
  await RENDERERS[state.view](app, sel, body);
  if (mine !== app.token) return;
  fill(ui.body, body);
  if (app.focus === 'canvas') body.querySelector('canvas')?.focus();
  app.focus = null;
}

export async function mount(ctx, state) {
  await ctx.loadCss(new URL('./atlas.css', import.meta.url));
  app = makeApp(ctx, state);
  const ui = app.ui = {side: h('div', 'side-nav'), views: h('nav', {class: 'chips views', 'aria-label': ctx.t('view.label')}), target: h('p', 'target'), body: h('div', 'body', h('p', 'muted pad', ctx.t('loading')))};
  ctx.root.dataset.tab = 'atlas';
  ctx.root.replaceChildren(h('div', 'at',
    h('header', 'at-head', h('div', '', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle'))), h('p', 'safe', badge(ctx.t('safe'), 'good'))),
    h('div', 'at-grid', ui.side, h('main', 'at-main', ui.target, ui.views, ui.body))));
  const mine = app;
  try {
    const [sets] = await Promise.all([ctx.tabApi('sets')]);
    if (app !== mine) return;
    app.data = sets; app.formats = sets.formats;
  } catch (error) { if (error.name === 'AbortError') return; app.failed = error; }
  await render(app);
}

export async function update(ctx, state) {
  if (!app || app.ctx !== ctx) return mount(ctx, state);
  app.state = state;
  await render(app);
}

export async function unmount() { if (app) app.token++; app = undefined; }
