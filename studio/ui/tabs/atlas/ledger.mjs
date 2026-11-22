// The licence and provenance ledger and the AI disclosure: facts from what the project recorded, "not recorded" where nothing is, and what a human must decide.
import { h, button, fill } from './dom.mjs';
import { badge, failure } from './common.mjs';
import { filterLedger } from './model.mjs';

const ROWS = 200;

export async function loadLedger(app) {
  const key = app.ctx.lang;
  if (!app.ledger || app.ledgerLang !== key) { app.ledgerLang = key; app.ledger = app.ctx.tabApi('ledger?lang=' + key); }
  try { return await app.ledger; } catch (error) { app.ledger = null; throw error; }
}

export async function renderLedger(app, sel, box) {
  const {ctx, state} = app;
  let ledger;
  try { ledger = await loadLedger(app); } catch (error) { return fill(box, failure(ctx, error)); }
  const nr = ctx.t('ledger.notRecorded');
  const rows = filterLedger(ledger.assets, {origin: state.origin, text: state.ledgerQ});
  const shown = rows.slice(0, ROWS);
  const dl = (format, lang) => h('a', {class: 'button-link', href: `/api/tabs/atlas/ledger?${new URLSearchParams({format, lang, download: '1'})}`, download: ''}, ctx.t('ledger.download.' + format, {lang: lang.toUpperCase()}));
  const copy = button(ctx.t('ledger.copy'), async () => { try { await navigator.clipboard.writeText(ledger.disclosure.text); ctx.announce(ctx.t('ledger.copied')); } catch { ctx.announce(ctx.t('ledger.copyFailed')); } });
  const chip = (origin, label, count) => h('a', {class: 'chip' + ((state.origin ?? '') === (origin ?? '') ? ' on' : ''), 'aria-current': (state.origin ?? '') === (origin ?? '') ? 'true' : null, href: ctx.href(app.route({origin}))}, label, h('span', 'n', String(count)));
  const search = h('input', {type: 'search', class: 'search', value: state.ledgerQ, 'aria-label': ctx.t('ledger.search'), placeholder: ctx.t('ledger.search')});
  search.addEventListener('change', () => app.go({ledgerQ: search.value.trim()}));
  const field = (value, need) => value == null || value === '' ? (need ? h('span', 'nr', nr) : '') : String(value);
  fill(box,
    h('section', 'sec', h('h2', '', ctx.t('ledger.disclosure')), h('pre', 'disclosure', ledger.disclosure.text), h('div', 'actions', copy, dl('md', 'en'), dl('md', 'vi'), dl('json', ctx.lang))),
    h('section', 'sec', h('h2', '', ctx.t('ledger.decisions')),
      ledger.decisions.length ? h('ul', 'decisions', ...ledger.decisions.flatMap(d => d.flags.map(f => h('li', '', h('b', '', d.id), d.count ? ` (${d.count})` : '', ': ', f)))) : h('p', 'muted', ctx.t('ledger.noDecisions'))),
    h('section', 'sec', h('h2', '', ctx.t('ledger.components')),
      h('div', 'tblwrap', h('table', 'tbl', h('thead', '', h('tr', '', ...['ledger.col.tool', 'ledger.col.role', 'ledger.col.licence', 'ledger.col.pin', 'ledger.col.ships', 'ledger.col.usedBy', 'ledger.col.evidence'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
        h('tbody', '', ...ledger.components.map(c => h('tr', '', h('th', {scope: 'row'}, c.name, c.mustNotShip ? [' ', badge(ctx.t('ledger.mustNotShip'), 'bad')] : null), h('td', '', c.role ? ctx.label(c.role) : ''),
          h('td', '', c.licence === 'not recorded' ? h('span', 'nr', nr) : c.licence), h('td', 'mono', c.pin ?? nr), h('td', '', c.ships ?? ''), h('td', 'num', String(c.usedBy)),
          h('td', 'mono', c.evidence.map(e => e.path + (e.exists ? '' : ' ✗')).join(', ') || nr)))))),
      h('p', 'muted', ledger.fonts.files.length ? ctx.t('ledger.fonts.some', {files: ledger.fonts.files.join(', ')}) : ctx.t('ledger.fonts.none', {roots: ledger.fonts.scanned.join(', ')})),
      h('p', 'muted', ctx.t('ledger.thirdParty', {file: ledger.thirdPartySources.file ?? '–', state: ctx.t(ledger.thirdPartySources.present ? 'ledger.present' : 'ledger.absent')}))),
    h('section', 'sec', h('h2', '', ctx.t('ledger.assets')),
      h('div', 'toolbar', h('nav', {class: 'chips', 'aria-label': ctx.t('ledger.origin')}, chip(null, ctx.t('ledger.all'), ledger.assets.length),
        ...Object.entries(ledger.summary.counts).filter(([, n]) => n).map(([k, n]) => chip(k, ctx.t('ledger.kind.' + k), n))), h('label', 'searchbox', search)),
      h('div', 'tblwrap', h('table', 'tbl', h('thead', '', h('tr', '', ...['ledger.col.asset', 'ledger.col.origin', 'ledger.col.tool', 'ledger.col.script', 'ledger.col.seed', 'ledger.col.prompt', 'ledger.col.rights', 'ledger.col.evidence'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
        h('tbody', '', ...shown.map(a => {
          const o = a.origin, need = new Set(a.missing), tab = a.category ? ctx.categoryTab(a.category) : null;
          return h('tr', '', h('th', {scope: 'row'}, tab ? h('a', {href: ctx.href({tab, asset: a.id, params: a.source && a.source !== 'core' ? {source: a.source} : {}})}, h('code', '', a.id)) : h('code', '', a.id)),
            h('td', '', o.kind === 'not-recorded' ? h('span', 'nr', nr) : badge(ctx.t('ledger.kind.' + o.kind), o.kind === 'retired-tool' ? 'warn' : 'muted')),
            h('td', '', field(o.tool, need.has('tool'))), h('td', 'mono', field(o.script ?? o.document, need.has('script') || need.has('document'))), h('td', 'mono', field(o.seed, need.has('seed'))),
            h('td', 'mono', field(o.promptHash ? o.promptHash.slice(0, 12) : null, need.has('promptHash'))), h('td', '', a.rights ?? (a.recorded ? h('span', 'nr', nr) : '')),
            h('td', 'mono', a.evidence.join(', ') || h('span', 'nr', nr)));
        })))),
      rows.length > ROWS ? h('p', 'muted', ctx.t('ledger.more', {shown: ROWS, total: rows.length})) : null));
}
