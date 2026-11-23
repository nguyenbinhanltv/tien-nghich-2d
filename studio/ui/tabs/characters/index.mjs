// Characters tab: roster, four-facing turnaround, clip timeline with playback, onion skin, overlays,
// raw/processed comparison, cross-facing check, card/rig/motion, contact sheet and review controls.
// Contract: see studio/ui/README.md. Everything this tab owns lives in this directory.
import { h, notice } from './dom.mjs';
import { parseRoute as parseState, toRoute, resolveSelection } from './state.mjs';
import { createImageStore } from './images.mjs';
import { renderRoster } from './roster.mjs';
import { renderStage, drawCells, cancelPlayback, handleKey, startPlay } from './stage.mjs';
import { installShortcuts } from '../../pixelview.mjs';
import { renderPanel } from './panels.mjs';
import { renderDecision, stampApproved } from './decide.mjs';
import { approveThenStamp } from '../../seal.mjs';

export { parseRoute } from './state.mjs';

const apps = new WeakMap();

async function postJson(url, body) {
  const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? 'HTTP ' + res.status), {status: res.status, code: data.error?.code, head: data.head});
  return data;
}

function makeApp(ctx) {
  const app = {
    ctx, store: createImageStore(), roster: null, detail: null, state: null, sel: {}, liveFrame: null, zoom: 4, draft: null,
    play: {on: false, raf: 0, speed: 1}, pv: {grid: true, bg: 'dark', wipe: 0.5}, editor: {frames: new Map(), snapshot: null, editable: false, error: null, busy: false},
    els: {}, exportScale: 3, exportClip: '', searchTimer: 0,
    navigate(patch, options = {}) {
      app.draft = patch.frame !== undefined || patch.clip !== undefined || patch.direction !== undefined ? null : app.draft;
      ctx.navigate(toRoute({...app.state, ...patch}), options);
    },
    renderPanel: () => { renderPanel(app); renderDecision(app); },
    reload: () => loadDetail(app),
    async loadRoster() {
      app.rosterError = null; renderRoster(app);
      try { app.roster = await ctx.tabApi('roster'); }
      catch (error) { if (error.name === 'AbortError') return; app.rosterError = error.message; }
      renderRoster(app);
    },
    setDraft(pivot) { app.draft = pivot; app.renderPanel(); drawCells(app); },
    async savePivot() {
      const {snapshot} = app.editor;
      await app.edit(() => postJson('/api/editor/save', {key: snapshot.key, baseRevision: snapshot.head, metadata: {pivot: app.draft}}), () => { app.draft = null; });
    },
    async review(status, text) {
      const {snapshot} = app.editor;
      if (!status && !text) { app.editor.error = ctx.t('review.needText'); app.editor.errorSource = 'review'; app.renderPanel(); return; }
      const call = () => postJson('/api/editor/review', {key: snapshot.key, revision: snapshot.head, ...(status ? {status} : {}), ...(text ? {text} : {})});
      // The stamp comes only after the server confirmed the write; a failure throws before it. The note is cleared only once the write is recorded.
      await app.edit(status === 'approved' ? () => approveThenStamp(call, saved => stampApproved(app, saved)) : call, () => { app.note = null; }, 'review');
    },
    async edit(request, after, source = 'pivot') {
      app.editor.busy = true; app.editor.error = null; app.editor.errorSource = source; app.renderPanel();
      try { app.editor.snapshot = await request(); after?.(); }
      catch (error) {
        app.editor.error = error.code === 'revision_conflict' ? ctx.t('frame.conflict', {head: error.head}) : error.message;
        if (error.code === 'revision_conflict') await app.loadSnapshot();
      } finally { app.editor.busy = false; app.renderPanel(); drawCells(app); }
    },
    async loadSnapshot() {
      const frame = app.detail && app.sel.clip ? app.detail.frames.filter(f => f.clip === app.sel.clip && f.direction === app.sel.direction)[app.sel.frame] : null;
      const info = frame && app.editor.frames.get(frame.path);
      app.editor.editable = Boolean(info);
      app.editor.snapshot = null;
      if (!info) { app.renderPanel(); return; }
      try { app.editor.snapshot = await ctx.fetchJson('/api/editor/frame?' + new URLSearchParams({key: info.key})); app.editor.error = null; }
      catch (error) { if (error.name !== 'AbortError') { app.editor.error = error.message; app.editor.errorSource = 'pivot'; } }
      app.renderPanel();
      drawCells(app);
    }
  };
  return app;
}

