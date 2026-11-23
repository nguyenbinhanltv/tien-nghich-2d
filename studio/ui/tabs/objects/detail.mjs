// The right column: one asset, its clips and frames with timing playback, links, provenance and frame editing.
import { h, humanize, imgUrl, button, loadImage, fill, emptyBox, loadingBox, errorBox } from './dom.mjs';
import { framesOf, clipNames, framesOfClip, frameMs, groupLinks } from './model.mjs';
import { kindLabel } from './browser.mjs';
import { EditorApiClient } from '../../../src/editorApi.js';
import { importButton } from '../../importer/dialog.mjs';
import { timelineButton } from '../../timeline/panel.mjs';
import { pixelFrame, pixelToolbar, setView, trackPointer } from '../../pixelview.mjs';

const short = hash => (typeof hash === 'string' ? hash.slice(0, 12) : '');

export async function renderDetail(app, host, token) {
  const {ctx, state} = app;
  const entry = app.selected();
  const keep = host.contains(document.activeElement) ? document.activeElement.closest('[data-fk]')?.dataset.fk : null;
  if (!state.asset) { fill(host, emptyBox(ctx.t('detail.none'))); return; }
  if (!entry) { fill(host, errorBox(ctx.t('detail.unknown', {id: state.asset})), h('a', {class: 'btn back', href: ctx.href(app.route({}, {asset: null}))}, '← ' + ctx.t('detail.back'))); return; }
  fill(host, loadingBox(ctx.t('common.loading')));
  let detail, provenance;
  try {
    [detail, provenance] = await Promise.all([app.detail(entry), app.provenance(entry).catch(() => null)]);
  } catch (error) {
    if (error.name === 'AbortError' || token !== app.token) return;
    fill(host, errorBox(ctx.t('common.error', {message: error.message}), ctx.t('common.retry'), () => { app.forget(); app.repaint(); }));
    return;
  }
  if (token !== app.token) return;
  const frames = framesOf(detail);
  const clips = clipNames(frames);
  app.frames = frames;
  const clip = clips.includes(state.clip) ? state.clip : clips[0] ?? null;
  const inClip = clip ? framesOfClip(frames, clip) : [];
  const index = Math.max(0, inClip.findIndex(f => f.n === state.frame));
  const current = inClip[index] ?? null;
  const name = ctx.label(detail.record?.name) || entry.name || entry.id;
  const links = renderLinks(app, entry);
  fill(host, 
    h('header', 'dhead', h('a', {class: 'btn quiet back', href: ctx.href(app.route({}, {asset: null})), 'aria-label': ctx.t('detail.close')}, h('span', {class: 'back-arrow', 'aria-hidden': 'true'}, '←'), h('span', 'back-text', ctx.t('detail.back')), h('span', {class: 'back-x', 'aria-hidden': 'true'}, '×')),
      h('div', 'dtitle', h('h2', '', name), h('code', {title: entry.id}, entry.id))),
    metaList(app, entry, detail, current),
    h('div', 'dactions', importButton(ctx, {assetId: entry.id, label: ctx.t('import.open'), onDone: () => { app.forget(); app.repaint(); }}), ' ', timelineButton(ctx, {assetId: entry.id, label: ctx.t('timeline.open'), onDone: () => { app.forget(); app.repaint(); }})),
    clip ? stage(app, entry, clips, clip, inClip, index) : emptyBox(entry.readiness === 'planned' ? ctx.t('detail.planned') : ctx.t('detail.noFrames')),
    links,
    await tilesPanel(app, entry),
    provenancePanel(app, entry, detail, provenance),
    current ? await editorPanel(app, entry, detail, current, token) : null);
  if (keep) host.querySelector(`[data-fk="${keep}"]`)?.focus();
}

function metaList(app, entry, detail, current) {
  const {ctx} = app;
  const rows = [
    ['kind', kindLabel(ctx, entry.category)],
    ['ready', h('span', 'chip ' + (entry.readiness === 'packed' ? 'ok' : entry.readiness === 'authored' ? 'warn' : ''), ctx.t('ready.' + entry.readiness))],
    ['chunk', detail.record?.chunk_group ?? entry.chunk ?? '–'],
    ['source', (() => { const s = ctx.project.sources.find(x => x.id === entry.source); return s ? ctx.label(s.label) : entry.source; })()],
    ['wave', entry.wave ? humanize(entry.wave) : '–'],
    ['size', current ? h('span', {class: 'native', 'data-path': current.path}, entry.size ? entry.size.join('×') + ' px' : '…') : entry.size ? entry.size.join('×') + ' px' : '–']
  ];
  if (detail.record?.brief || detail.record?.description) rows.push(['brief', detail.record.brief ?? detail.record.description]);
  const dl = h('dl', 'kv');
  for (const [key, value] of rows) dl.append(h('dt', '', ctx.t('meta.' + key)), h('dd', '', value));
  if (current) measure(app, dl.querySelector('.native'), current.path);
  return dl;
}

