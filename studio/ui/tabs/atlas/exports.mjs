// Engine exports into the export staging directory, one folder per format; each carries what it is written for and what is not verified.
import { h, button, fill } from './dom.mjs';
import { fmtBytes } from './model.mjs';

export function renderExports(app, sel, box) {
  const {ctx} = app, set = sel.set;
  const target = set.chunked ? sel.chunk : null;
  if (set.chunked && !target) return fill(box, h('p', 'muted pad', ctx.t('pack.pickChunk')));
  const key = `${set.id}|${target ?? ''}|${sel.profile}`;
  const result = app.exports.get(key);
  const picks = new Map(app.formats.map(f => [f.id, h('input', {type: 'checkbox', id: 'fmt-' + f.id, checked: 'checked'})]));
  const go = button(ctx.t('export.button'), async () => {
    const ids = app.formats.filter(f => picks.get(f.id).checked).map(f => f.id);
    if (!ids.length) return ctx.announce(ctx.t('export.pickOne'));
    app.busy = 'export'; app.render();
    try { app.exports.set(key, await ctx.tabApi('export', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify({set: set.id, ...(target ? {chunk: target} : {}), profile: sel.profile, formats: ids})})); }
    catch (error) { app.exports.set(key, {error: error.message}); }
    app.busy = null; app.render(); ctx.announce(ctx.t('export.done'));
  }, {disabled: app.busy ? 'disabled' : null});
  const download = (base, name) => `/api/tabs/atlas/export-file?${new URLSearchParams({path: `${base}/${name}`})}`;
  fill(box, h('p', 'muted', ctx.t('export.intro', {target: target ?? ctx.label(set.label), profile: sel.profile})),
    h('fieldset', 'formats', h('legend', '', ctx.t('export.formats')), ...app.formats.map(f => h('label', 'inline', picks.get(f.id), ' ', ctx.label(f.label)))),
    h('div', 'actions', go, h('span', 'muted', ctx.t('export.where'))),
    app.busy === 'export' ? h('p', {class: 'muted', role: 'status'}, ctx.t('export.running')) : null,
    result?.error ? h('p', {class: 'banner bad', role: 'alert'}, ctx.t('error.generic', {message: result.error})) : null,
    result?.formats ? h('div', 'results', h('p', 'muted', ctx.t('export.written', {dir: result.dir, pages: result.summary.pages, frames: result.summary.frames, clips: result.summary.clips})),
      ...result.formats.map(f => h('article', 'engine', h('h3', '', ctx.label(f.label)),
        h('ul', 'plain files', ...f.files.map(file => h('li', '', h('a', {href: download(result.downloadBase, file.name), download: file.name.split('/').at(-1)}, h('code', '', file.name)), ' ', h('span', 'muted', fmtBytes(file.bytes))))),
        h('ul', 'notes', ...f.notes.map(n => h('li', '', n)))))) : null);
}
