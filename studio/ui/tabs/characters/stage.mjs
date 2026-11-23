import { h, humanize, badge, notice, skeleton } from './dom.mjs';
import { clipFrames, durations, frameAt, rawFor, autoZoom, compares, overlayNames } from './state.mjs';
import { compare, opaqueBounds } from './facing.mjs';
import { reducedMotion } from '../../seal.mjs';
import { pixelFrame, pixelToolbar, setView, trackPointer, dragWipe, wipeColumn, stepZoom, pixelAt } from '../../pixelview.mjs';

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';

function pathOf(app, dir, n = app.liveFrame ?? app.sel.frame) {
  const list = clipFrames(app.detail, app.sel.clip, dir);
  return list[Math.min(n, list.length - 1)] ?? null;
}

/** Draw one facing at integer zoom with the chosen comparison, onion skin and overlays. */
async function drawCell(app, cell) {
  const {detail, state, store} = app;
  const dir = cell.dataset.dir, zoom = app.zoom, size = detail.size ?? [32, 32];
  const canvas = cell.querySelector('canvas'), g = canvas.getContext('2d');
  const frame = pathOf(app, dir);
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  if (!frame) return;
  const processed = await store.load(frame.path);
  const raw = rawFor(detail, frame);
  const rawImage = raw ? await store.load(raw.path).catch(() => null) : null;
  const w = processed.naturalWidth, hgt = processed.naturalHeight;
  if (state.onion) {
    const list = clipFrames(detail, app.sel.clip, dir), at = list.indexOf(frame);
    for (const [neighbour, colour] of [[list[at - 1] ?? list.at(-1), css('--gold')], [list[at + 1] ?? list[0], css('--accent')]]) {
      if (!neighbour || neighbour === frame) continue;
      const tint = document.createElement('canvas');
      tint.width = w; tint.height = hgt;
      const t = tint.getContext('2d');
      t.drawImage(await store.load(neighbour.path), 0, 0);
      t.globalCompositeOperation = 'source-atop';
      t.fillStyle = colour; t.fillRect(0, 0, w, hgt);
      g.globalAlpha = 0.45; g.drawImage(tint, 0, 0, w * zoom, hgt * zoom); g.globalAlpha = 1;
    }
  }
  const mode = state.compare;
  if (mode === 'raw' && rawImage) g.drawImage(rawImage, 0, 0, rawImage.naturalWidth * zoom, rawImage.naturalHeight * zoom);
  else if (mode === 'split' && rawImage) {
    const col = wipeColumn(app.pv.wipe, w);
    if (col > 0) g.drawImage(rawImage, 0, 0, col, hgt, 0, 0, col * zoom, hgt * zoom);
    if (col < w) g.drawImage(processed, col, 0, w - col, hgt, col * zoom, 0, (w - col) * zoom, hgt * zoom);
    g.fillStyle = css('--gold'); g.fillRect(Math.max(0, col * zoom - 1), 0, 2, hgt * zoom);
  } else if (mode === 'diff' && rawImage) {
    const a = await store.read(raw.path), b = await store.read(frame.path);
    if (a.width === b.width && a.height === b.height) {
      const {kinds} = compare(a, b);
      const palette = [null, css('--surface'), css('--gold'), css('--danger'), css('--accent')];
      for (let i = 0; i < kinds.length; i++) if (kinds[i]) { g.fillStyle = palette[kinds[i]]; g.fillRect((i % a.width) * zoom, Math.floor(i / a.width) * zoom, zoom, zoom); }
    } else g.drawImage(processed, 0, 0, w * zoom, hgt * zoom);
  } else g.drawImage(processed, 0, 0, w * zoom, hgt * zoom);
  cell.dataset.compare = rawImage || mode === 'processed' ? mode : 'processed';
  cell.querySelector('.cell-note').textContent = !rawImage && mode !== 'processed' ? app.ctx.t('stage.noRaw') : '';
  // Overlays.
  const selected = dir === app.sel.direction;
  const pivot = selected && app.draft ? app.draft : selected && app.editor.snapshot?.metadata?.pivot ? app.editor.snapshot.metadata.pivot : detail.foot;
  const stroke = (x0, y0, x1, y1, colour) => { g.strokeStyle = colour; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  if (state.overlay.has('hitbox')) {
    const box = detail.hitbox ?? opaqueBounds(await store.read(frame.path));
    if (box) { g.strokeStyle = css('--danger'); g.setLineDash(detail.hitbox ? [] : [4, 3]); g.strokeRect(box[0] * zoom + .5, box[1] * zoom + .5, (box[2] - box[0]) * zoom - 1, (box[3] - box[1]) * zoom - 1); g.setLineDash([]); }
  }
  if (state.overlay.has('foot') && detail.foot) {
    g.fillStyle = css('--accent');
    g.fillRect(detail.foot[0] * zoom + Math.floor(zoom / 2) - 2, detail.foot[1] * zoom + Math.floor(zoom / 2) - 2, 5, 5);
  }
  if (state.overlay.has('pivot') && pivot) {
    const cx = pivot[0] * zoom + zoom / 2, cy = pivot[1] * zoom + zoom / 2, colour = css('--gold-soft');
    stroke(cx - 8, cy, cx + 8, cy, colour); stroke(cx, cy - 8, cx, cy + 8, colour);
  }
}

export function drawCells(app) {
  for (const cell of app.els.stage.querySelectorAll('.cell')) drawCell(app, cell).catch(error => {
    cell.querySelector('.cell-note').textContent = error.message;
  });
}

function updateStrip(app) {
  const live = app.liveFrame ?? app.sel.frame;
  for (const b of app.els.stage.querySelectorAll('.strip button')) b.setAttribute('aria-current', Number(b.dataset.n) === live ? 'true' : 'false');
  const label = app.els.stage.querySelector('.frame-label');
  if (label) label.textContent = app.ctx.t('stage.frameOf', {n: live + 1, total: clipFrames(app.detail, app.sel.clip, app.sel.direction).length});
}

export function setLive(app, n) {
  app.liveFrame = n;
  updateStrip(app);
  drawCells(app);
}

function stopPlay(app, commit) {
  if (!app.play.on) return;
  cancelAnimationFrame(app.play.raf);
  app.play.on = false;
  const n = app.liveFrame;
  app.liveFrame = null;
  if (commit && n != null) app.navigate({frame: n}, {replace: true});
  else renderStage(app);
}
export const pausePlayback = app => stopPlay(app, true);
export function cancelPlayback(app) { cancelAnimationFrame(app.play.raf); app.play.on = false; app.liveFrame = null; }

export function startPlay(app) {
  const list = clipFrames(app.detail, app.sel.clip, app.sel.direction);
  const {ms} = durations(app.detail, app.sel.clip, list.length);
  const loop = app.detail.clips[app.sel.clip]?.loop !== false;
  app.play.on = true;
  const origin = performance.now(), from = app.sel.frame;
  const offset = ms.slice(0, from).reduce((a, b) => a + b, 0);
  const tick = now => {
    if (!app.play.on) return;
    const n = frameAt(offset + (now - origin) * app.play.speed, ms, loop);
    if (n !== app.liveFrame) setLive(app, n);
    app.play.raf = requestAnimationFrame(tick);
  };
  app.liveFrame = from;
  renderStage(app);
  app.play.raf = requestAnimationFrame(tick);
}

/** A viewer key (see pixelview.shortcutFor) applied to the stage. Returns true when the key was used. */
export function handleKey(app, action) {
  if (!app.detail || !app.sel.clip) return false;
  const list = clipFrames(app.detail, app.sel.clip, app.sel.direction), n = list.length;
  const set = patch => { stopPlay(app, false); app.navigate(patch, {replace: true}); };
  if (action === 'play') { app.play.on ? stopPlay(app, true) : startPlay(app); return true; }
  if (action === 'prev' || action === 'next') { set({frame: (app.sel.frame + (action === 'next' ? 1 : -1) + n) % n}); return true; }
  if (action === 'zoomIn' || action === 'zoomOut') {
    const next = stepZoom(app.zoom, action === 'zoomIn' ? 1 : -1);
    if (next !== app.zoom) set({zoom: next});
    return true;
  }
  if (action === 'grid') { app.pv.grid = !app.pv.grid; setView(app.els.stage, {zoom: app.zoom, grid: app.pv.grid}); const box = app.els.stage.querySelector('[data-fk="pv-grid"]'); if (box) box.checked = app.pv.grid; return true; }
  return false;
}

export function renderStage(app) {
  const {ctx, detail, sel, state} = app;
  const root = app.els.stage;
  if (!detail) {
    if (app.stageError) return;
    root.replaceChildren(state.id ? h('div', {role: 'status'}, h('span', 'sr-only', ctx.t('common.loading')), h('span', 'skeleton line'), skeleton(2), h('span', 'skeleton block'))
      : notice(ctx, {title: ctx.t('stage.pickTitle'), body: ctx.t('stage.pick')}));
    return;
  }
  if (!sel.clip) {
    root.replaceChildren(h('header', 'stage-head', h('div', 'titles', h('h2', {title: detail.name ?? humanize(detail.id)}, detail.name ?? humanize(detail.id)), h('code', {title: detail.id}, detail.id))),
      notice(ctx, {body: ctx.t('stage.noFrames', {state: ctx.t('stage.' + detail.readiness)})}), detail.brief ? h('p', 'brief', detail.brief) : null);
    return;
  }
  const size = detail.size?.[0] ?? 32;
  app.zoom = state.zoom ?? autoZoom(root.clientWidth || 640, size);
  const live = app.liveFrame ?? sel.frame;
  const list = clipFrames(detail, sel.clip, sel.direction);
  const {ms, assumed} = durations(detail, sel.clip, list.length);
  const set = patch => { stopPlay(app, false); app.navigate(patch, {replace: true}); };
  const toggle = (name, label) => h('label', 'toggle', h('input', {type: 'checkbox', 'data-fk': 'ov-' + name, checked: state.overlay.has(name),
    onchange: event => { const next = new Set(state.overlay); event.target.checked ? next.add(name) : next.delete(name); set({overlay: next}); }}), label);
  const seg = h('div', {class: 'seg', role: 'group', 'aria-label': ctx.t('stage.compare')}, ...compares.map(mode =>
    h('button', {type: 'button', 'data-fk': 'cmp-' + mode, 'aria-pressed': String(state.compare === mode), onclick: () => set({compare: mode})}, ctx.t('compare.' + mode))));
  const size2 = [detail.size?.[0] ?? 32, detail.size?.[1] ?? 32];
  const setWipe = fraction => { app.pv.wipe = fraction; const input = root.querySelector('.pv-wipe-input'); if (input) input.value = String(Math.round(fraction * 100)); drawCells(app); };
  const coords = pixelToolbar({labels: {zoom: ctx.t('stage.zoom'), zoomIn: ctx.t('pv.zoomIn'), zoomOut: ctx.t('pv.zoomOut'), auto: ctx.t('stage.auto'), grid: ctx.t('pv.grid'), gridHint: ctx.t('pv.gridHint'),
      bg: ctx.t('pv.bg'), bgNames: {dark: ctx.t('pv.bg.dark'), light: ctx.t('pv.bg.light'), palette: ctx.t('pv.bg.palette')}, wipe: ctx.t('pv.wipe'), coords: ctx.t('pv.coords'), none: ctx.t('pv.none')},
    zoom: app.zoom, auto: !state.zoom, grid: app.pv.grid, bg: app.pv.bg, wipe: state.compare === 'split' ? app.pv.wipe : null,
    onZoom: z => set({zoom: z}), onGrid: on => { app.pv.grid = on; setView(root, {zoom: app.zoom, grid: on}); },
    onBg: name => { app.pv.bg = name; setView(root, {bg: name}); }, onWipe: setWipe});
  const cells = sel.directions.map(dir => {
    const cell = h('div', {class: 'cell', 'data-dir': dir, 'aria-current': dir === sel.direction ? 'true' : 'false'},
      h('button', {type: 'button', class: 'chip cell-name', 'data-fk': 'dir-' + dir, onclick: () => set({direction: dir, frame: Math.min(sel.frame, clipFrames(detail, sel.clip, dir).length - 1)})},
        ctx.t('dir.' + dir), dir === sel.direction ? h('span', 'sr-only', ' ' + ctx.t('stage.selected')) : null),
      pixelFrame({size: size2, bg: app.pv.bg, zoom: app.zoom, grid: app.pv.grid, canvas: h('canvas', {width: size2[0] * app.zoom, height: size2[1] * app.zoom, role: 'img',
        'aria-label': ctx.t('stage.canvasLabel', {id: detail.id, dir: ctx.t('dir.' + dir), clip: sel.clip})})}),
      h('span', 'cell-note muted small'));
    const canvas = cell.querySelector('canvas');
    trackPointer(canvas, size2, coords.coords, ctx.t('pv.none'));
    const wiping = state.compare === 'split';
    const drag = wiping ? dragWipe(canvas, fraction => setWipe(fraction)) : null;
    if (wiping) cell.querySelector('.pv').dataset.wipe = '';
    canvas.addEventListener('click', event => {
      if (drag && (dir === sel.direction || drag.moved())) return;
      if (dir !== sel.direction) { set({direction: dir}); return; }
      if (!app.editor.editable) return;
      const at = pixelAt(event.clientX, event.clientY, canvas.getBoundingClientRect(), size2);
      if (at) app.setDraft(at);
    });
    return cell;
  });
  const strip = h('ol', {class: 'strip', 'aria-label': ctx.t('stage.timeline')}, ...list.map((f, i) => {
    const thumb = h('canvas', {width: size * 3, height: (detail.size?.[1] ?? 32) * 3, 'aria-hidden': 'true'});
    app.store.load(f.path).then(img => { const g = thumb.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, thumb.width, thumb.height); });
    return h('li', {}, h('button', {type: 'button', class: 'btn quiet', 'data-n': i, 'data-fk': 'frame-' + i, 'aria-current': i === live ? 'true' : 'false', title: f.path,
      'aria-label': ctx.t('stage.frameButton', {n: i + 1, ms: ms[i]}), onclick: () => set({frame: i})}, thumb,
    h('span', 'ms', ms[i] + (assumed ? '*' : '') + ' ms')));
  }));
  const speed = h('select', {class: 'field', 'data-fk': 'speed', 'aria-label': ctx.t('stage.speed'), onchange: event => { app.play.speed = Number(event.target.value); if (app.play.on) { stopPlay(app, false); startPlay(app); } }},
    ...[0.25, 0.5, 1, 2].map(v => h('option', {value: v, selected: app.play.speed === v}, v + '×')));
  // Clip tabs: choosing one plays it right here on the stage (a still first frame under reduced motion); choosing the clip on show toggles playback.
  const pickClip = c => {
    if (c === sel.clip) { app.play.on ? stopPlay(app, true) : startPlay(app); return; }
    app.playNext = !reducedMotion(window);
    set({clip: c, frame: 0});
  };
  const clipTabs = h('div', {class: 'clip-tabs', role: 'tablist', 'aria-label': ctx.t('stage.clips')}, ...sel.clips.map(c =>
    h('button', {type: 'button', class: 'chip', role: 'tab', 'data-fk': 'clip-' + c, 'aria-selected': String(c === sel.clip), tabindex: c === sel.clip ? '0' : '-1',
      onclick: () => pickClip(c), onkeydown: event => {
        const at = sel.clips.indexOf(c), to = {ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: sel.clips.length - 1}[event.key];
        if (to == null || event.repeat) return;
        event.preventDefault(); event.stopPropagation();
        const next = sel.clips[(to + sel.clips.length) % sel.clips.length];
        app.focusClip = next;
        pickClip(next);
      }}, humanize(c), h('b', 'count', String(detail.clips[c]?.frames ?? '')))));
  const keep = root.contains(document.activeElement) ? document.activeElement.closest('[data-fk]')?.dataset.fk : null;
  root.replaceChildren(
    h('header', 'stage-head', h('div', 'titles', h('h2', {title: detail.name ?? humanize(detail.id)}, detail.name ?? humanize(detail.id)), h('code', {title: detail.id}, detail.id)),
      badge('readiness', detail.readiness, ctx.t('stage.' + detail.readiness)),
      h('span', 'meta', [humanize(detail.category), detail.size?.join('×'), detail.chunk && humanize(detail.chunk), detail.agent].filter(Boolean).join(' · '))),
    detail.brief ? h('p', 'brief', detail.brief) : null,
    h('div', 'toolbar', app.raw.bakeFrames.length ? h('div', {class: 'seg', role: 'group', 'aria-label': ctx.t('stage.frameSource')}, ...['library', 'bake'].map(name =>
      h('button', {type: 'button', 'aria-pressed': String(state.frames === name), onclick: () => set({frames: name})}, ctx.t('source.' + name)))) : null, seg, h('label', 'toggle', h('input', {type: 'checkbox', 'data-fk': 'onion', checked: state.onion, onchange: event => set({onion: event.target.checked})}), ctx.t('stage.onion')),
      toggle('pivot', ctx.t('stage.pivot')), toggle('foot', ctx.t('stage.foot')), toggle('hitbox', ctx.t('stage.hitbox')),
      coords.el),
    h('div', {class: 'turnaround', tabindex: '0', 'aria-label': ctx.t('stage.turnaround'), 'aria-describedby': 'stage-keys'}, ...cells),
    h('p', {class: 'muted small', id: 'stage-keys'}, ctx.t('stage.keys')),
    h('p', 'muted small', state.frames === 'bake' ? ctx.t('stage.bakeNote') + ' ' : '', state.compare !== 'processed' ? ctx.t('stage.compareHelp.' + state.compare) : '', ' ',
      !detail.hitbox && state.overlay.has('hitbox') ? ctx.t('stage.hitboxFallback') : '', ' ', app.editor.editable && state.overlay.has('pivot') ? ctx.t('stage.pivotHelp') : ''),
    h('div', 'timeline', clipTabs,
      h('div', 'transport', h('button', {type: 'button', class: 'btn primary play', 'data-fk': 'play', 'aria-pressed': String(app.play.on), onclick: () => app.play.on ? stopPlay(app, true) : startPlay(app)},
        app.play.on ? ctx.t('stage.pause') : ctx.t('stage.play')), speed, h('span', {class: 'frame-label muted', role: 'status'}, ctx.t('stage.frameOf', {n: live + 1, total: list.length})),
      h('span', 'muted small', assumed ? ctx.t('stage.assumedMs', {ms: detail.defaultFrameMs}) : ctx.t('stage.projectMs')), h('span', 'muted small', detail.clips[sel.clip]?.loop === false ? ctx.t('stage.oneShot') : ctx.t('stage.loops'))),
      strip));
  const focus = app.focusClip ? 'clip-' + app.focusClip : keep; app.focusClip = null;
  if (focus) root.querySelector(`[data-fk="${focus}"]`)?.focus();
  drawCells(app);
}