async function measure(app, el, path) {
  try { const img = await loadImage(path); el.textContent = app.ctx.t('meta.native', {w: img.naturalWidth, h: img.naturalHeight}); } catch { /* keep manifest size */ }
}

function stage(app, entry, clips, clip, inClip, index) {
  const {ctx, state} = app;
  const pv = app.pv;
  const size = [1, 1];
  const canvas = h('canvas', {role: 'img', 'aria-describedby': 'ob-keys'});
  const frame = pixelFrame({canvas, size, bg: pv.bg, zoom: state.zoom, grid: pv.grid});
  const note = h('p', {class: 'muted small', role: 'status'});
  const label = h('span', {class: 'tick', role: 'status'});
  const setLabel = i => { const f = inClip[i]; label.textContent = ctx.t('play.frame', {n: f.n, total: inClip.length, ms: frameMs(f)}) + (f.ms ? '' : ' · ' + ctx.t('play.defaultMs')); };
  let at = index, playing = false, timer, alive = true;
  /** Paint frame `i` at integer zoom into the canvas; the grid layer follows its size. A frame that fails to load says so, it is never faked. */
  const draw = async i => {
    const f = inClip[i];
    try {
      const img = await loadImage(f.path);
      if (!alive || i !== at) return;
      size[0] = img.naturalWidth; size[1] = img.naturalHeight;
      canvas.width = size[0] * state.zoom; canvas.height = size[1] * state.zoom;
      const g = canvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      frame.style.setProperty('--pv-cols', size[0]); frame.style.setProperty('--pv-rows', size[1]);
      canvas.setAttribute('aria-label', ctx.t('detail.canvas', {id: entry.id, clip, n: f.n, zoom: state.zoom}));
      note.textContent = '';
    } catch { if (alive && i === at) note.textContent = ctx.t('common.error', {message: f.path}); }
  };
  const show = i => { at = i; draw(i); setLabel(i); };
  setLabel(index); draw(index);
  const tick = () => { show((at + 1) % inClip.length); timer = setTimeout(tick, frameMs(inClip[at])); };
  const toggle = () => {
    playing = !playing;
    play.textContent = ctx.t(playing ? 'play.pause' : 'play.play');
    play.setAttribute('aria-pressed', String(playing));
    clearTimeout(timer);
    if (playing) timer = setTimeout(tick, frameMs(inClip[at]));
  };
  const play = button(ctx.t('play.play'), toggle, {'aria-pressed': 'false', 'data-fk': 'play'});
  if (inClip.length < 2) play.disabled = true;
  const toolbar = pixelToolbar({labels: {zoom: ctx.t('grid.zoom', {zoom: state.zoom}), zoomIn: ctx.t('pv.zoomIn'), zoomOut: ctx.t('pv.zoomOut'), auto: '', grid: ctx.t('pv.grid'), gridHint: ctx.t('pv.gridHint'),
      bg: ctx.t('pv.bg'), bgNames: {dark: ctx.t('pv.bg.dark'), light: ctx.t('pv.bg.light'), palette: ctx.t('pv.bg.palette')}, wipe: '', coords: ctx.t('pv.coords'), none: ctx.t('pv.none')},
    zoom: state.zoom, noAuto: true, grid: pv.grid, bg: pv.bg,
    onZoom: z => app.go({zoom: z}, {replace: true}), onGrid: on => { pv.grid = on; setView(frame, {zoom: state.zoom, grid: on}); }, onBg: name => { pv.bg = name; setView(frame, {bg: name}); }});
  trackPointer(canvas, size, toolbar.coords, ctx.t('pv.none'));
  // Viewer keys (the document listener lives in index.mjs and calls this while a stage is on screen).
  app.ctl = action => {
    if (action === 'play') { if (play.disabled) return false; toggle(); return true; }
    if (action === 'prev' || action === 'next') {
      if (inClip.length < 2) return false;
      if (playing) toggle();
      app.go({}, {clip, frame: inClip[(at + (action === 'next' ? 1 : -1) + inClip.length) % inClip.length].n}, {replace: true});
      return true;
    }
    if (action === 'grid') { pv.grid = !pv.grid; setView(frame, {zoom: state.zoom, grid: pv.grid}); const box = toolbar.el.querySelector('[data-fk="pv-grid"]'); if (box) box.checked = pv.grid; return true; }
    return false;
  };
  app.onCleanup(() => { alive = false; clearTimeout(timer); app.ctl = null; });
  return h('section', 'stage',
    h('nav', {class: 'clips', 'aria-label': ctx.t('detail.clips')}, ...clips.map(c => h('a', {class: 'chip clip' + (c === clip ? ' on is-pressed' : ''), 'aria-current': c === clip ? 'true' : null,
      href: ctx.href(app.route({}, {clip: c, frame: framesOfClip(app.frames, c)[0]?.n ?? 0}))}, c, h('small', '', String(framesOfClip(app.frames, c).length))))),
    h('div', 'toolbar pv-tools', toolbar.el),
    h('div', 'stagebox', frame),
    note,
    h('div', 'controls', play, label),
    h('p', {class: 'muted small', id: 'ob-keys'}, ctx.t('detail.keys')),
    h('ol', {class: 'strip', 'aria-label': ctx.t('detail.frames')}, ...inClip.map((f, i) => h('li', '',
      h('a', {class: 'thumb' + (i === index ? ' on' : ''), 'aria-current': i === index ? 'true' : null, href: ctx.href(app.route({}, {clip, frame: f.n}))},
        h('span', 'checker', h('img', {src: imgUrl(f.path), alt: '', loading: 'lazy', draggable: 'false', style: `--z:${Math.max(1, Math.min(state.zoom, 4))}`})),
        h('small', '', `${f.n}`), h('small', 'ms', f.ms ? f.ms + ' ms' : '–'))))));
}

