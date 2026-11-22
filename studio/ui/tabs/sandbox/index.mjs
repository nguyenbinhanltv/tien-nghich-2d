// Sandbox: drop characters, an effect and cues from the catalog into a test room, or open a saved scene. A scene is one JSON
// document in the project's scenes directory; the three playables are scripted scenes that host their own module in a frame.
import { h, button } from './dom.mjs';
import { parseRoute as parse, stateParams, draftScene, parseActor, formatActor, formatTrigger, parseTrigger, floorText, sceneForSave, defaultRoom, starterPatch } from './model.mjs';
import { loadCatalog, loadScene } from './data.mjs';
import { mountStage } from './stage.mjs';
import { createMixer } from './audio.mjs';
import { validateScene } from '../../../core/scene.mjs';

export function parseRoute(route) { return parse(route); }

let app;

function makeApp(ctx, state) {
  const self = {
    ctx, state, config: null, scenes: [], catalog: null, stage: null, stageKey: null, token: 0, mixer: createMixer({masterUrl: id => '/api/tabs/audio/master?id=' + encodeURIComponent(id)}),
    get defaultColor() { return self.config?.defaultColor; },
    /** A route for `patch` merged into the state. `scene` switches to a saved scene (or null for a draft). */
    route(patch = {}, opts = {}) {
      const next = {...self.state, ...patch};
      const scene = 'scene' in opts ? opts.scene : self.state.scene;
      const base = scene ? {} : stateParams(next);
      if (scene) for (const key of ['scale', 'sel', 'ov', 't', 'play']) base[key] = stateParams(next)[key];
      for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
      return {tab: 'sandbox', asset: scene, params: base};
    },
    go(patch, opts = {}) { ctx.navigate(self.route(patch, opts), {replace: opts.replace}); }
  };
  return self;
}

