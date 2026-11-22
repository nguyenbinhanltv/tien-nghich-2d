// Lane 4D: palette actions, the typing guard, the cheat-sheet, recents and the tab shortcut contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isTyping, cleanRecents, pushRecent, recentMax, nextZoom, nextPending, createPalette, createCheatSheet } from '../palette.mjs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

function fakeDom() {
  const el = tag => {
    const node = {tag, children: [], attrs: {}, listeners: {}, removed: false, focused: false, isConnected: true, textContent: '',
      setAttribute(k, v) { node.attrs[k] = v; }, addEventListener(type, fn) { node.listeners[type] = fn; },
      append(...c) { node.children.push(...c); }, replaceChildren(...c) { node.children = c; }, remove() { node.removed = true; node.isConnected = false; },
      focus() { node.focused = true; doc.activeElement = node; }, querySelectorAll: () => [], querySelector: () => null, scrollIntoView() {},
      get value() { return node._v ?? ''; }, set value(v) { node._v = v; }};
    return node;
  };
  const doc = {activeElement: null, body: el('body'), createElement: el, querySelector: () => null, addEventListener() {}};
  return doc;
}
const walk = (n, out = []) => { out.push(n); for (const c of n.children ?? []) if (c && typeof c === 'object') walk(c, out); return out; };
const keyEvent = (key, extra = {}) => ({key, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra});

test('SHELL-004: shortcuts are ignored while typing in an input, textarea, select or contenteditable', () => {
  for (const el of [{tagName: 'INPUT'}, {tagName: 'TEXTAREA'}, {tagName: 'SELECT'}, {tagName: 'DIV', isContentEditable: true},
    {tagName: 'DIV', getAttribute: () => 'true'}, {tagName: 'DIV', getAttribute: () => ''}]) assert.equal(isTyping(el), true);
  for (const el of [null, {tagName: 'BUTTON'}, {tagName: 'MAIN'}, {tagName: 'DIV', getAttribute: () => 'false'}]) assert.equal(isTyping(el), false);
  const shell = read('shell.js');
  assert.equal([...shell.matchAll(/isTyping\(document\.activeElement\)/g)].length, 2, 'both the ? and the g handlers use the guard');
});

test('SHELL-005: recent assets keep at most 10, newest first, no duplicates, and drop malformed entries', () => {
  let list = [];
  for (let i = 0; i < 14; i++) list = pushRecent(list, {tab: 'characters', asset: 'a' + i});
  assert.equal(list.length, recentMax);
  assert.equal(list[0].asset, 'a13');
  list = pushRecent(list, {tab: 'characters', asset: 'a8'});
  assert.equal(list[0].asset, 'a8');
  assert.equal(list.filter(e => e.asset === 'a8').length, 1);
  assert.deepEqual(cleanRecents([{tab: 'x', asset: 'a/../b'}, {tab: 'BAD', asset: 'ok'}, null, 'str', {tab: 'vfx', asset: 'ok', source: 's s'}]), [{tab: 'vfx', asset: 'ok'}]);
  assert.deepEqual(cleanRecents('junk'), []);
});

test('SHELL-006: zoom cycles through the choices; next pending only picks a waiting item, after the open one, wrapping', () => {
  assert.equal(nextZoom(null), 1);
  assert.equal(nextZoom(4), 6);
  assert.equal(nextZoom(8), 1);
  const items = [{key: 'a/1', state: 'decided'}, {key: 'a/2', state: 'waiting'}, {key: 'a/3', state: 'agent'}, {key: 'a/4', state: 'waiting'}];
  assert.equal(nextPending(items, null).key, 'a/2');
  assert.equal(nextPending(items, 'a/2').key, 'a/4');
  assert.equal(nextPending(items, 'a/4').key, 'a/2');
  assert.equal(nextPending([{key: 'x', state: 'decided'}], null), null);
  assert.equal(nextPending(undefined, null), null);
});