function renderLinks(app, entry) {
  const {ctx} = app;
  const groups = groupLinks(app.links[entry.id], app.byId, entry.category);
  const section = h('section', 'dsec', h('h3', '', ctx.t('links.title')));
  if (!Object.keys(groups).length) return section.append(h('p', 'muted', ctx.t('links.none'))), section;
  for (const [group, ids] of Object.entries(groups)) section.append(h('div', 'linkgroup', h('h4', '', ctx.t('links.' + group)),
    h('ul', '', ...ids.map(id => { const other = app.byId.get(id);
      return h('li', '', h('a', {href: ctx.href(app.route({}, {asset: other}))}, id), ' ', h('small', 'muted', kindLabel(ctx, other.category))); }))));
  return section;
}

/** F5: the tile animations and collision shapes stored in the asset's metadata, read only. Nothing is shown for an asset with none. */
async function tilesPanel(app, entry) {
  const {ctx} = app;
  let sheets = {};
  try { sheets = (await (await fetch(`/api/tabs/objects/tiles?id=${encodeURIComponent(entry.id)}`, {signal: ctx.signal})).json()).sheets ?? {}; } catch (error) { if (error.name === 'AbortError') throw error; }
  const rows = [];
  for (const [sheet, tiles] of Object.entries(sheets)) for (const [n, tile] of Object.entries(tiles)) {
    if (tile.animation) rows.push(h('li', '', h('code', '', sheet), ' ', ctx.t('tiles.animation', {n, steps: tile.animation.map(s => ctx.t('tiles.step', {n: s.n, ms: s.ms})).join(' → ')})));
    if (tile.shapes) rows.push(h('li', '', h('code', '', sheet), ' ', ctx.t('tiles.shapes', {n, shapes: tile.shapes.map(s => ctx.t('tiles.' + s.kind, {...s, count: s.points?.length ?? 0}) + (s.name ? ` “${s.name}”` : '') + (s.properties ? ' ' + Object.entries(s.properties).map(([k, v]) => `${k}=${v}`).join(', ') : '')).join('; ')})));
  }
  if (!rows.length) return null;
  return h('section', 'dsec', h('h3', '', ctx.t('tiles.title')), h('ul', '', ...rows));
}

