// Pack into staging and prove equality: stage the chosen chunk (or the whole set), then show the byte comparison with the shipped atlas.
import { h, button, fill } from './dom.mjs';
import { badge, failure } from './common.mjs';
import { describeDifference, fmtBytes, shortSha, sortFiles, statusTone, verdictTone } from './model.mjs';

function fileTable(ctx, comparison) {
  return h('div', 'tblwrap', h('table', 'tbl', h('thead', '', h('tr', '', ...['pack.col.file', 'pack.col.status', 'pack.col.staged', 'pack.col.shipped', 'pack.col.detail'].map(k => h('th', {scope: 'col'}, ctx.t(k))))),
    h('tbody', '', ...sortFiles(comparison.files).map(f => {
      const d = describeDifference(f);
      return h('tr', '', h('th', {scope: 'row'}, h('code', '', f.name)), h('td', '', badge(ctx.t('pack.status.' + f.status), statusTone(f.status))),
        h('td', 'mono', f.staged ? `${fmtBytes(f.staged.bytes)} · ${shortSha(f.staged.sha256)}` : '–'), h('td', 'mono', f.shipped ? `${fmtBytes(f.shipped.bytes)} · ${shortSha(f.shipped.sha256)}` : '–'),
        h('td', 'detail-cell', d ? ctx.t(d[0], d[1]) : f.status === 'not_produced' ? ctx.t('pack.notProduced') : ''));
    }))));
}

function resultBlock(app, result) {
  const {ctx} = app;
  const profiles = Object.entries(result.profiles);
  const worst = profiles.some(([, p]) => p.comparison.verdict === 'differs') ? 'differs' : profiles.some(([, p]) => p.comparison.verdict === 'equivalent') ? 'equivalent' : profiles.every(([, p]) => p.comparison.verdict === 'identical') ? 'identical' : 'empty';
  const first = profiles.map(([name, p]) => ({name, first: p.comparison.first})).find(x => x.first && x.first.status === 'differs');
  return h('div', 'result',
    h('p', 'verdict t-' + verdictTone(worst), badge(ctx.t('pack.verdict.' + worst), verdictTone(worst)), ' ', ctx.t('pack.verdict.' + worst + '.text', {engine: ctx.t('pack.engine.' + result.engine)})),
    first ? h('p', 'banner bad', ctx.t('pack.firstDifference', {profile: first.name, file: first.first.name}), ' ', (() => { const d = describeDifference(first.first); return d ? ctx.t(d[0], d[1]) : ''; })()) : null,
    result.check ? h('p', {class: 'banner ' + (result.check.ran ? (result.check.ok ? 'good' : 'bad') : ''), role: 'status'}, result.check.ran ? (result.check.ok ? ctx.t('pack.check.ok', {output: result.check.stdout.trim().split('\n').pop()}) : ctx.t('pack.check.failed', {output: (result.check.stderr || result.check.stdout).trim().split('\n').pop()})) : ctx.t('pack.check.none')) : null,
    ...profiles.map(([name, p]) => h('section', 'profile', h('h3', '', name, ' ', badge(ctx.t('pack.verdict.' + p.comparison.verdict), verdictTone(p.comparison.verdict)), ' ',
      h('span', 'muted', ctx.t('pack.profile.counts', p.comparison.counts)), p.budget ? [' ', badge(ctx.t('budget.state.' + p.budget.state), p.budget.state === 'over' ? 'bad' : p.budget.state === 'full' ? 'warn' : 'muted')] : null), fileTable(ctx, p.comparison))),
    result.extra?.length ? h('p', 'muted', ctx.t('pack.extra', {files: result.extra.map(e => `${e.name} (${ctx.t('pack.status.' + e.status)})`).join(', ')})) : null,
    h('p', 'muted', ctx.t('pack.staged', {dir: result.dir}), ' · ', ctx.t('pack.unchanged', {fingerprint: result.shipped.fingerprint})),
    result.authority ? h('p', 'muted', ctx.t('pack.authority.ran', {ms: result.authority.ms})) : null);
}

export function renderPack(app, sel, box) {
  const {ctx} = app, set = sel.set;
  const target = set.chunked ? sel.chunk : null;
  const key = engine => `${set.id}|${target ?? ''}|${engine}`;
  if (set.chunked && !target) return fill(box, h('p', 'muted pad', ctx.t('pack.pickChunk')));
  const run = async (engine, extra = {}) => {
    app.busy = key(engine); app.render();
    try { app.packs.set(key(engine), await ctx.tabApi('pack', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({set: set.id, ...(target ? {chunk: target} : {}), engine, ...extra})})); }
    catch (error) { app.packs.set(key(engine), {error: error.message}); }
    app.busy = null; app.render(); ctx.announce(ctx.t('pack.done'));
  };
  const check = h('input', {type: 'checkbox', id: 'pack-check', checked: set.authority.check ? 'checked' : null, disabled: set.authority.check ? null : 'disabled'});
  const card = (engine, title, text, action, note) => {
    const result = app.packs.get(key(engine));
    return h('article', 'engine', h('h3', '', title), h('p', '', text), action, note,
      app.busy === key(engine) ? h('p', {class: 'muted', role: 'status'}, ctx.t('pack.running')) : null,
      result?.error ? h('p', {class: 'banner bad', role: 'alert'}, ctx.t('error.generic', {message: result.error})) : result ? resultBlock(app, result) : null);
  };
  const studioButton = button(ctx.t('pack.studio.button'), () => run('studio', {check: check.checked}), {disabled: app.busy ? 'disabled' : null});
  const authButton = button(ctx.t('pack.authority.button'), () => run('authority'), {disabled: app.busy || !set.authority.build ? 'disabled' : null});
  fill(box, h('p', 'muted', ctx.t('pack.intro', {target: target ?? ctx.label(set.label)})), h('p', 'banner', ctx.t('pack.explain')),
    h('div', 'engines',
      card('studio', ctx.t('pack.engine.studio'), ctx.t('pack.studio.text'), h('div', 'actions', studioButton, h('label', 'inline', check, ' ', ctx.t('pack.studio.check'))), set.studioPack ? null : h('p', 'muted', ctx.t('pack.studio.unavailable'))),
      card('authority', ctx.t('pack.engine.authority'), ctx.t('pack.authority.text'), h('div', 'actions', authButton),
        set.authority.build ? null : h('p', 'muted', ctx.t(set.authority.registered ? 'pack.authority.noToolchain' : 'pack.authority.notRegistered')))));
}
