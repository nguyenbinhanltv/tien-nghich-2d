// Pixel viewer: integer zoom, pixel grid, checker backgrounds, pointer-to-pixel coordinates, wipe position and keyboard shortcuts.
// The top half is pure (Node tests cover it); the bottom half builds small DOM pieces and holds no project data.
// Contract and usage: studio/ui/README.md, section "Pixel viewer". Styles: pixelview.css (loaded by the caller with ctx.loadCss).

/** The only zoom levels. There is no fractional zoom and no 5x or 7x. */
export const ZOOMS = Object.freeze([1, 2, 3, 4, 6, 8, 12, 16]);
/** The grid is drawn from this zoom up; below it a one-pixel line would cover too much of a pixel. */
export const GRID_MIN_ZOOM = 8;
export const BACKGROUNDS = Object.freeze(['dark', 'light', 'palette']);

/** The allowed zoom nearest to `n` (ties go down). Junk gives 1. */
export function snapZoom(n) {
  if (!Number.isFinite(n)) return 1;
  let best = ZOOMS[0];
  for (const z of ZOOMS) if (Math.abs(z - n) < Math.abs(best - n)) best = z;
  return best;
}

/** The largest allowed zoom that is not above `n` (at least 1): for "fit this many pixels", where rounding up would overflow. */
export function fitZoom(n) {
  let best = ZOOMS[0];
  for (const z of ZOOMS) if (z <= n) best = z;
  return best;
}

/** One level up (`+1`) or down (`-1`) from any zoom; stays at the ends. */
export function stepZoom(zoom, direction) {
  const at = ZOOMS.indexOf(snapZoom(zoom));
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, at + (direction < 0 ? -1 : 1)))];
}

export const isZoom = n => ZOOMS.includes(n);
export const gridShown = (zoom, on) => Boolean(on) && zoom >= GRID_MIN_ZOOM;

/** The pixel under a pointer. `rect` is the canvas's on-screen box, `size` its native [width, height]; null outside the image. */
export function pixelAt(clientX, clientY, rect, size) {
  if (!rect || !rect.width || !rect.height) return null;
  const x = Math.floor((clientX - rect.left) / rect.width * size[0]);
  const y = Math.floor((clientY - rect.top) / rect.height * size[1]);
  return x >= 0 && y >= 0 && x < size[0] && y < size[1] ? [x, y] : null;
}

/** The on-screen box of one native pixel at integer zoom, relative to the canvas origin. */
export const pixelBox = (x, y, zoom) => ({x: x * zoom, y: y * zoom, w: zoom, h: zoom});

