// "Build + audit": a human action that rebuilds the shown effect's committed spec in scratch and reports what came out beside the
// delivered frames. Nothing it does writes an asset or sets a review status; the panel says so and the server enforces it.
import { h, button, paintFloor, pixelCanvas } from './dom.mjs';

const results = new Map(); // one result per effect, clip and variant, kept while the tab is open

function sheetImage(png) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The rebuilt sheet could not be shown.'));
    img.src = 'data:image/png;base64,' + png;
  });
}

function strip(ctx, label, floor, size, draws) {
  const scale = size[0] <= 48 ? 2 : 1;
  const row = h('div', 'vx-buildrow');
  for (const [i, draw] of draws.entries()) {
    const [c, g] = pixelCanvas(size[0] * scale, size[1] * scale);
    paintFloor(g, c.width, c.height, floor, scale);
    if (draw) draw(g, scale);
    c.setAttribute('aria-label', ctx.t('build.frameLabel', {label, frame: i}));
    row.append(c);
  }
  return h('figure', 'vx-buildfig', h('figcaption', '', label), row);
}

function verdictLine(ctx, r) {
  const c = r.compare, f = c.frames;
  if (c.byteIdentical) return h('p', 'vx-note vx-verdict pass', ctx.t('build.same.byte', {source: c.sheet.reference.source}));
  if (f.identical) {
    return h('p', 'vx-note vx-verdict pass', ctx.t('build.same.pixels', {count: f.rebuilt}), ' ',
      c.sheet.reference ? ctx.t('build.sheetDiffers', {source: c.sheet.reference.source}) : ctx.t('build.noReference'));
  }
  return h('p', {class: 'vx-note vx-verdict fail', role: 'alert'}, ctx.t('build.different', {differing: f.differing.length, sizes: f.sizeMismatch.length, missing: f.missing.length, delivered: f.expected, rebuilt: f.rebuilt}));
}

async function show(ctx, out, r, effect, delivered, floor) {
  if (!r.ok) {
    out.replaceChildren(h('p', {class: 'vx-warn', role: 'alert'}, ctx.t('build.faults', {faults: Number.isNaN(r.audit.faults) || r.audit.faults == null ? '?' : r.audit.faults})), h('pre', 'vx-pre', r.audit.output));
    return;
  }
  const sheet = await sheetImage(r.sheet.png);
  const gate = r.gate;
  const draws = r.sheet.frames.map(f => (g, s) => g.drawImage(sheet, f.x, f.y, f.w, f.h, 0, 0, f.w * s, f.h * s));
  const was = delivered.map(im => (im ? (g, s) => g.drawImage(im, 0, 0, im.naturalWidth * s, im.naturalHeight * s) : null));
  out.replaceChildren(
    h('p', 'vx-note', ctx.t('build.spec', {path: r.spec.path})),
    verdictLine(ctx, r),
    h('dl', 'vx-kv',
      h('dt', '', ctx.t('build.audit')), h('dd', '', ctx.t('build.faults', {faults: r.audit.faults}) + (r.audit.digest ? ' · ' + ctx.t('build.digest', {digest: r.audit.digest}) : '')),
      h('dt', '', ctx.t('build.repro')), h('dd', {class: r.deterministic ? 'pass' : 'fail'}, ctx.t(r.deterministic ? 'build.deterministic.yes' : 'build.deterministic.no')),
      h('dt', '', ctx.t('build.gates')), h('dd', {class: gate.verdict}, ctx.t('build.gate', {verdict: ctx.t('build.verdict.' + gate.verdict), errors: gate.errors, warnings: gate.warnings, frames: gate.framesWithDefects})),
      h('dt', '', ctx.t('build.table')), h('dd', '', ctx.t('build.tableValue', {count: r.table.count, w: r.table.size[0], h: r.table.size[1], fps: r.table.fps ?? '–'})),
      h('dt', '', ctx.t('build.sheetSha')), h('dd', '', h('code', 'vx-mono', r.compare.sheet.rebuiltSha256.slice(0, 16) + '…'))),
    strip(ctx, ctx.t('build.delivered'), floor, effect.size, was),
    strip(ctx, ctx.t('build.rebuilt'), floor, effect.size, draws),
    h('p', 'vx-note', ctx.t('build.scratch', {path: r.scratch})));
}

/** The build block for the Audits view. `live` is the stage's loaded frames and floor. */
export function buildPanel(ctx, effect, clip, variant, live) {
  const key = [effect.id, clip.id, variant].join('/');
  const out = h('div', 'vx-buildout', h('p', 'vx-note muted', ctx.t('build.idle')));
  const msg = h('p', {class: 'vx-note', role: 'status'});
  const run = button(ctx.t('build.button'), async () => {
    run.disabled = true; msg.textContent = ctx.t('build.running');
    try {
      const body = {id: effect.id, clip: clip.id, variant: variant || undefined};
      const r = await ctx.fetchJson('/api/tabs/vfx/build', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body)});
      results.set(key, r);
      msg.textContent = '';
      await show(ctx, out, r, effect, live.frames, live.floor);
      ctx.announce(ctx.t('build.done'));
    } catch (error) { if (error.name !== 'AbortError') msg.textContent = ctx.t('common.error', {message: error.message}); }
    finally { run.disabled = false; }
  });
  if (results.has(key)) show(ctx, out, results.get(key), effect, live.frames, live.floor).catch(() => {});
  return h('div', 'vx-block', h('h4', '', ctx.t('build.title')), h('p', {class: 'vx-note vx-honest'}, ctx.t('build.note')), run, msg, out);
}
