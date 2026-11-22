// Jobs: what agents are doing now and recently. Polling (every POLL_MS while the page is visible, at once
// when it becomes visible again): the server has no push channel, and a 2 s poll of two small JSON lists
// is cheap on loopback. Running durations and "x s ago" tick locally every second between polls.
import { h, fill } from './dom.mjs';
import { renderQuota } from './quota.mjs';
import { parseRoute as parse, stateParams, states, POLL_MS, jobPhase, durationMs, fmtDuration, sessionId, visibleJobs, groupSessions, visibleEvents, mergeEvents, counts } from './model.mjs';

export { POLL_MS };
export function parseRoute(route) { return parse(route); }

let app;

function makeApp(ctx, state) {
  return {
    ctx, state, events: [], since: 0, jobs: [], jobsAvailable: true, jobsStatus: 200, links: {}, jobAssets: {}, now: Date.now(), skew: 0, signature: '', timer: null, ticker: null, failed: null,
    route(patch = {}, opts = {}) {
      const next = {...this.state, ...patch};
      const job = 'job' in opts ? opts.job : this.state.job;
      return {tab: 'jobs', asset: job, clip: null, direction: null, frame: null, params: stateParams(next)};
    },
    go(patch, opts = {}) { this.ctx.navigate(this.route(patch, opts), {replace: opts.replace}); }
  };
}

const ago = (ctx, iso, now) => {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 2 ? ctx.t('time.now') : s < 60 ? ctx.t('time.seconds', {n: s}) : s < 3600 ? ctx.t('time.minutes', {n: Math.floor(s / 60)}) : ctx.t('time.hours', {n: Math.floor(s / 3600)});
};

const who = x => `${x.agent || '?'} · ${String(x.session).slice(0, 8)}`;

async function poll() {
  const mine = app;
  try {
    const [data, quota] = await Promise.all([mine.ctx.tabApi('feed?since=' + mine.since), mine.ctx.tabApi('quota').catch(() => null)]);
    if (app !== mine) return;
    mine.quota = quota;
    const restarted = data.activity.next < mine.since;
    mine.events = mergeEvents(mine.events, mine.since, data.activity);
    mine.since = restarted ? 0 : data.activity.next;
    mine.jobs = data.jobs.items; mine.jobsAvailable = data.jobs.available; mine.jobsStatus = data.jobs.status; mine.links = data.links; mine.jobAssets = data.jobAssets ?? {};
    mine.skew = data.now - Date.now(); mine.failed = null;
    const signature = JSON.stringify([mine.quota?.all, mine.quota?.recent?.length, mine.jobs.map(j => [j.id, j.status, j.finishedAt, j.logLines]), mine.events.at(-1)?.seq, mine.jobsAvailable, Object.keys(mine.links).length]);
    if (signature !== mine.signature || restarted) { mine.signature = signature; render(mine); }
    if (restarted) return poll();
  } catch (error) {
    if (error.name === 'AbortError' || app !== mine) return;
    mine.failed = error.message; render(mine);
  }
}

function schedule() {
  clearTimeout(app.timer);
  const mine = app;
  mine.timer = setTimeout(async () => { if (!document.hidden) await poll(); if (app === mine) schedule(); }, POLL_MS);
}

function segButton(app, group, value, label, on) {
  const b = h('button', {type: 'button', 'aria-pressed': on ? 'true' : 'false'}, label);
  b.addEventListener('click', () => app.go({[group]: value}));
  return b;
}

function retryBox(app) {
  const b = h('button', {type: 'button', class: 'btn primary'}, app.ctx.t('common.retry'));
  b.addEventListener('click', () => poll());
  return h('div', {class: 'empty', role: 'alert'}, h('p', 'empty-body', app.ctx.t('common.error', {message: app.failed})), b);
}

const empty = text => h('p', 'empty', text);

function assetLink(app, j) {
  const category = app.jobAssets[j.assetId];
  return j.assetId ? (category ? h('a', {class: 'chip', title: j.assetId, href: app.ctx.href({tab: app.ctx.categoryTab(category), asset: j.assetId, params: {}})}, j.assetId) : h('code', {class: 'muted', title: j.assetId}, j.assetId)) : h('span', 'muted', '–');
}