async function loadDetail(app) {
  const {ctx, state} = app;
  app.detail = null; app.raw = null; app.draft = null; app.editor.frames = new Map(); app.editor.snapshot = null; app.editor.editable = false;
  app.stageError = null;
  renderStage(app); app.renderPanel();
  if (!state.id) return;
  try {
    const query = new URLSearchParams({id: state.id, ...(state.source ? {source: state.source} : {})});
    const [detail, editor] = await Promise.all([ctx.tabApi('asset?' + query),
      ctx.fetchJson('/api/editor/frames?' + new URLSearchParams({assetId: state.id})).catch(() => ({frames: []}))]);
    if (app.state.id !== state.id) return;
    app.raw = detail;
    for (const f of editor.frames) app.editor.frames.set(f.processedUrl.slice(1), f);
    app.store.forget();
    ctx.announce(ctx.t('stage.loaded', {id: detail.id}));
  } catch (error) {
    if (error.name === 'AbortError') return;
    app.stageError = true;
    app.els.stage.replaceChildren(error.status === 404 ? notice(ctx, {title: ctx.t('stage.errorTitle'), body: ctx.t('stage.unknown', {id: state.id}), alert: true})
      : notice(ctx, {title: ctx.t('stage.errorTitle'), body: ctx.t('common.error', {message: error.message}), retry: () => loadDetail(app), alert: true}));
    app.renderPanel();
    return;
  }
  settle(app);
}

/** Make the selection real, correct the URL if it was not, and draw. */
function settle(app) {
  if (!app.raw) return;
  const {state, ctx} = app;
  // The forge's bake of a rigged character can be viewed instead of the library frames; it has no editor keys.
  app.detail = state.frames === 'bake' && app.raw.bakeFrames.length ? {...app.raw, frames: app.raw.bakeFrames, rawFrames: []} : app.raw;
  const before = [state.clip, state.direction, state.frame];
  app.sel = resolveSelection(app.detail, state, ctx.project.tabConfig.characters?.facings ?? ['south', 'east', 'north', 'west']);
  if (app.sel.clip && (before[0] !== app.sel.clip || before[1] !== app.sel.direction || before[2] !== app.sel.frame)) {
    app.state = {...state, clip: app.sel.clip, direction: app.sel.direction, frame: app.sel.frame};
    ctx.navigate(toRoute(app.state), {replace: true});
    return; // the shell calls update() again with the corrected URL
  }
  renderStage(app);
  app.renderPanel();
  if (app.playNext) { app.playNext = false; startPlay(app); }
  app.loadSnapshot();
}

/** Below 900 px the roster and the detail are two views of one column: a selected character shows the detail, none shows the roster. */
function syncView(app) {
  const view = app.state.id ? 'detail' : 'list';
  if (app.els.host.dataset.view !== view && view === 'detail' && matchMedia('(max-width: 900px)').matches) app.els.host.scrollIntoView({block: 'start'});
  app.els.host.dataset.view = view;
}

export async function mount(ctx, state) {
  ctx.loadCss(new URL('../../pixelview.css', import.meta.url));
  ctx.loadCss(new URL('../../seal.css', import.meta.url));
  ctx.loadCss(new URL('./characters.css', import.meta.url));
  const app = makeApp(ctx);
  apps.set(ctx, app);
  app.state = state;
  app.els.roster = h('aside', {class: 'roster', 'aria-label': ctx.t('roster.title')});
  app.els.stage = h('section', {class: 'stage', 'aria-label': ctx.t('stage.title')});
  app.els.panel = h('aside', {class: 'panel', 'aria-label': ctx.t('panel.label')});
  app.els.back = h('div', 'back-bar', h('button', {type: 'button', class: 'btn quiet', onclick: () => app.navigate({id: null, source: null, clip: null, direction: null, frame: null})}, '← ' + ctx.t('roster.back')));
  app.els.decide = h('section', {class: 'decide', 'aria-label': ctx.t('review.title'), hidden: true, 'data-slot': 'decision'});
  app.els.host = h('div', {class: 'characters ui-kit'}, app.els.roster, app.els.back, h('div', 'stage-col', app.els.stage, app.els.decide), app.els.panel);
  ctx.root.replaceChildren(app.els.host);
  syncView(app);
  renderRoster(app); renderStage(app); app.renderPanel();
  const stopKeys = installShortcuts(action => handleKey(app, action));
  ctx.onUnmount(() => { stopKeys(); app.previewStop?.(); cancelPlayback(app); clearTimeout(app.searchTimer); app.store.forget(); });
  await Promise.all([app.loadRoster(), loadDetail(app)]);
}

export async function update(ctx, state) {
  const app = apps.get(ctx);
  if (!app) return;
  const sameAsset = state.id === app.state.id && state.source === app.state.source;
  const sameFrame = sameAsset && [state.clip, state.direction, state.frame].join() === [app.state.clip, app.state.direction, app.state.frame].join();
  if (app.play.on && sameAsset) { app.state = state; return; }
  app.state = state;
  syncView(app);
  renderRoster(app);
  if (!sameAsset) { await loadDetail(app); return; }
  if (!sameFrame) app.draft = null;
  settle(app);
}
