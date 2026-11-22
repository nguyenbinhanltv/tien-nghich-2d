// The audio detail: listen, see the waveform and recorded measurements, and record the human's listening
// sign-off for this exact master. The sign-off is written only by this page.
import { h, button, humanize, pixelCanvas } from './dom.mjs';
import { imgUrl } from './urls.mjs';

const MAX_SHOWN = 120;

/** Flat label/value rows from a measurements object: scalars and short lists, skipping long prose and hashes. */
export function flatten(obj, prefix = '', out = [], depth = 0) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const label = (prefix ? prefix + ' · ' : '') + humanize(k);
    if (v == null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out.push([label, String(v)]);
    else if (typeof v === 'string') { if (v.length <= MAX_SHOWN) out.push([label, v]); }
    else if (Array.isArray(v)) { if (v.length <= 8 && v.every(x => ['number', 'string'].includes(typeof x))) out.push([label, v.join(', ')]); }
    else if (typeof v === 'object' && depth < 2) flatten(v, label, out, depth + 1);
  }
  return out;
}

function drawWave(canvas, wave, color, line) {
  const g = canvas.getContext('2d'), w = canvas.width, hgt = canvas.height, mid = hgt / 2;
  g.clearRect(0, 0, w, hgt);
  g.fillStyle = line; g.fillRect(0, mid, w, 1);
  g.fillStyle = color;
  const n = wave.min.length;
  for (let x = 0; x < w; x++) {
    const i = Math.min(n - 1, Math.floor(x * n / w));
    const top = mid - wave.max[i] * mid, bottom = mid - wave.min[i] * mid;
    g.fillRect(x, Math.floor(top), 1, Math.max(1, Math.ceil(bottom - top)));
  }
}

export async function renderAudio(app, host, item, token) {
  const {ctx} = app;
  host.replaceChildren(h('p', 'muted pad', ctx.t('common.loading')));
  let d;
  try { d = await ctx.tabApi('audio?id=' + encodeURIComponent(item.id)); }
  catch (error) { if (error.name === 'AbortError' || token !== app.token) return; return host.replaceChildren(h('p', {class: 'pad', role: 'alert'}, ctx.t('detail.failed', {message: error.message}))); }
  if (token !== app.token) return;
  const cs = getComputedStyle(ctx.root);
  const wave = d.wave && !d.wave.error ? h('canvas', {class: 'wave', width: 640, height: 120, role: 'img', 'aria-label': ctx.t('audio.waveLabel', {seconds: d.wave.durationSeconds.toFixed(1)})}) : null;
  if (wave) drawWave(wave, d.wave, cs.getPropertyValue('--accent').trim() || '#2fa27a', cs.getPropertyValue('--line').trim() || '#49434f');
  const rows = [...flatten(d.measurements.qa, ''), ...flatten(d.measurements.master, '')];
  const state = d.signoffState;
  const note = h('textarea', {id: 'rv-note', rows: 2, maxlength: 1000, placeholder: ctx.t('audio.notePlaceholder'), 'aria-label': ctx.t('audio.note')});
  const msg = h('p', {class: 'muted', role: 'status'});
  const post = verdict => async () => {
    try {
      await ctx.tabApi('audio-signoff', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({id: d.id, content: d.contentHash, verdict, note: note.value.trim() || undefined})});
      ctx.announce(ctx.t('audio.recorded'));
      await app.refresh({keepSelection: true});
    } catch (error) { msg.textContent = error.status === 409 ? ctx.t('audio.changed') : ctx.t('audio.failed', {message: error.message}); }
  };
  host.replaceChildren(
    h('header', 'dhead', h('div', '', h('h2', '', d.id), h('code', '', d.master ?? '')), h('span', 'badge s-' + state, ctx.t('signoff.' + state))),
    d.brief ? h('p', 'pad muted', d.brief) : null,
    h('section', 'dsec', h('h3', '', ctx.t('audio.listen')),
      d.master ? h('audio', {controls: true, preload: 'none', src: imgUrl(d.master), 'aria-label': ctx.t('audio.player', {id: d.id})}) : h('p', 'muted', ctx.t('audio.noMaster')),
      wave ?? h('p', 'muted', d.wave?.error ? ctx.t('audio.noWave', {reason: d.wave.error}) : ctx.t('audio.noWaveFile'))),
    h('section', 'dsec', h('h3', '', ctx.t('audio.measurements')),
      rows.length ? h('dl', 'kv', ...rows.flatMap(([k, v]) => [h('dt', '', k), h('dd', '', v)])) : h('p', 'muted', ctx.t('audio.noMeasurements')),
      d.provenance ? h('p', 'muted', h('code', '', d.provenance)) : null),
    h('section', 'dsec decide', h('h3', '', ctx.t('audio.signoffTitle')),
      h('p', 'muted', ctx.t('audio.humanOnly')),
      state === 'stale' ? h('p', {class: 'warnline', role: 'status'}, ctx.t('audio.stale')) : null,
      d.contentHash ? h('p', 'muted mono', ctx.t('audio.hash', {hash: d.contentHash.slice(0, 16)})) : null,
      h('label', {class: 'sr-only', for: 'rv-note'}, ctx.t('audio.note')), note,
      h('div', 'buttons', button(ctx.t('audio.sign'), post('signed'), {class: 'plain approve', disabled: !d.contentHash}), button(ctx.t('audio.needsWork'), post('needs_work'), {class: 'plain changes', disabled: !d.contentHash})), msg,
      d.signoffs.length ? h('ul', 'history', ...d.signoffs.map(s => h('li', '', h('span', 'badge s-' + s.verdict, ctx.t('signoff.' + s.verdict)), ' ', h('span', 'muted', s.ts.replace('T', ' ').slice(0, 16)),
        s.content !== d.contentHash ? h('span', 'tag warn', ctx.t('audio.otherMaster')) : null, s.note ? h('span', '', ' ' + s.note) : null))) : null));
}