function provenancePanel(app, entry, detail, provenance) {
  const {ctx} = app;
  const section = h('section', 'dsec', h('h3', '', ctx.t('prov.title')));
  const file = provenance?.files?.[0];
  const dl = h('dl', 'kv');
  const row = (key, value, mono) => dl.append(h('dt', '', ctx.t('prov.' + key)), h('dd', mono ? 'mono' : '', value || h('span', 'muted', ctx.t('prov.none'))));
  row('generator', file?.generator, true);
  row('seed', file?.seed != null ? String(file.seed) : '', true);
  row('generatorHash', short(file?.generator_sha256_lf ?? file?.generator_sha256), true);
  row('sourceHash', short(file?.source_sha256), true);
  row('producer', file?.producer);
  row('method', file?.method);
  row('palette', file?.palette ?? provenance?.record?.paletteRefs?.join(' '));
  row('output', provenance?.record?.outputPath, true);
  section.append(dl);
  if (file?.parent_sources?.length) section.append(h('p', 'muted', ctx.t('prov.parents', {ids: file.parent_sources.map(p => p.id).join(', ')})));
  if (!file) section.append(h('p', 'muted', ctx.t('prov.noFile')));
  section.append(h('p', 'muted note', ctx.t('prov.readonly')));
  if (file) section.append(h('p', 'muted', h('code', '', file.path)));
  return section;
}

async function editorPanel(app, entry, detail, current, token) {
  const {ctx} = app;
  const info = (await app.editable()).get('/' + current.path);
  if (!info) return h('section', 'dsec', h('h3', '', ctx.t('edit.title')), h('p', 'muted', ctx.t('edit.notCovered')));
  const api = new EditorApiClient();
  const box = h('section', 'dsec', h('h3', '', ctx.t('edit.title')), h('p', 'muted', ctx.t('edit.loading')));
  const load = async () => {
    let snap;
    try { snap = await api.getFrame(info.key); } catch (error) { fill(box, h('h3', '', ctx.t('edit.title')), h('p', {role: 'alert'}, ctx.t('edit.failed', {message: error.message}))); return; }
    if (token !== app.token) return;
    const [px, py] = snap.metadata.pivot ?? [0, 0];
    const x = h('input', {type: 'number', class: 'field', min: 0, max: info.width - 1, value: px, id: 'ob-px'});
    const y = h('input', {type: 'number', class: 'field', min: 0, max: info.height - 1, value: py, id: 'ob-py'});
    const msg = h('p', {class: 'muted', role: 'status'});
    const fail = error => { msg.textContent = error.status === 409 ? ctx.t('edit.conflict') : ctx.t('edit.failed', {message: error.message}); if (error.status === 409) load(); };
    const save = button(ctx.t('edit.savePivot'), async () => {
      try { await api.saveFrame({key: info.key, baseRevision: snap.head, metadata: {pivot: [Number(x.value), Number(y.value)]}}); ctx.announce(ctx.t('edit.saved')); await load(); }
      catch (error) { fail(error); }
    });
    const status = h('select', {id: 'ob-review', class: 'field', 'aria-label': ctx.t('edit.status')}, ...['pending', 'approved', 'changes_requested'].map(s => h('option', {value: s, selected: s === snap.status ? 'selected' : null}, ctx.t('review.' + s))));
    const text = h('input', {type: 'text', class: 'field', maxlength: 2000, id: 'ob-note', placeholder: ctx.t('edit.note'), 'aria-label': ctx.t('edit.note')});
    const review = button(ctx.t('edit.review'), async () => {
      try { await api.reviewFrame({key: info.key, revision: snap.revision, status: status.value, ...(text.value.trim() ? {text: text.value.trim()} : {})}); ctx.announce(ctx.t('edit.reviewed')); await load(); }
      catch (error) { fail(error); }
    });
    fill(box, h('h3', '', ctx.t('edit.title')),
      h('p', 'muted', ctx.t('edit.revision', {revision: snap.revision, status: ctx.t('review.' + snap.status)})),
      h('div', 'editrow', h('label', {for: 'ob-px'}, 'X'), x, h('label', {for: 'ob-py'}, 'Y'), y, save),
      h('div', 'editrow', status, text, review), msg,
      snap.comments?.length ? h('ul', 'comments', ...snap.comments.slice(-3).map(c => h('li', '', c.text ?? ''))) : null);
  };
  load();
  return box;
}
