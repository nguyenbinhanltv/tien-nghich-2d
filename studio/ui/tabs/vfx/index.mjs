// VFX: browse the eighteen effects, play them frame-accurately, judge them in context, read their specs and
// provenance, compare improvement rounds, and record a human 1x readability note.
// Catalog from this tab's server.mjs (index, manifest, specs, provenance); notes through the existing review API.
import { h, button } from './dom.mjs';
import { parseRoute as parse, stateParams, resolveClip, resolveVariant, views, applyFilters } from './model.mjs';
import { renderBrowser } from './browser.mjs';
import { mountStage, loadFrames, loadCharacter } from './stage.mjs';
import { specPanel, auditPanel, provenancePanel, roundsPanel, readPanel } from './panels.mjs';

export function parseRoute(route) { return parse(route); }

let app;

function makeApp(ctx, state) {
  const self = {
    ctx, state, cards: [], floors: [], ui: null, stage: null, stageKey: null, token: 0, details: new Map(), evidences: new Map(), characters: null,
    effect(id) { if (!self.details.has(id)) self.details.set(id, ctx.tabApi('effect?id=' + encodeURIComponent(id)).catch(e => { self.details.delete(id); throw e; })); return self.details.get(id); },
    evidence(id) { if (!self.evidences.has(id)) self.evidences.set(id, ctx.tabApi('evidence?id=' + encodeURIComponent(id)).catch(e => { self.evidences.delete(id); throw e; })); return self.evidences.get(id); },
    /** A route for `patch` merged into the current state. `asset: id|null` switches effect and resets clip/frame. */
    route(patch = {}, opts = {}) {
      const next = {...self.state, ...patch};
      let asset = self.state.asset, clip = self.state.clip, frame = self.state.frame;
      if ('asset' in opts) { asset = opts.asset; clip = null; frame = null; next.variant = null; }
      if ('clip' in opts) { clip = opts.clip; frame = null; }
      if ('frame' in opts) frame = opts.frame;
      return {tab: 'vfx', asset, clip: asset ? clip : null, frame: asset ? frame : null, params: stateParams(next)};
    },
    go(patch, opts = {}) { ctx.navigate(self.route(patch, opts), {replace: opts.replace}); }
  };
  return self;
}

