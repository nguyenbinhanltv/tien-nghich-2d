// Review: one inbox for everything that waits on the human, art and audio. Art decisions go to the
// existing /api/editor/review route; the listening sign-off goes to this tab's one human-only route.
// The inbox polls every POLL_MS while the page is visible (and refreshes after every decision). A new request cancels the one still
// running, so slow answers never pile up; while one runs the page says so, with the seconds it has waited, and a failure keeps the
// last list on screen with a retry button.
import { h, button, humanize, fill } from './dom.mjs';
import { parseRoute as parse, stateParams, parseKey, visibleItems, countsByState, states, shouldDeferRepaint, clock, elapsedSeconds } from './model.mjs';
import { renderArt } from './art.mjs';
import { renderAudio } from './audio.mjs';
import { candidatesSection } from './takes.mjs';

export const POLL_MS = 10000;
export function parseRoute(route) { return parse(route); }

let app;

function makeApp(ctx, state) {
  const self = {
    ctx, state, items: [], audio: [], artRecords: [], drafts: new Map(), token: 0, signature: '', timer: null, cleanups: [], flight: null, load: {phase: 'idle', since: 0, error: null, updatedAt: null}, loaded: false,
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
    go(patch, opts = {}) { self.ctx.navigate(self.route(patch, opts), {replace: opts.replace}); },
    /** Show the loading / error / last-updated line and, before any list has arrived, the skeleton or the error with its retry button. */
    setLoad(patch) {
      Object.assign(self.load, patch);
      clearInterval(self.ticker);
      if (self.load.phase === 'loading') self.ticker = setInterval(() => renderStatus(self), 1000);
      renderStatus(self);
    },
    refresh({keepSelection = false} = {}) {
      // a request still running is cancelled by the new one; a repaint it was owed (after a decision) passes on to the new one
      const previous = self.flight;
      const keep = keepSelection || Boolean(previous?.keep);
      previous?.controller.abort();
      const controller = new AbortController();
      const flight = self.flight = {controller, keep};
      flight.promise = self.fetchInbox(flight, AbortSignal.any([self.ctx.signal, controller.signal]), keep).catch(error => {
        if (error.name === 'AbortError' && !self.ctx.signal.aborted && self.flight && self.flight !== flight) return self.flight.promise; // superseded
        throw error;
      });
      return flight.promise;
    },
    async fetchInbox(flight, signal, keepSelection) {
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
        if (!keepSelection && changed) self.ctx.announce(self.ctx.t('inbox.changed', {count: waiting}));
      }
      return changed;
    }
  };
  return self;
}

function layout(ctx) {
  const list = h('div', 'inbox'), detail = h('section', {class: 'detail', 'aria-label': ctx.t('detail.label')});
  fill(ctx.root, h('header', 'rv-head', h('div', '', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle'))),
    h('div', 'live', h('span', {class: 'pulse', 'aria-hidden': 'true'}), h('span', 'muted', ctx.t('live', {seconds: POLL_MS / 1000})),
      h('span', {class: 'muted rv-stamp', 'data-role': 'stamp'}), h('span', {class: 'rv-wait', 'data-role': 'wait', 'aria-hidden': 'true'}),
      h('span', {class: 'rv-fail', 'data-role': 'fail'}))),
    h('div', 'rv', h('aside', {class: 'side', 'aria-label': ctx.t('inbox.label')}, list), detail));
  return {list, detail};
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
    fill(ui.list, h('div', 'rv-error', h('p', {role: 'alert'}, ctx.t('load.error', {message: load.error})), button(ctx.t('common.retry'), () => app.refresh().catch(() => {}))));
    return;
  }
  const seconds = elapsedSeconds(load.since, Date.now());
  fill(ui.list, h('p', {class: 'muted', role: 'status'}, ctx.t('load.loading', {seconds})), seconds >= 3 ? h('p', 'muted', ctx.t('load.slow')) : null,
    h('ul', {class: 'rows skeleton', 'aria-hidden': 'true'}, ...Array.from({length: 5}, () => h('li', '', h('div', 'row', h('span', 'thumb sk'), h('span', 'rtext', h('b', 'sk bar'), h('small', 'sk bar short')))))));
}

function renderList(app, host) {
  const {ctx, state} = app;
  const art = app.items, audio = app.audio;
  const showArt = state.kind !== 'audio', showAudio = state.kind !== 'art';
  const all = [...art.map(i => ({...i, _t: 'art'})), ...audio.map(a => ({...a, _t: 'audio'}))];
  const counts = {};
  for (const i of all) counts[i.state] = (counts[i.state] ?? 0) + 1;
  const chip = (group, value, label, count, on) => h('a', {class: 'chip' + (on ? ' on' : ''), 'aria-current': on ? 'true' : null,
    href: ctx.href(app.route({[group]: value}))}, label, count != null ? h('span', 'n', String(count)) : null);
  const shownArt = showArt ? visibleItems(art, state) : [];
  const shownAudio = showAudio ? audio.filter(a => state.state === 'all' || a.state === state.state) : [];
  const sel = app.selection();
  const agents = [...new Set(art.flatMap(i => i.requests.map(r => r.agent)))];
  fill(host, candidatesSection(app), artCountsView(ctx, app.artCounts),
    h('nav', {class: 'chips', 'aria-label': ctx.t('inbox.state')}, ...states.map(s => chip('state', s, ctx.t('state.' + s), s === 'all' ? all.length : counts[s] ?? 0, state.state === s))),
    h('nav', {class: 'chips', 'aria-label': ctx.t('inbox.kind')}, chip('kind', null, ctx.t('kind.both'), null, !state.kind), chip('kind', 'art', ctx.t('kind.art'), art.length, state.kind === 'art'), chip('kind', 'audio', ctx.t('kind.audio'), audio.length, state.kind === 'audio')),
    agents.length ? h('nav', {class: 'chips', 'aria-label': ctx.t('inbox.agent')}, chip('agent', null, ctx.t('agent.any'), null, !state.agent), ...agents.map(a => chip('agent', a, a, null, state.agent === a))) : null,
    shownArt.length || shownAudio.length ? h('ul', 'rows', ...shownArt.map(i => artRow(ctx, app, i, sel)), ...shownAudio.map(a => audioRow(ctx, app, a, sel)))
      : h('p', 'muted empty', ctx.t(all.length ? 'inbox.nothingHere' : 'inbox.empty')),
    showArt && ['decided', 'all'].includes(state.state) ? artRecordsView(ctx, app.artRecords) : null);
}

