// The tool workspace must show an alert, not throw, when loading fails (no DOM needed: a tiny stub).
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...k) { this.kids.push(...k); }
  replaceChildren(...k) { this.kids = k; }
  addEventListener() {}
  getBoundingClientRect() { return {left: 0, top: 0, width: 1, height: 1}; }
  text() { return (this.textContent ?? '') + this.kids.map(k => typeof k === 'string' ? k : k.text()).join(''); }
}
globalThis.document = {createElement: tag => new El(tag)};
const { renderTool } = await import('./tools.mjs');

const app = fail => ({
  ctx: {t: (key, vars) => key + (vars ? JSON.stringify(vars) : '')},
  state: {tool: 'blob', zoom: 3, seed: 1, ins: null, fill: 100},
  selected: () => ({id: 'a', source: 'core'}),
  detail: async () => { throw fail; }
});

test('a failed load renders an alert and does not reject', async () => {
  const host = new El('div');
  await renderTool(app(new Error('boom')), host);
  assert.equal(host.kids.length, 1);
  assert.equal(host.kids[0].attrs.role, 'alert');
  assert.match(host.kids[0].text(), /common\.error.*boom/);
});

test('an aborted load leaves the host alone', async () => {
  const host = new El('div');
  await renderTool(app(Object.assign(new Error('x'), {name: 'AbortError'})), host);
  assert.ok(!host.kids.some(k => k.attrs?.role === 'alert'));
});

// The tools must actually run, not only fail gracefully: render each UI tool through renderTool with a stub DOM and image.
globalThis.Image = class { set src(path) { this.path = path; this.naturalWidth = 64; this.naturalHeight = 8; queueMicrotask(() => this.onload?.()); } };
const origCreate = globalThis.document.createElement;
globalThis.document = {createElement: tag => { const el = origCreate(tag); if (tag === 'canvas') el.getContext = () => ({imageSmoothingEnabled: true, calls: [], drawImage(...a) { this.calls.push(a); }, scale() {}, fillRect() {}}); return el; }};
const findAll = (el, pred, out = []) => { if (pred(el)) out.push(el); for (const k of el.kids ?? []) if (typeof k !== 'string') findAll(k, pred, out); return out; };

const toolApp = (tool, extra = {}) => {
  let navigated;
  const app = {
    ctx: {t: (key, vars) => key + (vars ? JSON.stringify(vars) : '')},
    state: {tool, zoom: 3, seed: 1, ins: null, fill: 60, clip: null, frame: null, ...extra},
    selected: () => ({id: 'ui_hud_bars', source: 'core'}),
    detail: async () => ({clips: {}, frames: [{clip: 'hp', direction: 'none', n: 0, path: 'assets/processed/ui/hp_none_0.png'}, {clip: 'qi', direction: 'none', n: 0, path: 'assets/processed/ui/qi_none_0.png'}]}),
    go: (...a) => { navigated = a; }
  };
  return {app, navigated: () => navigated};
};

test('the HUD tool renders: 60% of a 64 px bar is 38 px, drawn from the left edge', async () => {
  const host = new El('div');
  const {app} = toolApp('hud');
  await renderTool(app, host);
  assert.ok(!findAll(host, e => e.attrs?.role === 'alert').length, 'no error alert: ' + host.text());
  const canvases = findAll(host, e => e.tag === 'canvas');
  assert.equal(canvases.length, 1);
  assert.match(canvases[0].attrs['aria-label'], /hud\.canvas.*"fill":60/);
  assert.match(host.text(), /hud\.clip.*"fill":60,"cw":38,"w":64/);
});

test('the nine-slice tool renders every preview size', async () => {
  const host = new El('div');
  const {app} = toolApp('nine');
  await renderTool(app, host);
  assert.ok(!findAll(host, e => e.attrs?.role === 'alert').length, host.text());
  assert.equal(findAll(host, e => e.tag === 'canvas').length, 5);
});
