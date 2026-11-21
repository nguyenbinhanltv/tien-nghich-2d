// The tool workspace must show an alert, not throw, when loading fails (no DOM needed: a tiny stub).
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
  constructor(tag) { this.tag = tag; this.attrs = {}; this.kids = []; this.className = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...k) { this.kids.push(...k); }
  replaceChildren(...k) { this.kids = k; }
  text() { return this.kids.map(k => typeof k === 'string' ? k : k.text()).join(''); }
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