function layout(ctx) {
  const search = h('input', {type: 'search', id: 'vx-q', class: 'vx-search', placeholder: ctx.t('filter.search'), 'aria-label': ctx.t('filter.search'), autocomplete: 'off'});
  const filters = h('div', 'vx-filters');
  const center = h('section', {class: 'vx-center', 'aria-label': ctx.t('stage.label')});
  const aside = h('aside', {class: 'vx-aside', 'aria-label': ctx.t('panel.label')});
  ctx.root.replaceChildren(
    h('header', 'vx-head', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle'))),
    h('div', 'vx', h('aside', {class: 'vx-side', 'aria-label': ctx.t('filter.label')}, search, filters), center, aside));
  return {search, filters, center, aside};
}

async function characterList(app) {
  if (!app.characters) {
    const {assets} = await app.ctx.api('assets?limit=1000');
    const tab = app.ctx.project.categoryTabs ?? {};
    app.characters = assets.filter(a => tab[a.category] === 'characters' && a.readiness !== 'planned' && (a.clips?.length ?? 0) > 0);
  }
  return app.characters;
}

function header(app, effect, clip, focus, variant) {
  const {ctx, state} = app;
  const chips = h('div', {class: 'vx-chips', role: 'group', 'aria-label': ctx.t('clip.label')});
  if (effect.group === 'core') {
    const named = clip.sections.filter(s => !s.role);
    const roles = clip.sections.filter(s => s.role);
    chips.append(h('a', {class: 'vx-chip-link' + (!focus ? ' on' : ''), href: ctx.href(app.route({}, {clip: null}))}, ctx.t('clip.all')),
      ...[...named, ...roles].map(s => h('a', {class: 'vx-chip-link' + (focus?.name === s.name ? ' on' : ''), href: ctx.href(app.route({}, {clip: s.name}))}, s.name, h('small', '', ` ${s.from}–${s.to}`))));
  } else {
    chips.append(...effect.clips.map(c => h('a', {class: 'vx-chip-link' + (c.id === clip.id ? ' on' : ''), href: ctx.href(app.route({}, {clip: c.id}))}, c.id, h('small', '', ` ${c.ms.length}`))));
  }
  const variantSel = effect.variants.length > 1 ? h('label', 'vx-field', ctx.t('variant.label'),
    h('select', {id: 'vx-variant'}, ...effect.variants.map(v => h('option', {value: v.id, selected: v.id === variant ? 'selected' : null}, v.id + (v.ramps.length ? ' · ' + v.ramps.join('+') : ''))))) : null;
  variantSel?.querySelector('select').addEventListener('change', e => app.go({variant: e.target.value}));
  const meta = [effect.sourceLabel, ctx.t('ready.' + effect.readiness), effect.chunk && ctx.t('meta.chunk', {chunk: effect.chunk}), `${effect.size[0]}×${effect.size[1]}`,
    ctx.t('meta.anchor', {x: effect.anchor[0], y: effect.anchor[1]}), effect.fps && ctx.t('meta.fps', {fps: effect.fps}), ctx.t('kind.' + clip.kind)].filter(Boolean).join(' · ');
  return h('div', 'vx-title', h('h2', '', effect.id), h('p', 'vx-meta', meta), effect.reads && h('p', 'vx-note', effect.reads), chips, variantSel);
}

async function overlayControls(app, effect) {
  const {ctx, state} = app;
  const toggle = h('a', {class: 'vx-segbtn vx-toggle' + (state.overlay ? ' on' : ''), href: ctx.href(app.route({overlay: !state.overlay})), 'aria-pressed': String(state.overlay)}, ctx.t('overlay.toggle'));
  if (!state.overlay) return {el: h('div', 'vx-overlay', toggle, h('span', 'vx-note', ctx.t('overlay.hint'))), character: null};
  const list = await characterList(app);
  const id = list.some(a => a.id === state.char) ? state.char : list.find(a => /outer_disciple/.test(a.id))?.id ?? list[0]?.id;
  const character = id ? await loadCharacter(app, {...state, char: id}) : null;
  const sel = (label, value, options, field, fmt = x => x) => {
    const s = h('select', {'aria-label': label}, ...options.map(o => h('option', {value: o, selected: o === value ? 'selected' : null}, fmt(o))));
    s.addEventListener('change', () => app.go({[field]: s.value, ...(field === 'char' ? {cclip: null, cdir: null, cn: 0} : {})}));
    return h('label', 'vx-field', label, s);
  };
  const controls = [toggle, sel(ctx.t('overlay.character'), id, list.map(a => a.id), 'char', x => ctx.label(list.find(a => a.id === x)?.name) || x)];
  if (character?.count) {
    controls.push(sel(ctx.t('overlay.clip'), character.clip, character.clips, 'cclip'), sel(ctx.t('overlay.dir'), character.dir, character.dirs, 'cdir'),
      sel(ctx.t('overlay.frame'), String(Math.min(state.cn, character.count - 1)), Array.from({length: character.count}, (_, i) => String(i)), 'cn'));
    const range = h('input', {type: 'range', min: 0, max: 24, step: 1, value: state.oy, 'aria-label': ctx.t('overlay.lift')});
    range.addEventListener('change', () => app.go({oy: Number(range.value)}, {replace: true}));
    controls.push(h('label', 'vx-field', ctx.t('overlay.lift'), range, h('small', '', ctx.t('overlay.px', {px: state.oy}))));
  }
  const note = character?.assumed ? h('p', 'vx-note vx-honest', ctx.t('overlay.pivotAssumed')) : character ? h('p', 'vx-note', ctx.t('overlay.pivotFrom', {x: character.pivot[0], y: character.pivot[1], px: effect.anchor.join(',')})) : h('p', 'vx-note', ctx.t('overlay.none'));
  return {el: h('div', 'vx-overlay', ...controls, note), character: character?.img ? character : null};
}

async function paintStage(app, token) {
  const {ctx, state, ui} = app;
  if (!state.asset) { app.stage?.destroy(); app.stage = null; app.stageKey = null; ui.center.replaceChildren(h('p', 'vx-pad muted', ctx.t('stage.none'))); return null; }
  const {effect, floors} = await app.effect(state.asset);
  if (token !== app.token) return null;
  const {clip, focus} = resolveClip(effect, state.clip);
  const variant = resolveVariant(effect, state.variant);
  const key = JSON.stringify([state.asset, state.clip, variant, state.scale, state.floor, state.overlay, state.char, state.cclip, state.cdir, state.cn, state.oy]);
  if (key === app.stageKey && app.stage) { if (state.frame != null && state.frame !== app.stage.getFrame() && !app.stage.isPlaying()) app.stage.setFrame(state.frame); return {effect, clip, variant}; }
  app.stage?.destroy();
  const frames = await loadFrames(clip.paths[variant] ?? []);
  const {el: overlay, character} = await overlayControls(app, effect);
  if (token !== app.token) return null;
  const floor = floors.find(f => f.id === state.floor) ?? floors[0];
  const stageHost = h('div', 'vx-stage');
  ui.center.replaceChildren(header(app, effect, clip, focus, variant), stageHost, overlay);
  app.stageKey = key;
  app.stage = mountStage(app, stageHost, {effect, clip, focus, variant, frames, floor, floors, character, state,
    onFrame: frame => app.go({}, {frame, replace: true}), onChange: patch => app.route(patch)});
  app.live = {effect, clip, variant, frames, floors, floor};
  const missing = frames.filter(f => !f).length;
  if (missing) stageHost.prepend(h('p', {class: 'vx-warn', role: 'alert'}, ctx.t('stage.missing', {count: missing})));
  return {effect, clip, variant};
}

async function paintAside(app, ctx_, token) {
  const {ctx, state, ui} = app;
  if (!ctx_) { ui.aside.replaceChildren(h('p', 'vx-pad muted', ctx.t('panel.none'))); return; }
  const {effect, clip, variant} = ctx_;
  const tabs = h('nav', {class: 'vx-tabs', 'aria-label': ctx.t('panel.label')}, ...views.map(v => h('a', {class: 'vx-tab' + (state.view === v ? ' on' : ''), href: ctx.href(app.route({view: v})), 'aria-current': state.view === v ? 'true' : null}, ctx.t('view.' + v))));
  const body = h('div', 'vx-panel', h('p', 'vx-pad muted', ctx.t('common.loading')));
  ui.aside.replaceChildren(tabs, body);
  try {
    const ev = await app.evidence(effect.id);
    if (token !== app.token) return;
    let node;
    if (state.view === 'spec') node = specPanel(ctx, ev, clip, variant);
    else if (state.view === 'audit') node = auditPanel(ctx, ev, clip, variant);
    else if (state.view === 'provenance') node = provenancePanel(ctx, ev);
    else if (state.view === 'rounds') node = roundsPanel(ctx, ev, state, patch => app.go(patch, {replace: true}));
    else node = await readPanel(ctx, {...effect, acceptance: ev.recorded?.acceptance}, clip, app.live.frames, app.live.floors, variant, {frame: () => app.stage?.getFrame() ?? 0});
    if (token !== app.token) return;
    body.replaceChildren(node);
  } catch (error) {
    if (error.name === 'AbortError') return;
    body.replaceChildren(h('p', {role: 'alert'}, ctx.t('common.error', {message: error.message})));
  }
}

async function paint() {
  const token = ++app.token;
  const {ui, state} = app;
  if (ui.search.value !== state.q && document.activeElement !== ui.search) ui.search.value = state.q;
  renderBrowser(app, ui.filters);
  try {
    const shown = await paintStage(app, token);
    if (token !== app.token) return;
    const asideKey = JSON.stringify([state.asset, state.clip, state.variant, state.view, state.ra, state.rb]);
    if (asideKey !== app.asideKey || !shown) { app.asideKey = asideKey; await paintAside(app, shown, token); }
  } catch (error) {
    if (error.name === 'AbortError') return;
    ui.center.replaceChildren(h('p', {role: 'alert'}, app.ctx.t('common.error', {message: error.message})));
  }
}

export async function mount(ctx, state) {
  ctx.loadCss(new URL('./vfx.css', import.meta.url));
  const mine = app = makeApp(ctx, state);
  ctx.onUnmount(() => { mine.stage?.destroy(); });
  const ui = layout(ctx);
  app.ui = ui;
  ctx.root.setAttribute('aria-busy', 'true');
  try {
    const list = await ctx.tabApi('effects');
    app.cards = list.effects;
    app.floors = list.floors;
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
  await paint();
}

export async function update(ctx, state) {
  app.state = state;
  await paint();
}

export async function unmount() { app?.stage?.destroy(); }