function layout(ctx) {
  const side = h('aside', {class: 'sb-side', 'aria-label': ctx.t('side.label')});
  const center = h('section', {class: 'sb-center', 'aria-label': ctx.t('stage.label')});
  const aside = h('aside', {class: 'sb-aside', 'aria-label': ctx.t('inspector.label')});
  const toList = button('← ' + ctx.t('view.toList'), () => setView('list'), {class: 'btn quiet sb-to-list'});
  const toStage = button(ctx.t('view.toStage') + ' →', () => setView('stage'), {class: 'btn primary sb-to-stage'});
  const root = h('div', {class: 'sb', 'data-view': 'stage'}, toList, toStage, side, center, aside);
  ctx.root.replaceChildren(h('header', 'sb-head', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle'))), root);
  return {side, center, aside, sb: root};
}

const label = (ctx, a) => (a ? ctx.label(a.name) || a.id : '');

function select(text, value, options, onChange, id) {
  const s = h('select', {class: 'field', 'aria-label': text, id}, ...options.map(([v, t]) => h('option', {value: v, selected: v === value ? 'selected' : null}, t)));
  s.addEventListener('change', () => onChange(s.value));
  return h('label', 'sb-field', h('span', 'field-label', text), s);
}

/** Below 900 px the list (scenes, pickers) and the stage take turns; the stage is the default. */
function setView(view) { app.sb.dataset.view = view; if (view === 'stage') window.scrollTo?.({top: 0}); }

function renderSide(app) {
  const {ctx, state, catalog, scenes} = app;
  const list = h('ul', {class: 'sb-list', 'aria-label': ctx.t('scenes.label')},
    h('li', '', h('a', {class: 'sb-row' + (!state.scene ? ' on' : ''), href: ctx.href(app.route({}, {scene: null})), 'aria-current': !state.scene ? 'true' : null}, h('span', 'sb-rowid', ctx.t('scenes.testRoom')), h('span', 'sb-rowmeta', ctx.t('scenes.testRoomNote')))),
    ...scenes.map(s => h('li', '', h('a', {class: 'sb-row' + (state.scene === s.id ? ' on' : '') + (s.valid ? '' : ' bad'), href: ctx.href(app.route({}, {scene: s.id})), 'aria-current': state.scene === s.id ? 'true' : null},
      h('span', {class: 'sb-rowid', title: ctx.label(s.name) || s.id}, ctx.label(s.name) || s.id),
      h('span', {class: 'sb-rowmeta', title: s.id}, [s.valid ? ctx.t('kind.' + s.kind) : ctx.t('scenes.invalid'), s.size && `${s.size[0]}×${s.size[1]}`, s.id].filter(Boolean).join(' · '))))));
  const parts = [h('h2', '', ctx.t('scenes.title')), scenes.length ? list : list, !app.config.scenesDir && h('p', 'sb-note', ctx.t('scenes.noDir'))];
  if (!state.scene) parts.push(pickers(app, catalog));
  return parts;
}

function pickers(app, catalog) {
  const {ctx, state} = app;
  const add = (field, token) => app.go({[field]: [...state[field], token]});
  const picker = (title, items, field, fmt = a => a.id) => {
    const sel = h('select', {class: 'field', 'aria-label': title}, ...items.map(a => h('option', {value: a.id}, fmt(a))));
    return h('div', 'sb-picker', h('label', 'sb-field', h('span', 'field-label', title), sel), button(ctx.t('pick.add'), () => sel.value && add(field, sel.value), {'aria-label': ctx.t('pick.addTo', {what: title})}));
  };
  const flats = app.config.palette.map(c => [`flat:${c.id}`, c.id]);
  const floor = state.floor ?? floorText({kind: 'flat', color: app.defaultColor});
  return h('div', 'sb-pickers', h('h2', '', ctx.t('pick.title')),
    picker(ctx.t('pick.character'), catalog.characters, 'actors', a => `${label(ctx, a)} · ${a.id}`),
    picker(ctx.t('pick.effect'), catalog.effects, 'fx'),
    picker(ctx.t('pick.cue'), catalog.cues, 'cues'),
    select(ctx.t('pick.floor'), floor, [...flats, ...catalog.tilesets.map(t => [`tile:${t.id}`, ctx.t('pick.tile', {id: t.id})])], v => app.go({floor: v}), 'sb-floor'),
    h('div', 'sb-size', ...['w', 'h'].map(k => {
      const input = h('input', {class: 'field', type: 'number', min: 16, max: 512, step: 8, value: state[k], 'aria-label': ctx.t('pick.size.' + k)});
      input.addEventListener('change', () => app.go({[k]: Math.min(512, Math.max(16, Number(input.value) || defaultRoom[k]))}, {replace: true}));
      return h('label', 'sb-field', h('span', 'field-label', ctx.t('pick.size.' + k)), input);
    })));
}

async function paintCenter(app, token) {
  const {ctx, state} = app;
  const host = h('div', 'sb-stage');
  let scene, doc = null, check = null;
  if (state.scene) {
    doc = await ctx.tabApi('scene?id=' + encodeURIComponent(state.scene));
    if (token !== app.token) return null;
    if (!doc.valid) { app.stage?.destroy(); app.stage = null; app.stageKey = null; app.center.replaceChildren(h('div', {class: 'sb-pad', role: 'alert'}, h('h2', '', state.scene), h('p', '', ctx.t('scene.invalid')), h('ul', '', ...doc.errors.map(e => h('li', '', `${e.path || '·'}: ${e.message}`))))); return {doc, scene: null}; }
    scene = doc.scene;
  } else scene = draftScene(state, {color: app.defaultColor});
  check = validateScene(scene);
  if (scene.kind === 'scripted') {
    app.stage?.destroy(); app.stage = null; app.stageKey = null; app.mixer.stopAll();
    app.center.replaceChildren(hostFrame(app, scene));
    return {doc, scene};
  }
  const key = JSON.stringify([state.scene, scene, state.scale]);
  if (key === app.stageKey && app.stage) {
    if (!app.stage.isPlaying() && state.t !== app.stage.getTime()) app.stage.setTime(state.t);
    app.stage.setView(state.sel, state.ov);
    return {doc, scene, loaded: app.loaded};
  }
  app.stage?.destroy();
  const loaded = await loadScene(ctx, scene);
  if (token !== app.token) return null;
  app.loaded = loaded;
  const colors = new Map(app.config.palette.map(c => [c.id, c.hex]));
  const head = h('div', 'sb-title', h('h2', '', state.scene ? ctx.label(scene.name) || scene.id : ctx.t('scenes.testRoom')), h('p', 'sb-meta', [ctx.t('kind.data'), `${scene.room.size[0]}×${scene.room.size[1]}`, ctx.t('meta.counts', {actors: scene.actors.length, effects: scene.effects.length, cues: scene.audio?.cues?.length ?? 0})].join(' · ')));
  const warn = loaded.missing.length ? h('p', {class: 'sb-warn', role: 'alert'}, ctx.t('stage.missing', {ids: loaded.missing.join(', ')})) : null;
  const isStarter = !state.scene && app.starter && JSON.stringify([state.actors, state.fx]) === JSON.stringify([app.starter.actors, app.starter.fx]);
  const empty = !scene.actors.length && !scene.effects.length ? h('p', 'sb-note', ctx.t('stage.empty')) : isStarter ? h('p', 'sb-note sb-honest', scene.effects.length ? ctx.t('stage.starter') : ctx.t('stage.starterNoFx')) : null;
  app.center.replaceChildren(...[head, warn, empty, host, bedControl(app, scene)].filter(Boolean));
  app.stageKey = key;
  app.stage = mountStage(app, host, {scene, loaded, colors, mixer: app.mixer, state,
    onTime: t => app.go({t, play: false}, {replace: true}), hrefFor: patch => app.route(patch)});
  return {doc, scene, loaded};
}

function bedControl(app, scene) {
  const {ctx} = app;
  if (!scene.audio?.bed) return null;
  const b = button('', async () => { const on = await app.mixer.toggleBed(scene.audio.bed); b.textContent = on ? ctx.t('audio.bedOff', {id: scene.audio.bed}) : ctx.t('audio.bedOn', {id: scene.audio.bed}); b.setAttribute('aria-pressed', String(on)); },
    {class: 'btn sb-bed', 'aria-pressed': 'false'});
  b.textContent = ctx.t('audio.bedOn', {id: scene.audio.bed});
  return h('div', 'sb-bedrow', b, h('span', 'sb-note', ctx.t('audio.silent')));
}

function hostFrame(app, scene) {
  const {ctx} = app;
  const [w, hh] = scene.host.size ?? scene.room.size;
  const frame = h('iframe', {class: 'sb-frame', src: scene.host.url, title: ctx.label(scene.name) || scene.id, width: w * 2, height: hh * 2 + 160, loading: 'eager'});
  return h('div', 'sb-hosted',
    h('div', 'sb-title', h('h2', '', ctx.label(scene.name) || scene.id), h('p', 'sb-meta', [ctx.t('kind.scripted'), `${w}×${hh}`, scene.host.url].join(' · '))),
    h('p', 'sb-note sb-honest', ctx.t('hosted.note')), scene.host.note && h('p', 'sb-note', scene.host.note),
    frame, h('a', {class: 'sb-open', href: scene.host.url, target: '_blank', rel: 'noopener'}, ctx.t('hosted.open')),
    h('h3', '', ctx.t('hosted.logic')), h('ul', 'sb-logic', ...scene.host.logic.map(l => h('li', '', l))));
}

function renderAside(app, shown) {
  const {ctx, state} = app;
  const out = [];
  if (!shown?.scene) { app.aside.replaceChildren(h('p', 'sb-pad muted', ctx.t('inspector.none'))); return; }
  const {scene, doc, loaded} = shown;
  if (scene.kind === 'scripted') { app.aside.replaceChildren(h('div', 'sb-panel', h('h2', '', ctx.t('inspector.scene')), h('p', 'sb-note', ctx.t('hosted.controls')), unknown(ctx, doc))); return; }
  if (!state.scene) out.push(draftPanel(app, scene, loaded));
  else out.push(h('div', 'sb-panel', h('h2', '', ctx.t('inspector.scene')), unknown(ctx, doc), sceneSummary(ctx, scene)));
  out.push(savePanel(app, scene));
  app.aside.replaceChildren(...out);
}

const unknown = (ctx, doc) => (doc?.unknownAssets?.length ? h('p', {class: 'sb-warn', role: 'alert'}, ctx.t('scene.unknown', {ids: doc.unknownAssets.join(', ')})) : null);

function sceneSummary(ctx, scene) {
  return h('ul', 'sb-items', ...scene.actors.map(a => h('li', '', ctx.t('item.actor', {id: a.id, asset: a.asset}))), ...scene.effects.map(e => h('li', '', ctx.t('item.effect', {id: e.id, asset: e.asset, when: e.when.input ?? ctx.t('item.atTime', {ms: e.when.time})}))),
    ...(scene.audio?.cues ?? []).map(c => h('li', '', ctx.t('item.cue', {id: c.id, asset: c.asset}))));
}

function draftPanel(app, scene, loaded) {
  const {ctx, state} = app;
  const rm = (field, i) => app.go({[field]: state[field].filter((_, k) => k !== i), ...(field === 'actors' ? {sel: null} : {})});
  const row = (text, field, i, extra) => h('li', 'sb-item', extra, h('span', '', text), button('×', () => rm(field, i), {'aria-label': ctx.t('item.remove', {what: text}), title: ctx.t('item.remove', {what: text})}));
  const actorRows = scene.actors.map((a, i) => row(`${a.id}`, 'actors', i, h('a', {class: 'sb-pick' + (state.sel === a.id ? ' on' : ''), href: ctx.href(app.route({sel: a.id})), 'aria-current': state.sel === a.id ? 'true' : null}, '◉')));
  const parts = [h('h2', '', ctx.t('inspector.room')), scene.actors.length ? h('ul', {class: 'sb-items', 'aria-label': ctx.t('item.actors')}, ...actorRows) : h('p', 'sb-note', ctx.t('item.noActors'))];
  const sel = scene.actors.find(a => a.id === state.sel) ?? scene.actors[0];
  const sprite = sel && loaded.actors.get(sel.asset);
  if (sprite) {
    const i = scene.actors.indexOf(sel), tok = parseActor(state.actors[i]);
    const clips = Object.keys(sprite.clips), clip = tok.clip && sprite.clips[tok.clip] ? tok.clip : clips.find(c => /idle/.test(c)) ?? clips[0];
    const dirs = Object.keys(sprite.clips[clip]);
    const set = patch => app.go({actors: state.actors.map((t, k) => (k === i ? formatActor({...tok, ...patch}) : t))});
    parts.push(h('div', 'sb-fields', select(ctx.t('actor.clip'), clip, clips.map(c => [c, c]), v => set({clip: v, direction: undefined})), select(ctx.t('actor.dir'), tok.direction && dirs.includes(tok.direction) ? tok.direction : dirs.includes('south') ? 'south' : dirs[0], dirs.map(d => [d, d]), v => set({direction: v}))));
  }
  if (scene.effects.length) parts.push(h('ul', {class: 'sb-items', 'aria-label': ctx.t('item.effects')}, ...state.fx.map((id, i) => row(id, 'fx', i))),
    select(ctx.t('fx.anchor'), state.anchor, ['feet', 'center', 'head'].map(a => [a, ctx.t('anchor.' + a)]), v => app.go({anchor: v})),
    select(ctx.t('fx.when'), formatTrigger(state.fxOn), triggerOptions(ctx), v => app.go({fxOn: parseTrigger(v)})));
  if (scene.audio?.cues.length) parts.push(h('ul', {class: 'sb-items', 'aria-label': ctx.t('item.cues')}, ...state.cues.map((id, i) => row(id, 'cues', i))),
    select(ctx.t('cue.when'), formatTrigger(state.cueOn), triggerOptions(ctx), v => app.go({cueOn: parseTrigger(v)})));
  const beds = app.catalog.cues.filter(c => c.category === 'bgm');
  if (beds.length) parts.push(select(ctx.t('cue.bed'), state.bed ?? '', [['', ctx.t('cue.noBed')], ...beds.map(b => [b.id, b.id])], v => app.go({bed: v || null})));
  return h('div', 'sb-panel', ...parts);
}

const triggerOptions = ctx => [['click', ctx.t('when.click')], ['key:E', ctx.t('when.keyE')], ['time:0', ctx.t('when.start')], ['time:500', ctx.t('when.half')]];

function savePanel(app, scene) {
  const {ctx} = app;
  const id = h('input', {class: 'field', type: 'text', id: 'sb-save-id', maxlength: 48, pattern: '[a-z0-9][a-z0-9_-]*', placeholder: ctx.t('save.idHint'), autocomplete: 'off', value: app.state.scene ? '' : ''});
  const name = h('input', {class: 'field', type: 'text', id: 'sb-save-name', maxlength: 80, autocomplete: 'off'});
  const status = h('p', {class: 'sb-note', role: 'status'});
  const go = async confirm => {
    const check = sceneForSave(scene, id.value.trim(), name.value.trim(), app.config.palette.map(c => c.id));
    if (!check.ok) { status.textContent = ctx.t('save.invalid', {why: check.errors.slice(0, 3).map(e => `${e.path || 'scene'}: ${e.message}`).join('; ')}); return; }
    const res = await fetch('/api/tabs/sandbox/scene', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({scene: check.scene, ...(confirm ? {confirm: true} : {})}), signal: app.ctx.signal});
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.error?.code === 'tracked_scene') {
      if (window.confirm(ctx.t('save.confirmReplace', {file: `${app.config.scenesDir}/${check.scene.id}.scene.json`}))) return go(true);
      status.textContent = ctx.t('save.kept'); return;
    }
    if (!res.ok) { status.textContent = ctx.t('save.failed', {why: body.error?.message ?? res.status}); return; }
    status.textContent = ctx.t(body.replaced ? 'save.replaced' : 'save.created', {file: body.file}) + (body.unknownAssets.length ? ' ' + ctx.t('scene.unknown', {ids: body.unknownAssets.join(', ')}) : '');
    app.scenes = (await ctx.tabApi('scenes')).scenes;
    renderSideInto(app);
  };
  const form = h('form', {class: 'sb-save'}, h('label', 'sb-field', h('span', 'field-label', ctx.t('save.id')), id), h('label', 'sb-field', h('span', 'field-label', ctx.t('save.name')), name),
    h('button', {type: 'submit', class: 'btn primary', disabled: app.config.scenesDir ? null : true}, ctx.t('save.button')));
  form.addEventListener('submit', event => { event.preventDefault(); go(false); });
  return h('div', 'sb-panel', h('h2', '', ctx.t('save.title')), h('p', 'sb-note', app.config.scenesDir ? ctx.t('save.where', {dir: app.config.scenesDir}) : ctx.t('scenes.noDir')), form, status);
}

