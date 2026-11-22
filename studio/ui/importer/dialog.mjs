// The spritesheet importer dialog, opened from the Characters and Objects tabs.
//   1 pick a PNG   2 set the cell size, offset and spacing; the grid is drawn over the sheet at a whole-number zoom
//   3 name the clip and direction, choose replace or append   4 check (a dry run), then import.
// The cut and every check happen on the server (studio/ui/importer/import.mjs, POST /api/tabs/<tab>/import):
// the dialog only draws the grid with the same arithmetic (cut.mjs) and shows what the server says.
import { h } from './dom.mjs';
import { cutGrid, selectCells } from './cut.mjs';

let loaded = {};
async function strings(lang) {
  if (!loaded[lang]) {
    const read = async code => (await fetch(new URL(`./i18n/${code}.json`, import.meta.url))).json();
    loaded[lang] = {...(await read('en')), ...(lang === 'en' ? {} : await read(lang).catch(() => ({})))};
  }
  return loaded[lang];
}
const fill = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);

const toBase64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/**
 * ctx: the tab's context (tab id, lang, project, announce, signal). `assetId`: what to import into. `onDone`: called after a
 * successful import so the tab can reload. Returns the <dialog>.
 */
export async function openImporter(ctx, {assetId, onDone}) {
  ctx.loadCss(new URL('./importer.css', import.meta.url));
  const T = await strings(ctx.lang ?? 'en');
  const tr = (key, vars) => fill(T[key] ?? key, vars);
  const base = `/api/tabs/${ctx.tab}/import`;
  const info = await (await fetch(`${base}?id=${encodeURIComponent(assetId)}`, {signal: ctx.signal})).json();
  if (info.error) throw new Error(info.error.message);
  const [nw, nh] = info.size;
  const clips = Object.keys(info.clips);

  const st = {bytes: null, image: null, sheet: null, zoom: 2, result: null, busy: false, error: null, checked: '', timer: 0, done: null};
  const vals = {w: nw, h: nh, ox: 0, oy: 0, sx: 0, sy: 0, skip: 0, count: '', clip: clips[0], direction: info.directions[0], mode: 'replace'};
  const dlg = h('dialog', {class: 'imp ui-kit', 'aria-labelledby': 'imp-title'});
  const canvas = h('canvas', {class: 'imp-canvas', 'aria-label': tr('canvas')});
  const status = h('p', {class: 'imp-status', role: 'status'});
  const report = h('div', 'imp-report');
  const grid = {};

  const num = (key, label, min = 0) => {
    const input = h('input', {type: 'number', class: 'field', id: 'imp-' + key, min, step: 1, value: vals[key], inputmode: 'numeric'});
    input.addEventListener('input', () => { vals[key] = input.value === '' ? '' : Number(input.value); changed(); });
    return h('label', {for: 'imp-' + key, class: 'imp-field'}, h('span', 'field-label', label), input);
  };
  const select = (key, label, options, show = o => o) => {
    const sel = h('select', {class: 'field', id: 'imp-' + key}, ...options.map(o => h('option', {value: o, ...(o === vals[key] ? {selected: true} : {})}, show(o))));
    sel.addEventListener('change', () => { vals[key] = sel.value; changed(); });
    return h('label', {for: 'imp-' + key, class: 'imp-field'}, h('span', 'field-label', label), sel);
  };

  const spec = () => ({sheetW: st.image?.width, sheetH: st.image?.height, cellW: vals.w, cellH: vals.h, offsetX: vals.ox, offsetY: vals.oy, spacingX: vals.sx, spacingY: vals.sy});
  const selection = () => ({skip: vals.skip === '' ? 0 : vals.skip, ...(vals.count === '' ? {} : {count: vals.count})});

  function layoutGrid() {
    try { grid.value = cutGrid(spec()); grid.chosen = selectCells(grid.value, selection()); grid.error = null; }
    catch (error) { grid.value = null; grid.chosen = []; grid.error = error.message; }
  }

  function draw() {
    const {image} = st;
    if (!image) { canvas.width = canvas.height = 0; return; }
    const z = st.zoom;
    canvas.width = image.width * z; canvas.height = image.height * z;
    const g = canvas.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.fillStyle = '#0003'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(image, 0, 0, canvas.width, canvas.height);
    if (!grid.value) return;
    const chosen = new Set(grid.chosen.map(c => c.index));
    g.lineWidth = 1;
    for (const c of grid.value.cells) {
      const on = chosen.has(c.index);
      g.strokeStyle = on ? (getComputedStyle(dlg).getPropertyValue('--gold').trim() || '#e0b040') : '#888';
      g.strokeRect(c.x * z + .5, c.y * z + .5, vals.w * z - 1, vals.h * z - 1);
      if (on) { g.fillStyle = '#000a'; g.fillRect(c.x * z + 1, c.y * z + 1, 14, 11); g.fillStyle = '#fff'; g.font = '10px monospace'; g.fillText(String(c.index), c.x * z + 3, c.y * z + 10); }
    }
  }

  const fit = () => { const room = Math.max(160, dlg.clientWidth - 360); st.zoom = Math.max(1, Math.min(8, Math.floor(room / st.image.width))); zoomInput.value = st.zoom; };

  function renderStatus() {
    if (!st.image) { status.textContent = tr('pick'); return; }
    if (grid.error) { status.textContent = grid.error; return; }
    const v = grid.value;
    const extra = v.leftoverX || v.leftoverY ? ' ' + tr('leftover', {x: v.leftoverX, y: v.leftoverY}) : '';
    status.textContent = tr('grid', {cols: v.cols, rows: v.rows, n: grid.chosen.length, w: st.image.width, h: st.image.height}) + extra;
  }

  const request = dryRun => ({assetId, sheetBase64: st.sheet, cell: {w: vals.w, h: vals.h, offsetX: vals.ox, offsetY: vals.oy, spacingX: vals.sx, spacingY: vals.sy},
    ...selection(), clip: vals.clip, direction: vals.direction, mode: vals.mode, dryRun});
  const keyOf = () => JSON.stringify([st.sheet?.length, request(true)]);

  async function post(dryRun) {
    const res = await fetch(base, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(request(dryRun)), signal: ctx.signal});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message ?? 'HTTP ' + res.status);
    return data;
  }

  async function check() {
    if (!st.sheet || grid.error) return;
    const key = keyOf();
    st.busy = true; st.error = null; renderReport();
    try { const r = await post(true); if (key === keyOf()) { st.result = r; st.checked = key; } }
    catch (error) { if (error.name !== 'AbortError') st.error = error.message; }
    st.busy = false; renderReport();
  }

  async function doImport() {
    st.busy = true; st.error = null; renderReport();
    try {
      const r = await post(false);
      st.result = r; st.checked = keyOf();
      if (r.ok) { st.done = r; ctx.announce(tr('imported', {n: r.frames.filter(f => f.action === 'new' || f.action === 'revision').length})); onDone?.(r); }
    } catch (error) { if (error.name !== 'AbortError') st.error = error.message; }
    st.busy = false; renderReport();
  }

  function thumb(f) {
    const c = h('canvas', {class: 'imp-thumb', width: vals.w * 2, height: vals.h * 2, 'aria-hidden': 'true'});
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(st.image, f.cell.x, f.cell.y, vals.w, vals.h, 0, 0, vals.w * 2, vals.h * 2);
    return c;
  }

  function renderReport() {
    const kids = [];
    const r = st.result && st.checked === keyOf() ? st.result : null;
    if (st.error) kids.push(h('p', {role: 'alert', class: 'toast danger imp-error'}, st.error));
    if (st.done) kids.push(h('p', {role: 'status', class: 'toast ok imp-done'}, tr('done', {n: st.done.frames.filter(f => f.action === 'new' || f.action === 'revision').length})), h('p', 'muted', tr('doneNote')));
    else if (r) {
      for (const reason of r.refused) kids.push(h('p', {role: 'alert', class: 'toast danger imp-error'}, reason.message));
      if (r.offer) kids.push(h('p', 'imp-offer', tr('offer'), ' ', h('span', 'muted', r.offer.pixelise)));
      if (r.frames.length) kids.push(h('ul', 'imp-frames', ...r.frames.map(f => h('li', {class: 'imp-' + f.action},
        thumb(f), h('div', '', h('code', '', f.name), h('span', {class: 'imp-badge'}, tr('action.' + f.action)),
          f.action === 'refused' ? h('small', '', f.reasons.map(x => `${x.code} ×${x.count}`).join(', ') + (f.defects[0] ? ` · ${tr('first', {x: f.defects[0].x, y: f.defects[0].y})}` : '')) : null)))));
      if (r.ok) kids.push(h('p', 'muted', tr(r.frames.some(f => f.action === 'revision') ? 'willRevise' : 'willAdd')));
    } else if (st.busy) kids.push(h('p', 'muted', tr('checking')));
    report.replaceChildren(...kids);
    importBtn.disabled = st.busy || !r?.ok || !r.frames.some(f => f.action === 'new' || f.action === 'revision') || Boolean(st.done);
    dlg.toggleAttribute('aria-busy', st.busy);
  }

  function changed() {
    st.done = null; st.result = null;
    layoutGrid(); renderStatus(); draw(); renderReport();
    clearTimeout(st.timer);
    if (st.sheet && !grid.error) st.timer = setTimeout(check, 350);
  }

  const file = h('input', {type: 'file', class: 'field', id: 'imp-file', accept: 'image/png'});
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    st.error = null;
    if (f.size > info.limits.bytes) { st.error = tr('tooBig', {max: Math.round(info.limits.bytes / 1024)}); renderReport(); return; }
    st.bytes = new Uint8Array(await f.arrayBuffer());
    st.sheet = toBase64(st.bytes);
    try { st.image = await createImageBitmap(new Blob([st.bytes], {type: 'image/png'})); }
    catch { st.image = null; st.sheet = null; st.error = tr('unreadable'); }
    if (st.image) fit();
    changed();
  });
  const zoomInput = h('input', {type: 'number', class: 'field', id: 'imp-zoom', min: 1, max: 8, step: 1, value: st.zoom});
  zoomInput.addEventListener('input', () => { st.zoom = Math.max(1, Math.min(8, Math.round(Number(zoomInput.value)) || 1)); draw(); });
  const importBtn = h('button', {type: 'button', class: 'btn primary', disabled: true}, tr('import'));
  importBtn.addEventListener('click', doImport);
  const modes = h('fieldset', 'imp-modes', h('legend', '', tr('mode')), ...['replace', 'append'].map(m => {
    const input = h('input', {type: 'radio', name: 'imp-mode', id: 'imp-mode-' + m, value: m, ...(vals.mode === m ? {checked: true} : {})});
    input.addEventListener('change', () => { vals.mode = m; changed(); });
    return h('label', {for: 'imp-mode-' + m}, input, ' ', tr('mode.' + m));
  }), h('p', 'muted', tr('mode.note')));
  const existing = h('p', 'muted imp-existing');
  const updateExisting = () => { const have = info.existing[`${vals.clip}/${vals.direction}`] ?? []; existing.textContent = tr('existing', {clip: vals.clip, n: info.clips[vals.clip], have: have.length ? have.join(', ') : tr('none')}); };

  const clipSel = select('clip', tr('clip'), clips), dirSel = select('direction', tr('direction'), info.directions);
  for (const sel of [clipSel, dirSel]) sel.querySelector('select').addEventListener('change', updateExisting);
  updateExisting();

  dlg.append(
    h('header', 'imp-head', h('h2', {id: 'imp-title'}, tr('title', {id: assetId})), h('button', {type: 'button', class: 'btn quiet', onclick: () => dlg.close(), 'aria-label': tr('close')}, '×')),
    h('div', 'imp-body',
      h('div', 'imp-left', h('div', 'imp-pick', h('label', {for: 'imp-file'}, tr('file')), file,
        h('label', {for: 'imp-zoom', class: 'imp-zoomlabel'}, tr('zoom'), zoomInput)), h('div', 'imp-stage', canvas), status),
      h('div', 'imp-right',
        h('fieldset', 'imp-cells', h('legend', '', tr('cells', {w: nw, h: nh})), h('div', 'imp-grid', num('w', tr('cellW'), 1), num('h', tr('cellH'), 1), num('ox', tr('offsetX')), num('oy', tr('offsetY')), num('sx', tr('spacingX')), num('sy', tr('spacingY')),
          num('skip', tr('skip')), num('count', tr('count'), 1))),
        h('fieldset', 'imp-target', h('legend', '', tr('target')), h('div', 'imp-grid', clipSel, dirSel), existing), modes, report)),
    h('footer', 'imp-foot', h('button', {type: 'button', class: 'btn', onclick: () => check()}, tr('check')), importBtn, h('button', {type: 'button', class: 'btn', onclick: () => dlg.close()}, tr('close'))));
  dlg.addEventListener('close', () => { clearTimeout(st.timer); dlg.remove(); });
  ctx.root.append(dlg); // inside the tab's own element, which the shell empties when the tab goes away
  layoutGrid(); renderStatus(); renderReport();
  dlg.showModal();
  file.focus();
  return dlg;
}

/** The tab's entry point: a button that opens the dialog for one asset. `label` is the tab's own translated text. */
export function importButton(ctx, {assetId, label, onDone}) {
  const message = h('span', {class: 'imp-open-error', role: 'alert'});
  const button = h('button', {type: 'button', class: 'btn imp-open'}, label);
  button.addEventListener('click', async () => {
    message.textContent = ''; message.className = 'imp-open-error';
    button.disabled = true;
    try { const dlg = await openImporter(ctx, {assetId, onDone}); dlg.addEventListener('close', () => button.focus()); }
    catch (error) { if (error.name !== 'AbortError') { message.textContent = error.message; message.className = 'toast danger imp-open-error'; } }
    button.disabled = false;
  });
  return h('span', 'imp-entry ui-kit', button, message);
}