test('SHELL-007: the palette lists the Actions group first, filters it, runs an action, and offers no decision', async () => {
  const doc = fakeDom();
  globalThis.document = doc;
  const ran = [];
  const main = doc.createElement('main');
  const palette = createPalette({project: {tools: [], categoryTabs: {}}, getLang: () => 'en', t: k => k, fetchJson: async () => ({}), navigate: r => ran.push(['nav', r]), goTool() {},
    afterChoose: () => main.focus(),
    actions: () => [{id: 'next-pending', title: 'Open the next item', run: () => ran.push('next')}, {id: 'zoom', title: 'Zoom', run: () => ran.push('zoom')}],
    getRecents: () => [{tab: 'characters', asset: 'hero_01'}, {tab: 'vfx', asset: 'spark', source: 's1'}]});
  palette.open();
  const overlay = doc.body.children[0];
  const titles = walk(overlay).filter(n => n.attrs.class === 'palette-group').map(n => n.children[0]);
  assert.deepEqual(titles.slice(0, 3), ['palette.actions', 'palette.recent', 'palette.tabs']);
  const all = JSON.stringify(walk(overlay).filter(n => n.attrs.role === 'option').map(n => n.children.map(c => c.children[0])));
  assert.doesNotMatch(all, /approve|sign|decide/i, 'no decision is offered');
  overlay.listeners.keydown(keyEvent('Enter'));   // the first entry: the first action
  assert.deepEqual(ran, ['next']);
  assert.equal(palette.isOpen(), false);
  assert.equal(main.focused, true, 'focus lands on main');
  palette.open();
  walk(doc.body.children.at(-1)).find(n => n.attrs.role === 'option' && n.attrs.id === 'palette-opt-3').listeners.click();   // the second recent asset
  assert.deepEqual(ran.at(-1), ['nav', {tab: 'vfx', asset: 'spark', params: {source: 's1'}}]);
  delete globalThis.document;
});

test('SHELL-008: the cheat-sheet opens, lists general and tab keys, closes on Esc and returns focus; a vanished opener falls back', () => {
  const doc = fakeDom();
  globalThis.document = doc;
  const opener = doc.createElement('button'), fallback = doc.createElement('main');
  const sheet = createCheatSheet({t: k => k, fallbackFocus: () => fallback,
    getSections: () => [{title: 'General', rows: [{keys: ['?'], label: 'Show'}]}, {title: 'Tab', rows: [], empty: 'none'}]});
  doc.activeElement = opener;
  sheet.open();
  assert.equal(sheet.isOpen(), true);
  const overlay = doc.body.children[0];
  const dialog = walk(overlay).find(n => n.attrs.role === 'dialog');
  assert.equal(dialog.attrs['aria-modal'], 'true');
  assert.ok(dialog.attrs['aria-labelledby']);
  assert.ok(doc.activeElement.attrs.class.includes('cheat-close'), 'focus moves into the sheet');
  const tab = keyEvent('Tab');
  overlay.listeners.keydown(tab);
  assert.equal(tab.prevented, true, 'Tab does not leave the modal');
  sheet.open();   // already open: no second overlay
  assert.equal(doc.body.children.length, 1);
  overlay.listeners.keydown(keyEvent('Escape'));
  assert.equal(sheet.isOpen(), false);
  assert.equal(opener.focused, true, 'focus returns to the opener');
  doc.activeElement = opener; sheet.open();
  opener.isConnected = false;
  doc.body.children.at(-1).listeners.keydown(keyEvent('Escape'));
  assert.equal(fallback.focused, true, 'focus falls back when the opener is gone');
  delete globalThis.document;
});

test('SHELL-009: the shell wires ?, shows g+number hints on the rail, lists tab shortcuts, and closes the sheet on a route change', () => {
  const shell = read('shell.js');
  assert.match(shell, /event\.key === '\?'/);
  assert.match(shell, /class: 'rail-key'/);
  assert.match(shell, /active\?\.mod\.shortcuts/);
  assert.match(shell, /state\.cheat\?\.close\(false\)/);
  assert.match(shell, /afterChoose: \(\) => \$\('main'\)\.focus\(/, 'the #132 focus hand-off stays');
  assert.doesNotMatch(shell.slice(shell.indexOf('function paletteActions'), shell.indexOf('async function boot')), /approv|decision\(|method: 'POST'/, 'the actions never post a decision');
});
