// Review: one inbox for everything that waits on the human, art and audio. Art decisions go to the
// existing /api/editor/review route; the listening sign-off goes to this tab's one human-only route.
// The inbox polls every POLL_MS while the page is visible (and refreshes after every decision). A new request cancels the one still
// running, so slow answers never pile up; while one runs the page says so, with the seconds it has waited, and a failure keeps the
// last list on screen with a retry button.
import { h, button, humanize, fill, badgeClass, keepFocus } from './dom.mjs';
import { parseRoute as parse, stateParams, parseKey, visibleItems, countsByState, states, shouldDeferRepaint, clock, elapsedSeconds, nextWaiting, stepId, queueProgress, shortcutFor } from './model.mjs';
import { playSeal, actionToast, sealAllowed, sealSetting, setSealSetting, reducedMotion, TOAST_MS } from '../../seal.mjs';
import { EditorApiClient } from '../../../src/editorApi.js';
import { renderArt } from './art.mjs';
import { renderAudio } from './audio.mjs';
import { candidatesSection } from './takes.mjs';

export const POLL_MS = 10000;
export const GHOST_MS = 1200;
export function parseRoute(route) { return parse(route); }

let app;

function makeApp(ctx, state) {
  const self = {
    ctx, state, items: [], audio: [], artRecords: [], drafts: new Map(), token: 0, signature: '', timer: null, cleanups: [], flight: null, ghosts: new Map(), undoLast: null, always: [], api: new EditorApiClient(), busy: false, load: {phase: 'idle', since: 0, error: null, updatedAt: null}, loaded: false,
    onCleanup(fn) { self.cleanups.push(fn); },
    runCleanups() { for (const fn of self.cleanups.splice(0)) fn(); },
    selection() {
      const s = self.state;
      if (s.kind !== 'audio') {
        const byKey = s.key && self.items.find(i => i.key === s.key);
        if (byKey) return {type: 'art', item: byKey};
        const byName = s.asset && s.clip && self.items.find(i => { const p = parseKey(i.key); return p && p.asset === s.asset && p.clip === s.clip && p.direction === s.direction && p.n === s.frame; });
        if (byName) return {type: 'art', item: byName};
      }
      const a = s.asset && self.audio.find(x => x.id === s.asset);
      if (a && (s.kind === 'audio' || !self.items.some(i => i.assetId === s.asset))) return {type: 'audio', item: a};
      return null;
    },
    /** Route for the current state with `patch` merged; `item` (art or audio entry) or `item: null` changes the selection. */
    route(patch = {}, opts = {}) {
      const next = {...self.state, ...patch};
      let asset = self.state.asset, clip = self.state.clip, direction = self.state.direction, frame = self.state.frame;
      if ('item' in opts) {
        const it = opts.item;
        if (!it) { asset = clip = direction = frame = null; next.key = null; next.rev = null; }
        else if (it.key) {
          const p = parseKey(it.key);
          asset = it.assetId; clip = p?.clip ?? null; direction = p?.direction ?? null; frame = p?.n ?? null; next.key = it.key; next.kind = null;
          if (!('rev' in patch)) next.rev = null;
        } else { asset = it.id; clip = direction = frame = null; next.key = null; next.rev = null; next.kind = 'audio'; }
      }
      return {tab: 'review', asset, clip: asset ? clip : null, direction: asset ? direction : null, frame: asset ? frame : null, params: stateParams(next)};
    },
    /** The seal and its words, called by the art detail ONLY after the server confirmed an approval (see approveThenStamp). */
    stampApproved(item, revision) {
      const {ctx} = self, label = item.key.split('/').at(-1);
      ctx.announce(ctx.t('decide.approvedAnnounce', {id: label, rev: revision}));
      self.ghosts.set(item.key, item);
      const drop = setTimeout(() => { self.ghosts.delete(item.key); if (self.ui && self.ctx.root.isConnected) renderList(self, self.ui.list); }, GHOST_MS);
      self.onCleanupAlways(() => clearTimeout(drop));
      if (sealAllowed(localStorage, window)) { const stage = playSeal(ctx.root, ctx.project?.brand?.seal); self.onCleanupAlways(() => stage.remove()); }
      self.toastUndo(item, revision, label);
    },
    /** A 6 s toast with "Undo". Undo is real here: the review store keeps every decision as a row and the newest wins, so 'pending' puts the revision back to awaiting review. */
    toastUndo(item, revision, label) {
      const {ctx} = self;
      self.undoLast?.dismiss();
      const host = ctx.root.querySelector('.rv-toasts');
      if (!host) return;
      const toast = actionToast(host, {text: ctx.t('undo.toast', {id: label, rev: revision}), actionLabel: ctx.t('undo.label'), ms: TOAST_MS, onAction: () => self.undo(item, revision, label)});
      self.undoLast = {...toast, item, revision, label, undo: () => { toast.dismiss(); return self.undo(item, revision, label); }};
      const mine = self.undoLast;
      setTimeout(() => { if (self.undoLast === mine) self.undoLast = null; }, TOAST_MS);
    },
    async undo(item, revision, label) {
      const {ctx} = self;
      self.undoLast = null;
      try {
        await self.api.reviewFrame({key: item.key, revision, status: 'pending'});
        ctx.announce(ctx.t('undo.done', {id: label, rev: revision}));
        self.go({}, {item});
        await self.refresh({keepSelection: true, quiet: true});
      } catch (error) { ctx.announce(ctx.t('undo.failed', {message: error.message})); }
    },
    /** After an approval: open the next item still waiting, or go back to the list when none is. The refresh is quiet so it cannot talk over the "Approved" announcement. */
    async advanceFrom(item) {
      const next = nextWaiting(self.items, item.key);
      if (next) self.go({}, {item: next}); else self.go({}, {item: null});
      await self.refresh({quiet: true}).catch(() => {});
      if (!next) self.ctx.announce(self.ctx.t('queue.clear'));
    },
    onCleanupAlways(fn) { self.always.push(fn); },
    go(patch, opts = {}) { self.ctx.navigate(self.route(patch, opts), {replace: opts.replace}); },
    /** Show the loading / error / last-updated line and, before any list has arrived, the skeleton or the error with its retry button. */
    setLoad(patch) {
      Object.assign(self.load, patch);
      clearInterval(self.ticker);
      if (self.load.phase === 'loading') self.ticker = setInterval(() => renderStatus(self), 1000);
      renderStatus(self);
    },
    refresh({keepSelection = false, quiet = false} = {}) {
      // a request still running is cancelled by the new one; a repaint it was owed (after a decision) passes on to the new one
      const previous = self.flight;
      const keep = keepSelection || Boolean(previous?.keep);
      quiet = quiet || Boolean(previous?.quiet);
      previous?.controller.abort();
      const controller = new AbortController();
      const flight = self.flight = {controller, keep, quiet};
      flight.promise = self.fetchInbox(flight, AbortSignal.any([self.ctx.signal, controller.signal]), keep, quiet).catch(error => {
        if (error.name === 'AbortError' && !self.ctx.signal.aborted && self.flight && self.flight !== flight) return self.flight.promise; // superseded
        throw error;
      });
      return flight.promise;
    },
    async fetchInbox(flight, signal, keepSelection, quiet = false) {
      if (self.load.phase !== 'loading') self.setLoad({phase: 'loading', since: Date.now(), error: null});
      let data, runs;
      try {
        data = await self.ctx.tabApi('inbox', {signal});
        runs = (await self.ctx.tabApi('candidates', {signal}).catch(error => { if (error.name === 'AbortError') throw error; return {runs: []}; })).runs;
      } catch (error) {
        if (self.flight === flight && error.name !== 'AbortError') { self.flight = null; self.setLoad({phase: 'error', error: error.message}); }
        throw error;
      }
      self.flight = null;
      self.loaded = true;
      self.setLoad({phase: 'idle', error: null, updatedAt: new Date()});
      const audio = data.audio;
      const signature = JSON.stringify([runs.map(r => [r.run, r.picked?.label ?? null]), data.items.map(i => [i.key, i.head, i.status, i.comments]), audio.map(a => [a.id, a.state, a.label]), data.artCounts ?? null, (data.artRecords ?? []).map(r => [r.assetId, r.approvalId, r.matching, r.changed, r.missing, r.rawChanged, r.added, r.unverified, r.current])]);
      const changed = signature !== self.signature;
          self.items = data.items; self.runs = runs; self.audio = audio; self.artRecords = data.artRecords ?? []; self.artCounts = data.artCounts ?? null; self.signature = signature;
      if (changed || keepSelection) {
        await paint(self.ui, {force: keepSelection, poll: !keepSelection});
        const waiting = (countsByState(self.items).waiting ?? 0) + audio.filter(a => a.state === 'waiting').length;
        if (!keepSelection && !quiet && changed) self.ctx.announce(self.ctx.t('inbox.changed', {count: waiting}));
      }
      return changed;
    }
  };
  return self;
}