/** Where a pointer sits across the image as 0..1, clamped. */
export function wipeFraction(clientX, rect) {
  if (!rect || !rect.width) return 0.5;
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

/** The native column where the wipe line falls: a whole pixel, 0..width. */
export const wipeColumn = (fraction, width) => Math.max(0, Math.min(width, Math.round(fraction * width)));

/** True when the event target is somewhere the user types or picks, where shortcuts must stay out of the way. */
export function isTyping(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}
const MODAL = 'dialog[open], [aria-modal="true"]';
/** True when a modal is up: the key came from inside one, or a dialog is open anywhere (the page behind it must not react). */
export function inModal(target) {
  if (target && typeof target.closest === 'function' && target.closest(MODAL)) return true;
  return typeof document !== 'undefined' && Boolean(document.querySelector?.('dialog[open]'));
}
const pressable = target => Boolean(target?.closest?.('button, a[href], summary, [role="button"], [role="tab"]'));

/**
 * The viewer action for a key event, or null. Space is left to a focused button, link or summary (it activates it),
 * and everything is left alone while typing, with Ctrl, Meta or Alt held, or while a modal dialog is open. Actions: play, prev, next, zoomIn, zoomOut, grid.
 */
export function shortcutFor(event) {
  if (!event || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || inModal(event.target)) return null;
  switch (event.key) {
    case ' ': case 'Spacebar': return event.repeat || pressable(event.target) ? null : 'play';
    case 'ArrowLeft': return 'prev';
    case 'ArrowRight': return 'next';
    case '+': case '=': return 'zoomIn';
    case '-': case '_': return 'zoomOut';
    case 'g': case 'G': return event.repeat ? null : 'grid';
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------- DOM

function el(tag, attrs, ...kids) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue;
    if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

/** Listen for the viewer keys on the document. Returns the function that stops listening. `handle(action, event)` returns true if it used the key. */
export function installShortcuts(handle) {
  const onKey = event => {
    const action = shortcutFor(event);
    if (action && handle(action, event) === true) event.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}

/** A canvas in a frame that can show the pixel grid and a checker background without redrawing the canvas. */
export function pixelFrame({canvas, size, bg = 'dark', zoom = 1, grid = true}) {
  const gridLayer = el('span', {class: 'pv-grid', 'aria-hidden': 'true'});
  const frame = el('div', {class: 'pv', style: `--pv-cols:${size[0]};--pv-rows:${size[1]}`}, canvas, gridLayer);
  setView(frame, {bg, zoom, grid});
  return frame;
}

/** Apply background and grid to every pixel frame under `root`, in place: no canvas is redrawn and keyboard focus stays where it is. */
export function setView(root, {bg, zoom, grid}) {
  for (const frame of root.matches?.('.pv') ? [root] : root.querySelectorAll('.pv')) {
    if (bg) frame.dataset.bg = BACKGROUNDS.includes(bg) ? bg : 'dark';
    if (zoom != null || grid != null) frame.dataset.grid = gridShown(zoom ?? Number(frame.dataset.zoom), grid) ? 'on' : 'off';
    if (zoom != null) frame.dataset.zoom = String(zoom);
  }
}

/**
 * Report the pixel under the pointer to `out` (an element, usually an <output>). Writes only when the pixel changes, so it costs
 * nothing while a clip plays. `none` is the text when the pointer is off the image.
 */
export function trackPointer(canvas, size, out, none = '–') {
  let last = '';
  const show = text => { if (text !== last) { last = text; out.textContent = text; } };
  canvas.addEventListener('pointermove', event => {
    const at = pixelAt(event.clientX, event.clientY, canvas.getBoundingClientRect(), size);
    show(at ? `${at[0]}, ${at[1]}` : none);
  });
  canvas.addEventListener('pointerleave', () => show(none));
}

/**
 * Drag across a frame to place the wipe. `onWipe(fraction)` runs at most once per animation frame. `moved()` tells a click handler
 * whether the pointer travelled (so a drag does not also count as a click).
 */
export function dragWipe(canvas, onWipe) {
  let down = null, moved = false, raf = 0, pending = 0;
  const flush = () => { raf = 0; onWipe(pending); };
  const put = event => { pending = wipeFraction(event.clientX, canvas.getBoundingClientRect()); if (!raf) raf = requestAnimationFrame(flush); };
  canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; down = event.clientX; moved = false; canvas.setPointerCapture?.(event.pointerId); put(event); });
  canvas.addEventListener('pointermove', event => { if (down == null) return; if (Math.abs(event.clientX - down) > 3) moved = true; put(event); });
  const end = event => { down = null; canvas.releasePointerCapture?.(event.pointerId); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {moved: () => moved};
}

/**
 * The viewer's controls as one group: zoom out / zoom select / zoom in, grid switch, background choice and, when `wipe` is a number
 * (0..1), the wipe slider. Every control has a label; every change calls back and none redraws the group itself, so focus stays.
 * `labels`: zoom, zoomIn, zoomOut, auto, grid, gridHint, bg, bgNames {dark, light, palette}, wipe, coords, none.
 * Returns {el, coords} where `coords` is the <output> to hand to trackPointer.
 */
export function pixelToolbar({labels, zoom, auto, grid, bg, wipe, onZoom, onGrid, onBg, onWipe}) {
  const zoomSelect = el('select', {class: 'field', 'data-fk': 'pv-zoom', onchange: event => onZoom(event.target.value ? Number(event.target.value) : null)},
    el('option', {value: '', selected: auto}, labels.auto), ...ZOOMS.map(z => el('option', {value: z, selected: !auto && z === zoom}, z + '×')));
  const step = (direction, label, glyph) => el('button', {type: 'button', class: 'btn', 'data-fk': 'pv-zoom-' + glyph, 'aria-label': label, title: label,
    disabled: (direction < 0 && zoom <= ZOOMS[0]) || (direction > 0 && zoom >= ZOOMS.at(-1)), onclick: () => onZoom(stepZoom(zoom, direction))}, glyph === 'in' ? '+' : '−');
  const gridBox = el('input', {type: 'checkbox', checked: grid, 'data-fk': 'pv-grid', onchange: event => onGrid(event.target.checked)});
  const hint = el('span', {class: 'pv-hint muted'}, zoom < GRID_MIN_ZOOM ? labels.gridHint : '');
  const bgButtons = BACKGROUNDS.map(name => el('button', {type: 'button', 'data-fk': 'pv-bg-' + name, 'aria-pressed': String(bg === name),
    onclick: event => { for (const b of bgButtons) b.setAttribute('aria-pressed', String(b === event.currentTarget)); onBg(name); }}, labels.bgNames[name]));
  const coords = el('output', {class: 'pv-coords', 'aria-label': labels.coords}, labels.none);
  const wipeInput = typeof wipe === 'number' ? el('input', {type: 'range', min: 0, max: 100, step: 1, value: Math.round(wipe * 100), 'data-fk': 'pv-wipe',
    class: 'pv-wipe-input', 'aria-label': labels.wipe, oninput: event => onWipe(Number(event.target.value) / 100)}) : null;
  const root = el('div', {class: 'pv-bar'},
    el('div', {class: 'pv-group', role: 'group', 'aria-label': labels.zoom}, step(-1, labels.zoomOut, 'out'), el('label', {class: 'pv-zoom'}, el('span', {class: 'sr-only'}, labels.zoom), zoomSelect), step(1, labels.zoomIn, 'in')),
    el('label', {class: 'toggle'}, gridBox, labels.grid), hint,
    el('div', {class: 'seg', role: 'group', 'aria-label': labels.bg}, ...bgButtons),
    wipeInput ? el('label', {class: 'pv-wipe'}, labels.wipe, wipeInput) : null,
    el('span', {class: 'pv-readout muted small'}, labels.coords + ' ', coords));
  return {el: root, coords, wipeInput, hint};
}