/** Every editable art frame counted once: approved (a human record for these bytes), baseline (no review record), awaiting review. */
function artCountsView(ctx, counts) {
  if (!counts) return null;
  const one = key => h('span', '', h('span', 'badge s-' + (key === 'awaiting' ? 'pending' : key), String(counts[key] ?? 0)), ctx.t('artcount.' + key));
  return h('section', {class: 'artcounts', 'aria-label': ctx.t('artcount.title'), title: ctx.t('artcount.intro')},
    ...['approved', 'baseline', 'awaiting', 'changes_requested'].filter(k => k !== 'changes_requested' || counts[k]).map(one), h('span', 'muted', ctx.t('artcount.total', {total: counts.total})));
}

/** Art a human approved in chat and the project recorded, tied to the exact bytes; shows whether the files still match. */
function artRecordsView(ctx, records) {
  if (!records.length) return null;
  return h('section', {class: 'artrec', 'aria-label': ctx.t('artrec.title')}, h('h3', '', ctx.t('artrec.title')), h('p', 'muted', ctx.t('artrec.intro')),
    h('ul', 'rows', ...records.map(r => h('li', '', h('div', 'row artrow',
      h('span', 'rtext', h('b', '', r.assetId), h('small', 'muted', ctx.t('artrec.line', {by: r.approvedBy, date: r.recorded ? r.recorded.slice(0, 10) : ctx.t('approval.noDate'), id: r.approvalId})),
        h('small', r.current ? 'muted' : 'note', r.current ? ctx.t('artrec.current', {n: r.frames + r.rawFiles}) : ctx.t('artrec.changed', {changed: r.changed + r.missing + r.rawChanged, n: r.frames + r.rawFiles, added: r.added ?? 0}) + (r.unverified ? ' ' + ctx.t('artrec.unverified') : ''))),
      h('span', 'badge s-' + (r.current ? 'approved' : 'pending'), ctx.t(r.current ? 'artrec.badge' : 'artrec.badgeStale')))))));
}

function artRow(ctx, app, i, sel) {
  const on = sel?.type === 'art' && sel.item.key === i.key;
  const req = i.requests.at(-1);
  return h('li', '', h('a', {class: 'row' + (on ? ' on' : ''), 'aria-current': on ? 'true' : null, href: ctx.href(app.route({}, {item: i}))},
    h('span', 'thumb checker', h('img', {src: `/api/editor/image?key=${encodeURIComponent(i.key)}&revision=${i.head}`, alt: '', loading: 'lazy', draggable: 'false'})),
    h('span', 'rtext', h('b', '', i.key.split('/').at(-1)), h('small', 'muted', `${i.assetId} · r${i.head}`),
      req ? h('small', 'agentline', ctx.t('row.requestedBy', {agent: req.agent, session: req.session})) : null,
      req ? h('small', 'note', req.note) : null),
    h('span', 'badge s-' + i.status, ctx.t('status.' + i.status))));
}

function audioRow(ctx, app, a, sel) {
  const on = sel?.type === 'audio' && sel.item.id === a.id;
  const status = a.label;
  return h('li', '', h('a', {class: 'row' + (on ? ' on' : ''), 'aria-current': on ? 'true' : null, href: ctx.href(app.route({}, {item: a}))},
    h('span', 'thumb audio-glyph', '♪'),
    h('span', 'rtext', h('b', '', a.id), h('small', 'muted', `${humanize(a.category)} · ${ctx.t('ready.' + a.readiness)}`)),
    h('span', 'badge s-' + status, ctx.t('signoff.' + status))));
}

const idOf = sel => (sel ? (sel.type === 'art' ? sel.item.key : 'audio:' + sel.item.id) : null);
const activeDraft = ui => { const ta = ui.detail.querySelector('#rv-text, #rv-note'); return !!ta && (ta.value.trim() !== '' || document.activeElement === ta); };

async function paint(ui, {force = false, poll = false} = {}) {
  renderList(app, ui.list);
  const sel = app.selection();
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
  if (!sel) { fill(ui.detail, h('p', 'muted pad', app.state.asset ? app.ctx.t('detail.unknown') : app.ctx.t('detail.none'))); return; }
  await (sel.type === 'art' ? renderArt(app, ui.detail, sel.item, token) : renderAudio(app, ui.detail, sel.item, token));
}

const selKey = sel => (sel.type === 'art' ? `${sel.item.key}@${sel.item.head}:${sel.item.status}:${sel.item.comments}:${app?.state.rev ?? ''}:${app?.state.zoom}` : `${sel.item.id}:${sel.item.state}:${sel.item.label}`);

export async function mount(ctx, state) {
  ctx.loadCss(new URL('./review.css', import.meta.url));
  const mine = app = makeApp(ctx, state);
  ctx.onUnmount(() => { mine.runCleanups(); clearInterval(mine.timer); clearInterval(mine.ticker); mine.flight?.controller.abort(); });
  mine.ui = layout(ctx);
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