function layout(ctx) {
  const list = h('div', 'inbox'), detail = h('section', {class: 'detail', 'aria-label': ctx.t('detail.label')});
  const back = button('← ' + ctx.t('detail.back'), () => app.go({}, {item: null}), {class: 'btn quiet rv-back'});
  fill(ctx.root, h('header', 'rv-head', h('div', '', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle'))),
    h('div', 'live', h('span', {class: 'pulse', 'aria-hidden': 'true'}), h('span', 'muted', ctx.t('live', {seconds: POLL_MS / 1000})),
      h('span', {class: 'muted rv-stamp', 'data-role': 'stamp'}), h('span', {class: 'rv-wait', 'data-role': 'wait', 'aria-hidden': 'true'}),
      h('span', {class: 'rv-fail', 'data-role': 'fail'}), sealToggle(ctx))),
    h('p', {class: 'rv-keys muted'}, ctx.t('keys.label'), ' ', ...[['A', 'keys.approve'], ['R', 'keys.changes'], ['C', 'keys.comment'], ['J', 'keys.next'], ['K', 'keys.prev'], ['U', 'keys.undo']]
      .flatMap(([k, label]) => [h('kbd', 'kbd', k), ' ' + ctx.t(label) + '  '])),
    h('div', {class: 'rv', 'data-view': 'list'}, h('aside', {class: 'side', 'aria-label': ctx.t('inbox.label')}, list), h('div', 'rv-pane', back, detail)),
    h('div', {class: 'rv-toasts'}));
  return {list, detail, rv: ctx.root.querySelector('.rv')};
}

/** The switch for the approval seal: stored in localStorage; reduced motion turns the effect off whatever it says. */
function sealToggle(ctx) {
  const reduced = reducedMotion(window);
  const on = () => sealSetting(localStorage) === 'on';
  const b = h('button', {type: 'button', class: 'btn quiet sm rv-seal-toggle', 'aria-pressed': String(on() && !reduced), disabled: reduced, title: reduced ? ctx.t('seal.reduced') : null});
  const text = () => { b.textContent = ctx.t(reduced ? 'seal.reducedShort' : on() ? 'seal.on' : 'seal.off'); b.setAttribute('aria-pressed', String(on() && !reduced)); };
  text();
  b.addEventListener('click', () => { setSealSetting(localStorage, on() ? 'off' : 'on'); text(); });
  return b;
}


/** The header line: "last updated hh:mm:ss", the seconds a running request has waited, and a failed refresh with its retry button. */
function renderStatus(app) {
  const {ctx, load} = app;
  const root = ctx.root;
  const stamp = root.querySelector('[data-role="stamp"]'), wait = root.querySelector('[data-role="wait"]'), fail = root.querySelector('[data-role="fail"]');
  if (!stamp || !wait || !fail) return;
  const time = load.updatedAt ? clock(load.updatedAt, ctx.lang) : null;
  stamp.textContent = time ? ctx.t('load.updated', {time}) : '';
  const seconds = elapsedSeconds(load.since, Date.now());
  wait.textContent = load.phase === 'loading' && (!app.loaded || seconds >= 1) ? ctx.t(app.loaded ? 'load.refreshing' : 'load.loading', {seconds}) : '';
  fill(fail);
  if (load.phase === 'error' && app.loaded) fill(fail, h('span', {role: 'alert'}, ctx.t('load.errorStale', {message: load.error, time: time ?? '—'})), ' ', button(ctx.t('common.retry'), () => app.refresh().catch(() => {})));
  if (!app.loaded) paintFirstLoad(app);
}

/** Before the first list arrives: placeholder rows with the wait, or the failure with a retry button. */
function paintFirstLoad(app) {
  const {ctx, load, ui} = app;
  if (load.phase === 'error') {
    fill(ui.list, h('div', 'empty rv-error', h('p', {class: 'empty-body', role: 'alert'}, ctx.t('load.error', {message: load.error})), button(ctx.t('common.retry'), () => app.refresh().catch(() => {}), {class: 'btn primary'})));
    return;
  }
  const seconds = elapsedSeconds(load.since, Date.now());
  fill(ui.list, h('p', {class: 'muted', role: 'status'}, ctx.t('load.loading', {seconds})), seconds >= 3 ? h('p', 'muted', ctx.t('load.slow')) : null,
    h('div', {class: 'rv-skeletons', 'aria-hidden': 'true'}, ...Array.from({length: 5}, () => h('span', 'skeleton block'))));
}

function renderList(app, host) { keepFocus(host, () => paintList(app, host)); }

/** The queue bar: how much of everything the project has is reviewed (a progressbar, with the numbers in words). */
function progressView(ctx, p) {
  if (!p.total) return null;
  return h('div', {class: 'rv-progress', role: 'progressbar', 'aria-label': ctx.t('progress.label'), 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.done, 'aria-valuetext': ctx.t('progress.text', {done: p.done, total: p.total})},
    h('span', {class: 'rv-progress-fill', style: `width:${p.percent}%`}), h('span', 'rv-progress-text mono', ctx.t('progress.text', {done: p.done, total: p.total})));
}

function paintList(app, host) {
  const {ctx, state} = app;
  const art = app.items, audio = app.audio;
  const showArt = state.kind !== 'audio', showAudio = state.kind !== 'art';
  const all = [...art.map(i => ({...i, _t: 'art'})), ...audio.map(a => ({...a, _t: 'audio'}))];
  const counts = {};
  for (const i of all) counts[i.state] = (counts[i.state] ?? 0) + 1;
  const chip = (group, value, label, count, on) => h('a', {class: 'chip' + (on ? ' is-pressed' : ''), 'aria-current': on ? 'true' : null,
    href: ctx.href(app.route({[group]: value}))}, label, count != null ? h('span', 'n', String(count)) : null);
  const shownArt = showArt ? visibleItems(art, state) : [];
  const shownAudio = showAudio ? audio.filter(a => state.state === 'all' || a.state === state.state) : [];
  const sel = app.selection();
  const agents = [...new Set(art.flatMap(i => i.requests.map(r => r.agent)))];
  const active = (state.state !== 'all' ? 1 : 0) + (state.kind ? 1 : 0) + (state.agent ? 1 : 0);
  const toggle = h('button', {type: 'button', class: 'btn rv-filter-toggle', 'aria-expanded': app.filtersOpen ? 'true' : 'false', 'aria-controls': 'rv-filters'}, ctx.t('inbox.filters'), active ? h('span', 'chip', String(active)) : null);
  toggle.addEventListener('click', () => { app.filtersOpen = !app.filtersOpen; renderList(app, host); toggle.isConnected || host.querySelector('.rv-filter-toggle')?.focus(); });
  const filters = h('div', {class: 'rv-filters' + (app.filtersOpen ? ' open' : ''), id: 'rv-filters'},
    h('nav', {class: 'chips', 'aria-label': ctx.t('inbox.state')}, ...states.map(s => chip('state', s, ctx.t('state.' + s), s === 'all' ? all.length : counts[s] ?? 0, state.state === s))),
    h('nav', {class: 'chips', 'aria-label': ctx.t('inbox.kind')}, chip('kind', null, ctx.t('kind.both'), null, !state.kind), chip('kind', 'art', ctx.t('kind.art'), art.length, state.kind === 'art'), chip('kind', 'audio', ctx.t('kind.audio'), audio.length, state.kind === 'audio')),
    agents.length ? h('nav', {class: 'chips', 'aria-label': ctx.t('inbox.agent')}, chip('agent', null, ctx.t('agent.any'), null, !state.agent), ...agents.map(a => chip('agent', a, a, null, state.agent === a))) : null);
  const empty = all.length ? h('div', 'empty', h('p', 'empty-title', ctx.t('inbox.nothingTitle')), h('p', 'empty-body', ctx.t('inbox.nothingHere')),
      h('a', {class: 'btn', href: ctx.href(app.route({state: 'all', kind: null, agent: null}))}, ctx.t('inbox.showAll')))
    : h('div', 'empty', h('p', 'empty-title', ctx.t('inbox.emptyTitle')), h('p', 'empty-body', ctx.t('inbox.empty')), h('p', 'empty-body', ctx.t('inbox.emptyNext')));
  const ghosts = [...app.ghosts.values()].filter(g => !shownArt.some(i => i.key === g.key));
  fill(host, candidatesSection(app), progressView(ctx, queueProgress(app.artCounts, audio, art)), artCountsView(ctx, app.artCounts), toggle, filters,
    shownArt.length || shownAudio.length || ghosts.length ? h('ul', 'rows', ...ghosts.map(g => artRow(ctx, app, g, sel, true)), ...shownArt.map(i => artRow(ctx, app, i, sel)), ...shownAudio.map(a => audioRow(ctx, app, a, sel))) : empty,
    showArt && ['decided', 'all'].includes(state.state) ? artRecordsView(ctx, app.artRecords) : null);
}

/** Every editable art frame counted once: approved (a human record for these bytes), baseline (no review record), awaiting review. */
function artCountsView(ctx, counts) {
  if (!counts) return null;
  const one = key => h('span', '', h('span', badgeClass(key === 'awaiting' ? 'pending' : key), String(counts[key] ?? 0)), ctx.t('artcount.' + key));
  return h('section', {class: 'artcounts', 'aria-label': ctx.t('artcount.title'), title: ctx.t('artcount.intro')},
    ...['approved', 'baseline', 'awaiting', 'changes_requested'].filter(k => k !== 'changes_requested' || counts[k]).map(one), h('span', 'muted', ctx.t('artcount.total', {total: counts.total})));
}

/** Art a human approved in chat and the project recorded, tied to the exact bytes; shows whether the files still match. */
function artRecordsView(ctx, records) {
  if (!records.length) return null;
  return h('section', {class: 'artrec', 'aria-label': ctx.t('artrec.title')}, h('h3', '', ctx.t('artrec.title')), h('p', 'muted', ctx.t('artrec.intro')),
    h('ul', 'rows', ...records.map(r => h('li', '', h('div', 'row artrow',
      h('span', 'rtext', h('b', {title: r.assetId}, r.assetId), h('small', 'muted', ctx.t('artrec.line', {by: r.approvedBy, date: r.recorded ? r.recorded.slice(0, 10) : ctx.t('approval.noDate'), id: r.approvalId})),
        h('small', r.current ? 'muted' : 'note', r.current ? ctx.t('artrec.current', {n: r.frames + r.rawFiles}) : ctx.t('artrec.changed', {changed: r.changed + r.missing + r.rawChanged, n: r.frames + r.rawFiles, added: r.added ?? 0}) + (r.unverified ? ' ' + ctx.t('artrec.unverified') : ''))),
      h('span', badgeClass(r.current ? 'approved' : 'pending'), ctx.t(r.current ? 'artrec.badge' : 'artrec.badgeStale')))))));
}

function artRow(ctx, app, i, sel, ghost = false) {
  const on = !ghost && sel?.type === 'art' && sel.item.key === i.key;
  const req = i.requests.at(-1);
  return h('li', ghost ? {class: 'ghost', 'aria-hidden': 'true'} : '', h(ghost ? 'div' : 'a', {class: 'row' + (on ? ' on' : '') + (ghost ? ' fading' : ''), 'aria-current': on ? 'true' : null, href: ghost ? null : ctx.href(app.route({}, {item: i}))},
    h('span', 'thumb checker', h('img', {src: `/api/editor/image?key=${encodeURIComponent(i.key)}&revision=${i.head}`, alt: '', loading: 'lazy', draggable: 'false'})),
    h('span', 'rtext', h('b', {title: i.key}, i.key.split('/').at(-1)), h('small', 'muted', `${i.assetId} · r${i.head}`),
      req ? h('small', 'agentline', ctx.t('row.requestedBy', {agent: req.agent, session: req.session})) : null,
      req ? h('small', 'note', req.note) : null),
    h('span', badgeClass(ghost ? 'approved' : i.status), ctx.t('status.' + (ghost ? 'approved' : i.status)))));
}

function audioRow(ctx, app, a, sel) {
  const on = sel?.type === 'audio' && sel.item.id === a.id;
  const status = a.label;
  return h('li', '', h('a', {class: 'row' + (on ? ' on' : ''), 'aria-current': on ? 'true' : null, href: ctx.href(app.route({}, {item: a}))},
    h('span', 'thumb audio-glyph', '♪'),
    h('span', 'rtext', h('b', {title: a.id}, a.id), h('small', 'muted', `${humanize(a.category)} · ${ctx.t('ready.' + a.readiness)}`)),
    h('span', badgeClass(status), ctx.t('signoff.' + status))));
}

const idOf = sel => (sel ? (sel.type === 'art' ? sel.item.key : 'audio:' + sel.item.id) : null);
const activeDraft = ui => { const ta = ui.detail.querySelector('#rv-text, #rv-note'); return !!ta && (ta.value.trim() !== '' || document.activeElement === ta); };

async function paint(ui, {force = false, poll = false} = {}) {
  renderList(app, ui.list);
  const sel = app.selection();
  ui.rv.dataset.view = sel || app.state.asset ? 'detail' : 'list';
  const key = sel ? selKey(sel) : null;
  if (!force && app.painted && key === app.shownKey) return;
  if (!force && app.painted && shouldDeferRepaint({poll, sameItem: idOf(sel) === app.shownId, hasDraft: activeDraft(ui)})) {
    if (!ui.detail.querySelector('.updatenote')) ui.detail.prepend(h('p', {class: 'updatenote', role: 'status'}, app.ctx.t('detail.updated'), ' ', button(app.ctx.t('detail.showUpdate'), () => paint(ui, {force: true}))));
    return;
  }
  const token = ++app.token;
  app.runCleanups();
  app.shownKey = key;
  app.shownId = idOf(sel);
  app.painted = true;
  if (!sel) { fill(ui.detail, h('div', 'empty', h('p', 'empty-title', app.ctx.t(app.state.asset ? 'detail.unknownTitle' : 'detail.noneTitle')), h('p', 'empty-body', app.ctx.t(app.state.asset ? 'detail.unknown' : 'detail.none')))); return; }
  await (sel.type === 'art' ? renderArt(app, ui.detail, sel.item, token) : renderAudio(app, ui.detail, sel.item, token));
}

const selKey = sel => (sel.type === 'art' ? `${sel.item.key}@${sel.item.head}:${sel.item.status}:${sel.item.comments}:${app?.state.rev ?? ''}:${app?.state.zoom}` : `${sel.item.id}:${sel.item.state}:${sel.item.label}`);

export async function mount(ctx, state) {
  ctx.loadCss(new URL('./review.css', import.meta.url));
  ctx.loadCss(new URL('../../seal.css', import.meta.url));
  ctx.root.classList.add('ui-kit');
  const mine = app = makeApp(ctx, state);
  ctx.onUnmount(() => { mine.runCleanups(); for (const fn of mine.always.splice(0)) fn(); mine.undoLast?.dismiss(); clearInterval(mine.timer); clearInterval(mine.ticker); mine.flight?.controller.abort(); });
  mine.ui = layout(ctx);
  const onKey = event => handleKey(mine, event);
  document.addEventListener('keydown', onKey);
  ctx.onUnmount(() => document.removeEventListener('keydown', onKey));
  ctx.root.setAttribute('aria-busy', 'true');
  mine.timer = setInterval(() => { if (!document.hidden) mine.refresh().catch(() => {}); }, POLL_MS);
  try { await mine.refresh({keepSelection: true}); }
  catch (error) { if (error.name === 'AbortError' && ctx.signal.aborted) return; /* any other failure is on screen, with its retry button */ }
  ctx.root.removeAttribute('aria-busy');
}

export async function update(ctx, state) {
  app.state = state;
  await paint(app.ui);
}

export async function unmount() { clearInterval(app?.timer); clearInterval(app?.ticker); app?.flight?.controller.abort(); app?.runCleanups(); }

/** A, R, C, J, K, U. Ignored while typing or with a modifier (shortcutFor); A and R press the visible buttons, so the rules for a disabled button, a missing comment and a non-head revision stay in one place. */
function handleKey(app, event) {
  const action = shortcutFor(event);
  if (!action || !app.ui) return;
  const {detail} = app.ui;
  const press = sel => { const b = detail.querySelector(sel); if (!b || b.disabled) return false; b.click(); return true; };
  if (action === 'approve') { if (press('.decide .approve[data-art]')) event.preventDefault(); }
  else if (action === 'changes') { if (press('.decide .changes[data-art]')) event.preventDefault(); }
  else if (action === 'comment') { const ta = detail.querySelector('#rv-text, #rv-note'); if (ta) { ta.focus(); event.preventDefault(); } }
  else if (action === 'undo') { if (app.undoLast) { app.undoLast.undo(); event.preventDefault(); } }
  else {
    const ids = [...app.ui.list.querySelectorAll('a.row')].map(a => a.getAttribute('href'));
    const here = app.ui.list.querySelector('a.row.on')?.getAttribute('href') ?? null;
    const target = stepId(ids, here, action === 'next' ? 1 : -1);
    if (target) { event.preventDefault(); location.hash = target; }
  }
}
