// Tool workspaces that replace the grid: 47-tile sheet + autotiling test room, nine-slice, HUD bar clipping.
import { h, imgUrl, loadImage, button, pixelCanvas, fill, emptyBox, loadingBox, errorBox } from './dom.mjs';
import { framesOf, framesOfClip, clipNames, blobSheets, bitmaskMap, testRoom, autotile, floorTilePath, blobMasks,
  defaultInsets, clampInsets, nineSlice, nineSizes, hudClipWidth } from './model.mjs';

const none = (app, key) => emptyBox(app.ctx.t(key));

export async function renderTool(app, host) {
  const {ctx, state} = app;
  const entry = app.selected();
  if (!entry) return fill(host, none(app, 'tool.pick'));
  fill(host, loadingBox(ctx.t('common.loading')));
  let node;
  try {
    const detail = await app.detail(entry);
    const frames = framesOf(detail);
    node = await {blob: blobTool, nine: nineTool, hud: hudTool}[state.tool](app, entry, detail, frames);
  } catch (error) {
    if (error.name === 'AbortError') return;
    return fill(host, errorBox(ctx.t('common.error', {message: error.message}), ctx.t('common.retry'), () => app.repaint()));
  }
  fill(host, h('h2', 'toolname', ctx.t('tool.' + state.tool), ' ', h('code', '', entry.id)), node);
}

/** A frame chooser shared by the UI tools: every frame of the asset as `clip n`. */
function frameChooser(app, frames) {
  const {ctx, state} = app;
  const clip = clipNames(frames).includes(state.clip) ? state.clip : clipNames(frames)[0];
  const n = framesOfClip(frames, clip).some(f => f.n === state.frame) ? state.frame : framesOfClip(frames, clip)[0]?.n ?? 0;
  const sel = h('select', {id: 'ob-frame', class: 'field', 'aria-label': ctx.t('tool.frame')}, ...frames.map(f => h('option', {value: `${f.clip}:${f.n}`, selected: f.clip === clip && f.n === n ? 'selected' : null}, `${f.clip} · ${f.n}`)));
  sel.addEventListener('change', () => { const [c, i] = sel.value.split(':'); app.go({}, {clip: c, frame: Number(i)}); });
  return [sel, frames.find(f => f.clip === clip && f.n === n)];
}

// ---- 47-tile blob sheet and the autotiling test room ----------------------------------------

async function blobTool(app, entry, detail, frames) {
  const {ctx, state} = app;
  const sheets = blobSheets(detail.record, frames);
  if (!sheets.length) return none(app, 'blob.none');
  const sheet = sheets.includes(state.sheet) ? state.sheet : sheets[0];
  const role = id => detail.record.sheets.find(s => s.id === id)?.role ?? id;
  const tiles = framesOfClip(frames, sheet);
  const imgs = new Map(await Promise.all(tiles.map(async f => [f.n, await loadImage(f.path)])));
  const map = bitmaskMap(null);
  const tile = imgs.get(tiles[0].n).naturalWidth;
  const picker = h('select', {id: 'ob-sheet', class: 'field', 'aria-label': ctx.t('blob.sheet')}, ...sheets.map(s => h('option', {value: s, selected: s === sheet ? 'selected' : null}, `${s} — ${role(s)}`)));
  picker.addEventListener('change', () => app.go({sheet: picker.value}));
  // the sheet: 47 tiles in index order, labelled with their gated neighbour mask
  const sheetGrid = h('ol', {class: 'blobsheet checker', style: `--tile:${tile * state.zoom}px`, 'aria-label': ctx.t('blob.sheetLabel', {count: tiles.length})},
    ...tiles.map(f => h('li', '', h('img', {src: imgUrl(f.path), alt: '', draggable: 'false', width: tile * state.zoom, height: tile * state.zoom}),
      h('small', '', `${f.n}`), h('small', 'mask', `#${map.tileToMask.get(f.n) ?? '?'}`))));
  // the room
  const floorId = sheets.find(s => /^floor/i.test(role(s)));
  const floorPath = sheet !== floorId ? floorTilePath(frames, floorId, map) : null;
  const floorTile = floorPath ? await loadImage(floorPath).catch(() => null) : null;
  const grid = testRoom(state.seed);
  const room = h('div', 'room');
  const draw = async () => {
    const solid = autotile(grid, 1, map);
    const [c, g] = pixelCanvas(grid[0].length * tile * state.zoom, grid.length * tile * state.zoom);
    const z = tile * state.zoom;
    grid.forEach((row, y) => row.forEach((cell, x) => {
      if (cell === 0 && floorTile) g.drawImage(floorTile, x * z, y * z, z, z);
      const idx = solid[y][x];
      if (idx != null && imgs.has(idx)) g.drawImage(imgs.get(idx), x * z, y * z, z, z);
    }));
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', ctx.t('blob.roomLabel', {w: grid[0].length, h: grid.length}));
    c.addEventListener('click', ev => {
      const r = c.getBoundingClientRect(), x = Math.floor((ev.clientX - r.left) / (r.width / grid[0].length)), y = Math.floor((ev.clientY - r.top) / (r.height / grid.length));
      if (x > 0 && y > 0 && x < grid[0].length - 1 && y < grid.length - 1) { grid[y][x] ^= 1; draw(); }
    });
    fill(room, c);
  };
  await draw();
  const reseed = button(ctx.t('blob.reseed'), () => app.go({seed: (state.seed % 999999) + 1}));
  const clear = button(ctx.t('blob.clear'), () => { grid.forEach((row, y) => row.forEach((_, x) => { grid[y][x] = y === 0 || x === 0 || y === grid.length - 1 || x === row.length - 1 ? 1 : 0; })); draw(); });
  return h('div', 'toolbody',
    h('div', 'toolbar', h('label', {for: 'ob-sheet'}, ctx.t('blob.sheet')), picker, reseed, clear, h('span', 'muted', ctx.t('blob.seed', {seed: state.seed}))),
    h('h3', '', ctx.t('blob.sheetTitle')), sheetGrid,
    h('h3', '', ctx.t('blob.roomTitle')), h('p', 'muted', ctx.t('blob.roomHelp')), room,
    h('p', 'muted', ctx.t('blob.masks', {count: blobMasks.length})));
}