function renderSideInto(app) { app.side.replaceChildren(...renderSide(app).filter(Boolean)); }

/** A failed request: the message and a button that tries again. */
function errorBox(ctx, error, retry) {
  return h('div', 'empty sb-error', h('p', {class: 'empty-body', role: 'alert'}, ctx.t('common.error', {message: error.message})), button(ctx.t('common.retry'), retry, {class: 'btn primary'}));
}

async function paint() {
  const token = ++app.token;
  renderSideInto(app);
  try {
    const shown = await paintCenter(app, token);
    if (token !== app.token) return;
    renderAside(app, shown);
  } catch (error) {
    if (error.name === 'AbortError') return;
    app.center.replaceChildren(errorBox(app.ctx, error, paint));
    app.aside.replaceChildren();
  }
}

export async function mount(ctx, state) {
  ctx.loadCss(new URL('./sandbox.css', import.meta.url));
  ctx.root.classList.add('ui-kit');
  const mine = app = makeApp(ctx, state);
  ctx.onUnmount(() => { mine.stage?.destroy(); mine.mixer.dispose(); });
  const ui = layout(ctx);
  Object.assign(app, ui);
  async function load() {
    ctx.root.setAttribute('aria-busy', 'true');
    app.side.replaceChildren(h('p', {class: 'muted', role: 'status'}, ctx.t('loading')), h('span', 'skeleton block'), h('span', 'skeleton block'));
    app.center.replaceChildren(h('span', {class: 'skeleton block sb-skeleton-stage', 'aria-hidden': 'true'}));
    app.aside.replaceChildren();
    try {
      [app.config, app.catalog] = await Promise.all([ctx.tabApi('config'), loadCatalog(ctx)]);
      app.scenes = (await ctx.tabApi('scenes')).scenes;
    } catch (error) {
      if (error.name === 'AbortError') return;
      ctx.root.removeAttribute('aria-busy');
      app.side.replaceChildren();
      app.center.replaceChildren(errorBox(ctx, error, load));
      return;
    }
    ctx.root.removeAttribute('aria-busy');
    const starter = starterPatch(app.state, app.catalog);
    if (starter) {   // the route change comes back through update(), which paints
      app.starter = starter;
      app.go(starter, {replace: true});
      return;
    }
    await paint();
  }
  await load();
}

export async function update(ctx, state) {
  const sceneChanged = state.scene !== app.state.scene;
  app.state = state;
  if (sceneChanged && app.sb) setView('stage');
  if (!app.catalog) return;   // the first load is still running; it paints when it is done
  await paint();
}
export async function unmount() { app?.stage?.destroy(); app?.mixer.dispose(); }
