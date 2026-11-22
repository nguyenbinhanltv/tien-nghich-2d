// The licence and provenance ledger and the AI disclosure: facts from what the project recorded, "not recorded" where nothing is, and what a human must decide.
import { h, button, fill } from './dom.mjs';
import { badge, failure } from './common.mjs';
import { filterLedger, GAPS } from './model.mjs';
import { handoffSection, rulesSection } from './handoff.mjs';

const ROWS = 200;
const FIELDS = ['tool', 'toolPin', 'producer', 'script', 'scriptSha256', 'seed', 'promptHash', 'sourceHash', 'method', 'agent', 'document'];
const STATUSES = ['filled', 'unknown', 'not-applicable', 'not-produced', 'open'];

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
  const rows = filterLedger(ledger.assets, {origin: state.origin, text: state.ledgerQ, gap: state.gap});
  const shown = rows.slice(0, ROWS);
  const dl = (format, lang) => h('a', {class: 'button-link', href: `/api/tabs/atlas/ledger?${new URLSearchParams({format, lang, download: '1'})}`, download: ''}, ctx.t('ledger.download.' + format, {lang: lang.toUpperCase()}));
  const copy = button(ctx.t('ledger.copy'), async () => { try { await navigator.clipboard.writeText(ledger.disclosure.text); ctx.announce(ctx.t('ledger.copied')); } catch { ctx.announce(ctx.t('ledger.copyFailed')); } });
  const chip = (origin, label, count) => h('a', {class: 'chip' + ((state.origin ?? '') === (origin ?? '') ? ' on' : ''), 'aria-current': (state.origin ?? '') === (origin ?? '') ? 'true' : null, href: ctx.href(app.route({origin}))}, label, h('span', 'n', String(count)));
  const search = h('input', {type: 'search', class: 'search', value: state.ledgerQ, 'aria-label': ctx.t('ledger.search'), placeholder: ctx.t('ledger.search')});
  search.addEventListener('change', () => app.go({ledgerQ: search.value.trim()}));
  const gapChip = (gap, label) => h('a', {class: 'chip' + ((state.gap ?? '') === (gap ?? '') ? ' on' : ''), 'aria-current': (state.gap ?? '') === (gap ?? '') ? 'true' : null, href: ctx.href(app.route({gap}))}, label);
  const reasonOf = (a, name) => a.reasons?.[name];
  const field = (a, name, value) => value == null || value === '' ? (reasonOf(a, name) ? h('span', {class: 'nr', title: reasonOf(a, name).reason}, ctx.t('ledger.status.' + reasonOf(a, name).status)) : h('span', 'nr', a.missing.includes(name) || a.open.includes(name) ? ctx.t('ledger.status.open') : '')) : String(value);
  const details = a => h('details', {class: 'origin-details'}, h('summary', '', ctx.t('ledger.detail'), a.open.length ? [' ', badge(String(a.open.length), 'bad')] : null),
    a.intent ? h('p', 'muted', h('b', '', ctx.t('ledger.intent') + ': '), ctx.label(a.intent)) : null,
    h('dl', 'origin-fields', ...FIELDS.flatMap(name => [h('dt', '', ctx.t('ledger.field.' + name), a.filled.includes(name) ? [' ', h('small', 'muted', '(' + ctx.t('ledger.filledHere') + ')')] : null),
      h('dd', 'mono', a.origin[name] != null && a.origin[name] !== '' ? String(a.origin[name]) : reasonOf(a, name) ? [h('b', '', ctx.t('ledger.status.' + reasonOf(a, name).status)), ': ', reasonOf(a, name).reason] : h('span', 'nr', ctx.t('ledger.status.open')))])));
  const stats = ledger.summary.fieldStats;
  fill(box,
    h('section', 'sec', h('h2', '', ctx.t('ledger.disclosure')), h('pre', 'disclosure', ledger.disclosure.text), h('div', 'actions', copy, dl('md', 'en'), dl('md', 'vi'), dl('json', ctx.lang))),
    rulesSection(ctx, ledger.rules),
    handoffSection(app),
    h('section', 'sec', h('h2', '', ctx.t('ledger.decisions')),
      ledger.decisions.length ? h('ul', 'decisions', ...ledger.decisions.flatMap(d => d.flags.map(f => h('li', '', h('b', '', d.id), d.count ? ` (${d.count})` : '', ': ', f)))) : h('p', 'muted', ctx.t('ledger.noDecisions'))),
    h('section', 'sec', h('h2', '', ctx.t('ledger.components')),
      h('div', 'tblwrap', h('table', 'tbl', h('thead', '', h('tr', '', ...['ledger.col.tool', 'ledger.col.role', 'ledger.col.licence', 'ledger.col.pin', 'ledger.col.ships', 'ledger.col.usedBy', 'ledger.col.evidence'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
        h('tbody', '', ...ledger.components.map(c => h('tr', '', h('th', {scope: 'row'}, c.name, c.mustNotShip ? [' ', badge(ctx.t('ledger.mustNotShip'), 'bad')] : null), h('td', '', c.role ? ctx.label(c.role) : ''),
          h('td', '', c.licence === 'not recorded' ? h('span', 'nr', nr) : c.licence), h('td', 'mono', c.pin ?? nr), h('td', '', c.ships ?? ''), h('td', 'num', String(c.usedBy)),
          h('td', 'mono', c.evidence.map(e => e.path + (e.exists ? '' : ' ✗')).join(', ') || nr)))))),
      h('p', 'muted', ledger.fonts.files.length ? ctx.t('ledger.fonts.some', {files: ledger.fonts.files.join(', ')}) : ctx.t('ledger.fonts.none', {roots: ledger.fonts.scanned.join(', ')})),
      h('p', 'muted', ctx.t('ledger.thirdParty', {file: ledger.thirdPartySources.file ?? '–', state: ctx.t(ledger.thirdPartySources.present ? 'ledger.present' : 'ledger.absent')}))),
    stats ? h('section', 'sec', h('h2', '', ctx.t('ledger.fields.title')), h('p', 'muted', ctx.t('ledger.fields.intro')),
      h('div', 'tblwrap', h('table', 'tbl', h('thead', '', h('tr', '', h('th', {scope: 'col'}, ctx.t('ledger.fields.field')), ...STATUSES.map(st => h('th', {scope: 'col'}, ctx.t('ledger.status.' + st))))),
        h('tbody', '', ...FIELDS.map(name => h('tr', '', h('th', {scope: 'row'}, ctx.t('ledger.field.' + name)), ...STATUSES.map(st => h('td', 'num', String(stats[name][st] ?? 0))))))))) : null,
    h('section', 'sec', h('h2', '', ctx.t('ledger.assets')),
      h('div', 'toolbar', h('nav', {class: 'chips', 'aria-label': ctx.t('ledger.gap.label')}, h('span', 'muted', ctx.t('ledger.gap.label') + ': '), gapChip(null, ctx.t('ledger.gap.all')), ...GAPS.map(g => gapChip(g, ctx.t('ledger.gap.' + g)))), h('nav', {class: 'chips', 'aria-label': ctx.t('ledger.origin')}, chip(null, ctx.t('ledger.all'), ledger.assets.length),
        ...Object.entries(ledger.summary.counts).filter(([, n]) => n).map(([k, n]) => chip(k, ctx.t('ledger.kind.' + k), n))), h('label', 'searchbox', search)),
      h('div', 'tblwrap', h('table', 'tbl', h('thead', '', h('tr', '', ...['ledger.col.asset', 'ledger.col.origin', 'ledger.col.tool', 'ledger.col.script', 'ledger.col.seed', 'ledger.col.prompt', 'ledger.col.rights', 'ledger.col.evidence', 'ledger.detail'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
        h('tbody', '', ...shown.map(a => {
          const o = a.origin, tab = a.category ? ctx.categoryTab(a.category) : null;
          return h('tr', '', h('th', {scope: 'row'}, tab ? h('a', {href: ctx.href({tab, asset: a.id, params: a.source && a.source !== 'core' ? {source: a.source} : {}})}, h('code', '', a.id)) : h('code', '', a.id)),
            h('td', '', o.kind === 'not-recorded' ? (a.planned ? badge(ctx.t('ledger.status.not-produced'), 'muted') : h('span', 'nr', nr)) : badge(ctx.t('ledger.kind.' + o.kind), o.kind === 'retired-tool' ? 'warn' : 'muted')),
            h('td', '', field(a, 'tool', o.tool)), h('td', 'mono', field(a, 'script', o.script ?? o.document)), h('td', 'mono', field(a, 'seed', o.seed)),
            h('td', 'mono', field(a, 'promptHash', o.promptHash ? o.promptHash.slice(0, 12) : null)), h('td', '', a.rights ?? (a.recorded ? h('span', 'nr', nr) : '')),
            h('td', 'mono', a.evidence.join(', ') || h('span', 'nr', nr)), h('td', '', details(a)));
        })))),
      rows.length > ROWS ? h('p', 'muted', ctx.t('ledger.more', {shown: ROWS, total: rows.length})) : null));
}
