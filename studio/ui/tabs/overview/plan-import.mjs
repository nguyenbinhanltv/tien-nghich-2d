// Overview: plan assets from a spreadsheet (a CSV export). Four steps on one panel: choose the file,
// map its columns, look at the dry run, then import. Existing ids are never overwritten; nothing is
// written until the person clicks Import. The server does all the reading and checking
// (POST /api/tabs/overview/plan-import); this file only shows it.
import { h } from './dom.mjs';

const FIELDS = ['id', 'brief', 'chunk', 'size', 'category', 'clips'];
const REQUIRED = new Set(['id', 'brief']);

const button = (label, onClick, attrs = {}) => { const b = h('button', {type: 'button', class: 'plain', ...attrs}, label); b.addEventListener('click', onClick); return b; };

export function renderPlanImport(ctx, onChanged) {
  const state = {csv: '', info: null, mapping: {}, defaults: {}, dry: null, busy: false, error: null, done: null};
  const body = h('div', 'pi-body');
  const section = h('section', 'ov-section pi', h('h2', {id: 'ov-plan'}, ctx.t('plan.title')), h('p', 'muted', ctx.t('plan.intro')), body);
  section.setAttribute('aria-labelledby', 'ov-plan');

  const post = async payload => {
    const res = await fetch('/api/tabs/overview/plan-import', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(payload), signal: ctx.signal});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message ?? 'HTTP ' + res.status);
    return data;
  };
  const run = async work => {
    state.busy = true; state.error = null; draw();
    try { await work(); } catch (error) { if (error.name !== 'AbortError') state.error = error.message; }
    state.busy = false; draw();
  };

  const chooseFile = file => run(async () => {
    if (!file) return;
    state.csv = await file.text();
    state.dry = null; state.done = null;
    state.info = await post({csv: state.csv});
    state.mapping = {...state.info.suggested};
    state.defaults = {chunk: state.info.options.chunks[0] ?? '', phase: '', method: ''};
  });

  const payload = dryRun => ({csv: state.csv, dryRun,
    mapping: Object.fromEntries(Object.entries(state.mapping).filter(([, v]) => v)),
    defaults: Object.fromEntries(Object.entries(state.defaults).filter(([, v]) => v))});

  const preview = () => run(async () => { state.done = null; state.dry = await post(payload(true)); });
  const apply = () => run(async () => {
    const result = await post(payload(false));
    state.done = result.summary; state.dry = null;
    ctx.announce(ctx.t('plan.imported', {n: result.summary.create}));
    onChanged?.();
  });

  function select(id, label, options, value, onInput, {blank} = {}) {
    const sel = h('select', {id});
    if (blank !== undefined) sel.append(h('option', {value: ''}, blank));
    for (const o of options) sel.append(h('option', {value: o, ...(o === value ? {selected: true} : {})}, o));
    sel.value = value ?? '';
    sel.addEventListener('change', () => { onInput(sel.value); state.dry = null; state.done = null; draw(); });
    return h('label', {for: id, class: 'pi-field'}, h('span', '', label), sel);
  }

  function mapping() {
    const {info} = state;
    return h('fieldset', 'pi-map', h('legend', '', ctx.t('plan.mapLegend', {rows: info.rowCount})),
      h('div', 'pi-grid',
        ...FIELDS.map(f => select('pi-col-' + f, ctx.t('plan.field.' + f) + (REQUIRED.has(f) ? ' *' : ''), info.headers, state.mapping[f] ?? '', v => { state.mapping[f] = v; }, {blank: REQUIRED.has(f) ? ctx.t('plan.pick') : ctx.t('plan.none')}))),
      h('p', 'muted', ctx.t('plan.unmappedNote')),
      h('div', 'pi-grid',
        select('pi-chunk', ctx.t('plan.defaultChunk'), info.options.chunks, state.defaults.chunk, v => { state.defaults.chunk = v; }, {blank: ctx.t('plan.none')}),
        select('pi-phase', ctx.t('plan.defaultPhase'), info.options.phases, state.defaults.phase, v => { state.defaults.phase = v; }, {blank: ctx.t('plan.projectDefault')}),
        select('pi-method', ctx.t('plan.defaultMethod'), info.options.methods, state.defaults.method, v => { state.defaults.method = v; }, {blank: ctx.t('plan.projectDefault')})),
      h('p', 'muted', ctx.t('plan.sizeNote', {profiles: info.options.profiles.join(', ')})));
  }

  function table() {
    const {dry} = state;
    const rows = dry.rows.map(r => h('tr', {class: 'pi-' + r.action}, h('td', 'num', String(r.line)), h('td', 'mono', r.id || '—'),
      h('td', '', h('span', {class: 'badge pi-badge-' + r.action}, ctx.t('plan.action.' + r.action))),
      h('td', '', r.action === 'create' ? (r.entry.profile ?? ctx.t('plan.custom', {size: r.entry.custom.size.join('×'), category: r.entry.custom.category})) + ' · ' + r.entry.chunk_group : r.message)));
    return h('div', 'table-wrap', h('table', 'ov-table',
      h('caption', 'sr-only', ctx.t('plan.dryTitle')),
      h('thead', '', h('tr', '', h('th', {scope: 'col', class: 'num'}, ctx.t('plan.col.line')), h('th', {scope: 'col'}, ctx.t('plan.col.id')), h('th', {scope: 'col'}, ctx.t('plan.col.action')), h('th', {scope: 'col'}, ctx.t('plan.col.detail')))),
      h('tbody', '', ...rows)));
  }

  function draw() {
    const kids = [];
    const input = h('input', {type: 'file', id: 'pi-file', accept: '.csv,.tsv,.txt,text/csv', class: 'pi-file'});
    input.addEventListener('change', () => chooseFile(input.files[0]));
    kids.push(h('div', 'pi-pick', h('label', {for: 'pi-file'}, ctx.t('plan.choose')), input));
    if (state.error) kids.push(h('p', {role: 'alert', class: 'pi-error'}, state.error));
    if (state.info) {
      kids.push(mapping());
      const ready = state.mapping.id && state.mapping.brief;
      kids.push(h('div', 'pi-actions', button(ctx.t('plan.preview'), preview, {disabled: !ready || state.busy})));
    }
    if (state.dry) {
      const {create, skip} = state.dry.summary;
      kids.push(h('p', {class: 'pi-summary', role: 'status'}, ctx.t('plan.summary', {create, skip})), table(),
        h('div', 'pi-actions', button(ctx.t('plan.import', {n: create}), apply, {disabled: !create || state.busy}), h('span', 'muted', ctx.t('plan.importNote', {file: state.dry.file}))));
    }
    if (state.done) kids.push(h('p', {role: 'status', class: 'pi-done'}, ctx.t('plan.done', {create: state.done.create, skip: state.done.skip})));
    body.replaceChildren(...kids);
    body.toggleAttribute('aria-busy', state.busy);
  }
  draw();
  return section;
}