// ---- nine-slice -----------------------------------------------------------------------------

async function nineTool(app, entry, detail, frames) {
  const {ctx, state} = app;
  if (!frames.length) return none(app, 'tool.noFrames');
  const [chooser, frame] = frameChooser(app, frames);
  const img = await loadImage(frame.path);
  const w = img.naturalWidth, hgt = img.naturalHeight;
  const ins = clampInsets(state.ins ?? defaultInsets(w, hgt), w, hgt);
  const names = ['L', 'T', 'R', 'B'];
  const inputs = names.map((n, i) => {
    const input = h('input', {type: 'number', class: 'field', min: 0, max: i % 2 ? hgt : w, value: ins[i], id: 'ob-ins-' + n, 'aria-label': ctx.t('nine.inset.' + n)});
    input.addEventListener('change', () => { const next = [...ins]; next[i] = Math.max(0, Math.floor(Number(input.value) || 0)); app.go({ins: next}, {replace: true}); });
    return h('label', 'inset', h('span', '', n), input);
  });
  const outs = nineSizes(w, hgt).map(([dw, dh]) => {
    const [c, g] = pixelCanvas(dw * state.zoom, dh * state.zoom);
    g.scale(state.zoom, state.zoom);
    for (const [sx, sy, sw, sh, dx, dy, ddw, ddh] of nineSlice(w, hgt, dw, dh, ins)) g.drawImage(img, sx, sy, sw, sh, dx, dy, ddw, ddh);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', ctx.t('nine.canvas', {w: dw, h: dh}));
    return h('figure', 'ninefig', h('span', 'checker', c), h('figcaption', '', `${dw}×${dh}`));
  });
  return h('div', 'toolbody',
    h('div', 'toolbar', h('label', {for: 'ob-frame'}, ctx.t('tool.frame')), chooser, ...inputs),
    h('p', 'muted', ctx.t('nine.help', {w, h: hgt})), h('div', 'ninegrid', ...outs));
}

// ---- HUD bar clipping -----------------------------------------------------------------------

async function hudTool(app, entry, detail, frames) {
  const {ctx, state} = app;
  if (!frames.length) return none(app, 'tool.noFrames');
  const [chooser, frame] = frameChooser(app, frames);
  const img = await loadImage(frame.path);
  const w = img.naturalWidth, hgt = img.naturalHeight;
  const out = h('div', 'hudout checker');
  const label = h('span', {class: 'tick', role: 'status'});
  const draw = pct => {
    const cw = hudClipWidth(w, pct);
    const [c, g] = pixelCanvas(w * state.zoom, hgt * state.zoom);
    if (cw > 0) g.drawImage(img, 0, 0, cw, hgt, 0, 0, cw * state.zoom, hgt * state.zoom);
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', ctx.t('hud.canvas', {fill: pct}));
    fill(out, c);
    label.textContent = ctx.t('hud.clip', {fill: pct, cw, w});
  };
  const range = h('input', {type: 'range', class: 'zoomrange', min: 0, max: 100, step: 1, value: state.fill, id: 'ob-fill', 'aria-label': ctx.t('hud.fill')});
  range.addEventListener('input', () => draw(Number(range.value)));
  range.addEventListener('change', () => app.go({fill: Number(range.value)}, {replace: true}));
  draw(state.fill);
  return h('div', 'toolbody',
    h('div', 'toolbar', h('label', {for: 'ob-frame'}, ctx.t('tool.frame')), chooser, h('label', {for: 'ob-fill'}, ctx.t('hud.fill')), range,
      ...[0, 25, 50, 75, 100].map(v => button(v + '%', () => { range.value = v; draw(v); app.go({fill: v}, {replace: true}); }))),
    h('p', 'muted', ctx.t('hud.help')), out, label);
}
