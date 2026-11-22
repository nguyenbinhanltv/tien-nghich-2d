// The Patch view: the engine document (patch or score) behind a cue, its numeric parameters, and a scratch preview. A preview is
// rendered by studio/audio into the OS temp directory (never into delivered audio) so a reviewer can hear a parameter change
// next to the delivered master. Nothing here changes the delivered files.
import { h, button, put } from './dom.mjs';
import { numericParams, withParam, paramGroup, stepFor, levelGain, formatDb, playLabel } from './model.mjs';

export async function renderPatch(app, el, detail, entry, current) {
  const {ctx, engine} = app, base = `/api/tabs/${ctx.tab}/`;
  let found;
  try { found = await ctx.tabApi('doc?id=' + encodeURIComponent(entry.id)); } catch (error) { if (error.name === 'AbortError') return; put(el, h('p', 'au-error', ctx.t('error.load', {message: error.message}))); return; }
  if (!current()) return;
  if (!found.found) {
    put(el, h('p', 'au-empty muted', ctx.t('patch.none')), detail.ledgerPath ? h('p', 'muted', ctx.t('patch.ledger', {path: detail.ledgerPath})) : null);
    return;
  }
  const original = found.doc;
  let doc = structuredClone(original), preview = null;
  const status = h('p', {class: 'au-status', role: 'status'});
  const say = t => { status.textContent = t; };

  const summary = h('dl', 'au-defs',
    ...[['patch.kind', ctx.t('patch.kind.' + found.kind)], ['patch.file', found.path], ['patch.seed', String(original.seed)], ['patch.rate', original.sampleRate + ' Hz'],
      found.kind === 'patch' ? ['patch.length', ctx.t('patch.lengthMs', {ms: original.durationMs, layers: original.layers.length})]
        : ['patch.length', ctx.t('patch.lengthScore', {tempo: original.tempoBpm, bars: original.loop.bars ?? '—', tracks: original.tracks.length, instruments: Object.keys(original.instruments).length})]]
      .flatMap(([k, v]) => [h('dt', '', ctx.t(k)), h('dd', '', v)]),
    found.issues.length ? [h('dt', '', ctx.t('patch.issues')), h('dd', 'bad', found.issues.join('; '))] : []);

  const grid = h('div', 'au-params');
  function drawParams() {
    const groups = new Map();
    for (const p of numericParams(original)) { const g = paramGroup(p.path); groups.set(g, [...(groups.get(g) ?? []), p]); }
    put(grid, ...[...groups].map(([group, params]) => h('fieldset', 'au-group', h('legend', '', group || ctx.t('patch.document')),
      ...params.map(p => {
        const input = h('input', {type: 'number', value: valueAt(doc, p.path), step: stepFor(p.value), id: 'p-' + p.label, 'aria-label': p.label});
        input.addEventListener('change', () => { const v = Number(input.value); if (Number.isFinite(v)) { doc = withParam(doc, p.path, v); input.classList.toggle('changed', v !== p.value); } });
        input.classList.toggle('changed', valueAt(doc, p.path) !== p.value);
        return h('label', 'au-param', h('span', '', p.label.replace(group + '.', '')), input);
      }))));
  }
  const valueAt = (d, path) => path.reduce((n, k) => n[k], d);

  const out = h('div', 'au-preview');
  async function render() {
    say(ctx.t('patch.rendering'));
    try {
      const res = await fetch(base + 'preview', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({doc}), signal: ctx.signal});
      const body = await res.json();
      if (!res.ok) { say(ctx.t('patch.refused', {message: (body.error?.message ?? res.status) + (body.error?.issues ? ': ' + body.error.issues.join('; ') : '')})); return; }
      preview = body;
      say(ctx.t('patch.rendered', {id: body.id}));
      drawPreview();
    } catch (error) { if (error.name !== 'AbortError') say(ctx.t('patch.refused', {message: error.message})); }
  }
  async function drawPreview() {
    if (!preview || !current()) return;
    const master = await app.measure(entry.id).catch(() => null);
    const m = preview.measurements, r = master?.measurements;
    const row = (label, a, b, unit = '') => h('tr', '', h('th', {scope: 'row'}, label), h('td', 'num', formatDb(b) + unit), h('td', 'num', formatDb(a) + unit),
      h('td', 'num', Number.isFinite(a) && Number.isFinite(b) ? (a - b >= 0 ? '+' : '') + (a - b).toFixed(1) + unit : '—'));
    put(out, 
      h('div', 'au-transport', button(ctx.t('patch.playPreview'), () => playPreview(preview), {class: 'plain primary'}), button(ctx.t('patch.playMaster'), () => playMaster()),
        button(ctx.t('listen.stop'), () => engine.stopAll(), {class: 'plain danger'})),
      h('label', 'check', h('input', {type: 'checkbox', id: 'au-pmatch', checked: true}), h('span', '', ctx.t('listen.matched'))),
      h('table', 'au-table', h('caption', 'sr-only', ctx.t('patch.compare')),
        h('thead', '', h('tr', '', h('th', {scope: 'col'}, ''), h('th', {scope: 'col'}, ctx.t('patch.delivered')), h('th', {scope: 'col'}, ctx.t('patch.preview')), h('th', {scope: 'col'}, ctx.t('patch.delta')))),
        h('tbody', '', row(ctx.t('num.samplePeak'), m.peak.sampleDbfs, r?.peak.sampleDbfs, ' dB'), row(ctx.t('num.truePeak'), m.peak.truePeakDbtp, r?.peak.truePeakDbtp, ' dB'),
          row(ctx.t('num.ungated'), m.loudness.ungatedLufs, r?.loudness.ungatedLufs, ' LUFS'), row(ctx.t('num.integrated'), m.loudness.integratedLufs, r?.loudness.integratedLufs, ' LUFS'),
          row(ctx.t('num.rms'), m.rms.dbfs, r?.rms.dbfs, ' dB'))),
      preview.scale && !preview.scale.ok ? h('p', 'bad', ctx.t('patch.outOfScale', {n: preview.scale.outOfScale.length})) : null,
      h('img', {class: 'au-wave-img', src: base + `preview-image?id=${preview.id}&kind=waveform&width=1000`, alt: ctx.t('patch.previewWaveAlt')}),
      h('img', {class: 'au-wave-img', src: base + `preview-image?id=${preview.id}&kind=spectrogram&width=1000`, alt: ctx.t('patch.previewSpecAlt')}));
  }
  async function playPreview(p) {
    const buffer = await engine.load(base + 'preview-file?id=' + p.id, p.sampleRate);
    const gain = document.getElementById('au-pmatch')?.checked ? levelGain(p.measurements) : 1;
    engine.stopAll();
    engine.play(buffer, {gain, label: 'preview', loop: p.loop ?? undefined});
    say(ctx.t('patch.playingPreview'));
  }
  async function playMaster() {
    const master = await app.measure(entry.id), m = detail.masterInfo;
    const buffer = await engine.load(base + 'master?id=' + encodeURIComponent(entry.id), m.sampleRate);
    const gain = document.getElementById('au-pmatch')?.checked ? levelGain(master.measurements) : 1;
    engine.stopAll();
    engine.play(buffer, {gain, label: playLabel(entry.id, entry.masterSha, 'master'), loop: detail.loop ?? undefined});
    say(ctx.t('patch.playingMaster'));
  }

  const renderButton = button(ctx.t('patch.render'), render, {class: 'plain primary'});
  const reset = button(ctx.t('patch.reset'), () => { doc = structuredClone(original); drawParams(); preview = null; put(out, ); say(''); });
  const json = h('details', 'au-json', h('summary', '', ctx.t('patch.json')), h('pre', '', JSON.stringify(original, null, 1)));
  put(el, h('p', 'muted', ctx.t('patch.help')), summary, h('div', 'au-transport', renderButton, reset), status, grid, out, json);
  drawParams();
  app.onCleanup(() => engine.stopAll());
}