const PHASE_CHIP = {running: ' ok', queued: ' warn', failed: ' danger', done: ''};
function badge(ctx, phase) { return h('span', 'chip' + PHASE_CHIP[phase], ctx.t('phase.' + phase)); }

function linkChips(ctx, link) {
  if (!link) return null;
  const assets = link.assets.map(a => h('a', {class: 'chip', href: ctx.href({tab: ctx.categoryTab(a.category), asset: a.id, params: {}}), title: a.id + ' · ' + ctx.t('link.asset.' + a.via)}, a.id));
  const reviews = link.reviews.map(r => h('a', {class: 'chip warn', href: ctx.href({tab: 'review', asset: r.assetId, params: {key: r.key}}), title: ctx.t('link.review')}, r.key.split('/').at(-1) + ' · r' + r.revision));
  return assets.length || reviews.length ? h('div', 'links', ...assets, ...reviews) : null;
}

function render(app) {
  const {ctx, state, ui} = app;
  const now = Date.now() + app.skew;
  const c = counts(app.jobs, app.events);
  const stat = (key, value, tone) => h('div', 'stat' + (tone ? ' ' + tone : ''), h('span', 'stat-label', ctx.t(key)), h('span', 'stat-value', String(value)));
  const sessions = groupSessions(app.events, app.jobs);
  const tools = [...new Set([...app.events.map(e => e.tool), ...app.jobs.map(j => j.name)])].sort();
  const jobs = visibleJobs(app.jobs, state);
  const calls = visibleEvents(app.events, state).slice(0, 60);
  fill(ui.stats, stat('stat.running', c.running, c.running ? 'ok' : ''), stat('stat.queued', c.queued), stat('stat.failedJobs', c.failed, c.failed ? 'danger' : ''), stat('stat.calls', c.calls), stat('stat.failedCalls', c.failedCalls, c.failedCalls ? 'danger' : ''));
  fill(ui.status, h('span', {class: 'pulse' + (app.failed ? ' down' : ''), 'aria-hidden': 'true'}),
    h('span', {class: 'muted', role: 'status'}, app.failed ? ctx.t('live.failed', {message: app.failed}) : ctx.t('live.ok', {seconds: POLL_MS / 1000})));
  fill(ui.banner, ...(app.jobsAvailable ? [] : [h('p', {class: 'banner', role: 'status'}, ctx.t('jobs.unavailable'))]));
  fill(ui.filters, h('div', {class: 'seg', role: 'group', 'aria-label': ctx.t('filter.state')}, ...states.map(s => segButton(app, 'state', s, ctx.t('state.' + s), state.state === s))),
    tools.length ? h('label', 'toolsel', h('span', 'sr-only', ctx.t('filter.tool')), (() => {
      const sel = h('select', {class: 'field', 'aria-label': ctx.t('filter.tool')}, h('option', {value: ''}, ctx.t('filter.anyTool')), ...tools.map(t => h('option', {value: t, selected: state.tool === t ? 'selected' : null}, t)));
      sel.addEventListener('change', () => app.go({tool: sel.value || null}));
      return sel;
    })()) : null,
    state.session ? (() => { const b = h('button', {type: 'button', class: 'chip', 'aria-pressed': 'true', title: state.session.replace('|', ' · ')}, ctx.t('filter.session', {who: state.session.replace('|', ' · ')}), ' ×'); b.addEventListener('click', () => app.go({session: null})); return b; })() : null);
  fill(ui.sessions, ...(sessions.length ? sessions.map(g => h('article', 'slip agent' + (state.session === g.id ? ' is-pressed' : ''),
    h('header', '', h('a', {href: ctx.href(app.route({session: state.session === g.id ? null : g.id})), 'aria-current': state.session === g.id ? 'true' : null}, h('b', '', g.agent || '?'), h('code', {title: g.session}, g.session)),
      g.running ? h('span', 'chip ok', ctx.t('card.running', {n: g.running})) : null),
    h('p', 'muted', ctx.t('card.summary', {calls: g.calls, failures: g.failures}), ' · ', h('span', {'data-ago': g.lastTs}, g.lastTs ? ago(ctx, g.lastTs, now) : '–')),
    h('p', 'toolsline', ...Object.entries(g.tools).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => h('span', 'tool', `${t} ×${n}`))),
    linkChips(ctx, app.links[g.id]))) : [empty(ctx.t('sessions.none'))]));
  fill(ui.jobs, jobs.length ? h('table', 'tbl', h('caption', 'sr-only', ctx.t('jobs.title')),
    h('thead', '', h('tr', '', ...['col.state', 'col.tool', 'col.asset', 'col.agent', 'col.started', 'col.duration'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
    h('tbody', '', ...jobs.map(j => {
      const phase = jobPhase(j), live = !j.finishedAt;
      const dur = h('td', 'num', h('span', live ? {'data-live': j.startedAt ?? j.createdAt} : {}, fmtDuration(durationMs(j, now))), phase === 'queued' ? h('small', 'muted', ' ' + ctx.t('job.waiting')) : null);
      return h('tr', {class: state.job === j.id ? 'on' : ''}, h('td', '', badge(ctx, phase)),
        h('td', '', h('a', {href: ctx.href(app.route({}, {job: j.id})), 'aria-current': state.job === j.id ? 'true' : null, title: j.name}, h('code', '', j.name))),
        h('td', '', assetLink(app, j)),
        h('td', '', h('a', {href: ctx.href(app.route({session: sessionId(j.owner)}, {job: state.job})), title: who(j.owner)}, who(j.owner))),
        h('td', 'muted', j.startedAt ? ago(ctx, j.startedAt, now) : ago(ctx, j.createdAt, now)), dur);
    }))) : app.failed && !app.jobs.length && !app.events.length ? retryBox(app) : empty(app.jobsAvailable ? ctx.t('jobs.none') : ctx.t('jobs.noneUnavailable')));
  fill(ui.calls, calls.length ? h('table', 'tbl', h('caption', 'sr-only', ctx.t('calls.title')),
    h('thead', '', h('tr', '', ...['col.time', 'col.tool', 'col.agent', 'col.outcome', 'col.duration'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
    h('tbody', '', ...calls.map(e => h('tr', '', h('td', 'muted mono', e.ts.slice(11, 19)), h('td', '', h('code', '', e.tool)),
      h('td', '', h('a', {href: ctx.href(app.route({session: sessionId(e)}, {job: state.job})), title: who(e)}, who(e))),
      h('td', '', h('span', 'chip' + (e.ok ? '' : ' danger'), ctx.t(e.ok ? 'outcome.ok' : 'outcome.failed'))), h('td', 'num', fmtDuration(e.ms)))))) : empty(ctx.t('calls.none')));
  renderQuota(ctx, ui.quota, app.quota);
  renderDetail(app, now);
}

function renderDetail(app, now) {
  const {ctx, state, ui} = app;
  ui.layout.dataset.detail = state.job ? 'open' : '';
  if (!state.job) return fill(ui.detail, empty(ctx.t('detail.none')));
  const j = app.jobs.find(x => x.id === state.job);
  if (!j) return fill(ui.detail, h('p', {class: 'empty', role: 'status'}, app.jobsAvailable ? ctx.t('detail.gone', {id: state.job}) : ctx.t('jobs.noneUnavailable')));
  const phase = jobPhase(j), live = !j.finishedAt, link = app.links[sessionId(j.owner)];
  fill(ui.detail, 
    h('a', {class: 'btn quiet back', href: ctx.href(app.route({}, {job: null}))}, '← ' + ctx.t('detail.back')),
    h('header', 'dhead', h('div', '', h('h2', {title: j.name}, j.name), h('code', {title: j.id}, j.id)), badge(ctx, phase),
      h('a', {class: 'x', href: ctx.href(app.route({}, {job: null})), 'aria-label': ctx.t('detail.close')}, '×')),
    h('dl', 'kv', h('dt', '', ctx.t('detail.asset')), h('dd', '', j.assetId ? assetLink(app, j) : h('span', 'muted', ctx.t('detail.noAsset'))), h('dt', '', ctx.t('detail.agent')), h('dd', '', h('a', {href: ctx.href(app.route({session: sessionId(j.owner)}, {job: j.id}))}, who(j.owner))),
      h('dt', '', ctx.t('detail.created')), h('dd', '', j.createdAt.replace('T', ' ').slice(0, 19)),
      h('dt', '', ctx.t('detail.started')), h('dd', '', j.startedAt ? j.startedAt.replace('T', ' ').slice(0, 19) : '–'),
      h('dt', '', ctx.t('detail.finished')), h('dd', '', j.finishedAt ? j.finishedAt.replace('T', ' ').slice(0, 19) : '–'),
      h('dt', '', ctx.t('detail.duration')), h('dd', '', h('span', live ? {'data-live': j.startedAt ?? j.createdAt} : {}, fmtDuration(durationMs(j, now))))),
    j.error ? h('p', {class: 'errline', role: 'alert'}, ctx.t('detail.error', {message: j.error.message})) : null,
    h('section', 'dsec', h('h3', '', ctx.t('detail.touched')), linkChips(ctx, link) ?? h('p', 'muted', ctx.t('detail.noLinks')), h('p', 'muted note', ctx.t('detail.linksNote'))),
    h('section', 'dsec', h('h3', '', ctx.t('detail.log', {shown: j.log.length, total: j.logLines})), j.log.length ? h('pre', 'log', j.log.join('\n')) : h('p', 'muted', ctx.t('detail.noLog'))));
}

function tickLocal(app) {
  const now = Date.now() + app.skew;
  for (const el of app.ctx.root.querySelectorAll('[data-live]')) el.textContent = fmtDuration(now - Date.parse(el.getAttribute('data-live')));
  for (const el of app.ctx.root.querySelectorAll('[data-ago]')) { const t = el.getAttribute('data-ago'); if (t) el.textContent = ago(app.ctx, t, now); }
}

function layout(ctx) {
  const ui = {quota: h('section', 'sec quota'), status: h('div', 'live'), stats: h('div', 'stats'), banner: h('div'), filters: h('div', 'filters'), sessions: h('div', 'agents'), jobs: h('div', 'tblwrap'), calls: h('div', 'tblwrap'),
    detail: h('aside', {class: 'detail', 'aria-label': ctx.t('detail.label')})};
  const skeleton = () => h('span', 'skeleton block');
  fill(ui.stats, skeleton(), skeleton(), skeleton());
  ui.layout = h('div', 'jb', h('div', 'main', ui.quota, h('section', 'sec', h('h2', '', ctx.t('sessions.title')), ui.sessions), h('section', 'sec', h('h2', '', ctx.t('jobs.title')), ui.jobs), h('section', 'sec', h('h2', '', ctx.t('calls.title')), ui.calls)), ui.detail);
  fill(ctx.root,
    h('header', 'jb-head', h('div', '', h('h1', '', ctx.t('title')), h('p', 'muted', ctx.t('subtitle'))), ui.status),
    ui.filters, ui.stats, ui.banner, ui.layout);
  return ui;
}

export async function mount(ctx, state) {
  ctx.root.classList.add('ui-kit');
  ctx.loadCss(new URL('../../components.css', import.meta.url));
  ctx.loadCss(new URL('./jobs.css', import.meta.url));
  const mine = app = makeApp(ctx, state);
  mine.ui = layout(ctx);
  ctx.root.setAttribute('aria-busy', 'true');
  await poll();
  ctx.root.removeAttribute('aria-busy');
  if (app !== mine) return;
  if (mine.failed && !mine.events.length) { render(mine); }
  schedule();
  mine.ticker = setInterval(() => tickLocal(mine), 1000);
  const onVisible = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVisible);
  ctx.onUnmount(() => { clearTimeout(mine.timer); clearInterval(mine.ticker); document.removeEventListener('visibilitychange', onVisible); });
}

export async function update(ctx, state) {
  app.state = state;
  render(app);
}

export async function unmount() { clearTimeout(app?.timer); clearInterval(app?.ticker); app = undefined; }
