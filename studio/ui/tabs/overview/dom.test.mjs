import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// A minimal fake DOM: enough to observe how h() sets class, attributes and children.
class FakeElement {
  constructor(tag) { this.tag = tag; this.className = ''; this.attrs = {}; this.children = []; }
  setAttribute(name, value) { this.attrs[name] = value; }
  append(...kids) { this.children.push(...kids); }
}
globalThis.document = {createElement: tag => new FakeElement(tag)};
const { h } = await import('./dom.mjs');

test('a string is the class name', () => {
  const el = h('td', 'barcell', 'x');
  assert.equal(el.className, 'barcell');
  assert.deepEqual(el.attrs, {});
  assert.deepEqual(el.children, ['x']);
});

test('an object sets attributes, never "[object Object]" as the class', () => {
  const th = h('th', {scope: 'col', class: 'num'}, 'IDs');
  assert.equal(th.className, '', 'class goes through setAttribute');
  assert.deepEqual(th.attrs, {scope: 'col', class: 'num'});
  assert.equal(h('p', {role: 'alert'}).attrs.role, 'alert');
  assert.deepEqual(h('b', {hidden: true, skip: false, none: null}).attrs, {hidden: ''});
});

test('empty children are skipped and bad attrs are rejected', () => {
  assert.deepEqual(h('i', undefined, null, false, 'a', undefined, 'b').children, ['a', 'b']);
  assert.throws(() => h('i', 42), TypeError);
});

test('the tab module has no private element builder and no object className', () => {
  const source = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /function h\(/, 'index.mjs must use the shared builder from dom.mjs');
  assert.doesNotMatch(source, /className\s*=\s*\{/);
});
