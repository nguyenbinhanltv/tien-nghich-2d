// Lane 1D: the one-line top bar, the lineStrong theme role with a neutral default, the palette closing on a route change, consistent focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crumbParts } from '../crumbs.mjs';
import { defaultRoute } from '../router.mjs';

const ui = fileURLToPath(new URL('../', import.meta.url));
const studio = fileURLToPath(new URL('../../', import.meta.url));
const read = f => fs.readFileSync(ui + f, 'utf8');
const t = key => ({'nav.review': 'Review', 'nav.characters': 'Characters'}[key] ?? key);

test('SHELL-001: clip, direction and frame are one label, so the top bar is one line', () => {
  assert.deepEqual(crumbParts({...defaultRoute(), tab: 'characters'}, t), {tab: 'Characters', asset: null, detail: null});
  assert.deepEqual(crumbParts({...defaultRoute(), tab: 'characters', asset: 'a_1', clip: 'idle', direction: 's', frame: 3}, t),
    {tab: 'Characters', asset: 'a_1', detail: 'clip idle · dir s · frame 3'});
  assert.equal(crumbParts({...defaultRoute(), tab: 'review', asset: 'a_1', frame: 0}, t).detail, 'frame 0', 'frame 0 is a frame');
  const shell = read('shell.js'), css = read('shell.css');
  assert.doesNotMatch(shell, /for \(const \[k, v\] of \[\['clip'/, 'no chip per clip/dir/frame');
  assert.match(css, /\.topbar \{[^}]*flex-wrap: nowrap/, 'the bar does not wrap');
  assert.doesNotMatch(css, /\.topbar \{[^}]*flex-wrap: wrap/);
});

test('SHELL-001: the project button stays visible (it opens the Projects screen)', () => {
  assert.match(read('shell.js'), /state\.hubOnly \? '' : h\('button', \{type: 'button', class: 'switcher'/);
  assert.doesNotMatch(read('shell.css'), /(^|\n)\s*\.switcher\s*\{[^}]*display: none/, 'no rule hides the whole switcher');
});

// WCAG contrast of two #rrggbb colours.
const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('SHELL-002: lineStrong is a pack theme role that gives control borders 3:1; a pack without it falls back to neutral colours', () => {
  const pack = JSON.parse(fs.readFileSync(studio + '../studio.project.json', 'utf8'));
  const palette = Object.fromEntries(JSON.parse(fs.readFileSync(studio + '../' + pack.palette.file, 'utf8')).colors.map(c => [c.id, c.hex]));
  const theme = pack.ui.theme;
  assert.equal(theme.lineStrong, 'ink_04');
  // A control sits on --surface-2 (shell.css: surface 55% over ink) in a bar on --ink: its border must read against both.
  const mix = (a, b) => '#' + [1, 3, 5].map(i => Math.round(0.55 * parseInt(a.slice(i, i + 2), 16) + 0.45 * parseInt(b.slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');
  assert.match(fs.readFileSync(ui + 'shell.css', 'utf8'), /--surface-2: color-mix\(in srgb, var\(--surface\) 55%, var\(--ink\)\)/);
  const surface2 = mix(palette[theme.surface], palette[theme.ink]);
  assert.ok(contrast(palette[theme.lineStrong], palette[theme.ink]) >= 3, 'lineStrong against the page (3.49:1)');
  assert.ok(contrast(palette[theme.lineStrong], surface2) >= 3, 'lineStrong against the control background');
  assert.ok(contrast(palette[theme.line], surface2) < 3, 'the plain line stays a quiet divider');
  // The sample project says nothing about it and must still be fine: the shell's own fallback chain, then a neutral grey.
  // Since the modes, shell.css takes the short name from the token, and tokens.css holds the chain and the abode's neutral grey (--fb-line-strong).
  assert.match(read('shell.css'), /--line-strong: var\(--ui-line-strong\)/);
  assert.match(read('tokens.css'), /--ui-line-strong: var\(--theme-lineStrong, var\(--theme-muted, var\(--fb-line-strong\)\)\)/);
  assert.match(read('tokens.css'), /--fb-line-strong: #7a7a84/);
  assert.ok(contrast('#7a7a84', '#26262c') >= 3 && contrast('#7a7a84', '#101014') >= 3, 'the neutral default passes against the neutral surface and ink');
  const moss = JSON.parse(fs.readFileSync(studio + 'examples/moss-lantern/studio.project.json', 'utf8'));
  assert.equal(moss.ui.theme.lineStrong, undefined);
  const mossColors = Object.fromEntries(JSON.parse(fs.readFileSync(studio + 'examples/moss-lantern/' + moss.palette.file, 'utf8')).colors.map(c => [c.id, c.hex]));
  assert.ok(contrast(mossColors[moss.ui.theme.muted], mossColors[moss.ui.theme.surface]) >= 3, 'without lineStrong the sample\'s muted colour still passes');
  for (const f of ['shell.css', 'components.css', 'hub/hub.css']) assert.match(read(f), /--line-strong|--theme-lineStrong/, f);
  assert.match(read('components.css'), /var\(--ui-line-strong, var\(--theme-lineStrong, var\(--theme-muted, #6b6b6b\)\)\)/);
});

test('SHELL-003: the command palette closes on a route change and focus lands on the content, not on a vanished control', () => {
  const shell = read('shell.js'), palette = read('palette.mjs');
  const route = shell.slice(shell.indexOf('async function route()'), shell.indexOf('function railKeys'));
  assert.match(route, /state\.palette\?\.close\(false\)/, 'route() closes the palette before the new screen mounts');
  assert.match(route, /\$\('main'\)\.focus\(/, 'focus goes to main after the palette or a change of tab');
  assert.match(route, /state\.booted/, 'the first load does not steal focus');
  assert.match(palette, /document\.querySelector\('\.search-button'\)\)\?\.focus\(\)/, 'closing falls back to the search button when the opener is gone');
  assert.match(palette, /Escape[^]*close\(true\)/);
  assert.match(shell, /afterChoose: \(\) => \$\('main'\)\.focus\(/, 'choosing an item focuses main even when no hashchange follows');
});

// A tiny DOM, enough to drive the real createPalette: picking an item is how the palette usually changes the route, and it closes itself
// BEFORE the route changes, so route() never sees it open. Whatever the item does (another tab, the same tab, the current route), focus must end on main.
function fakeDom() {
  const listeners = new Map();
  const el = (tag) => {
    const node = {tag, children: [], attrs: {}, listeners: {}, removed: false, focused: false,
      setAttribute(k, v) { node.attrs[k] = v; }, addEventListener(type, fn) { node.listeners[type] = fn; },
      append(...c) { node.children.push(...c); }, replaceChildren(...c) { node.children = c; }, remove() { node.removed = true; },
      focus() { node.focused = true; doc.activeElement = node; }, querySelectorAll: () => [], querySelector: () => null, scrollIntoView() {}, isConnected: true,
      get value() { return node._v ?? ''; }, set value(v) { node._v = v; }};
    return node;
  };
  const doc = {activeElement: null, body: el('body'), createElement: el, querySelector: () => null,
    addEventListener(type, fn) { listeners.set(type, fn); }};
  return {doc, listeners};
}

test('SHELL-003: choosing a palette item closes it and moves focus to the content, whether the route changes tab, changes within the tab, or does not change at all', async () => {
  const {createPalette} = await import('../palette.mjs');
  // What `navigate` does after the pick: a hash change in another tab, in the same tab, or nothing (the item was the current route, so no hashchange and route() never runs).
  for (const [name, navigate] of [['another tab', () => 'vfx'], ['the same tab', () => 'overview/x'], ['the current route', () => null]]) {
    const {doc} = fakeDom();
    const main = doc.createElement('main'), opener = doc.createElement('button');
    globalThis.document = doc;
    doc.activeElement = opener;
    let ran = 0;
    const palette = createPalette({project: {tools: [], categoryTabs: {}}, getLang: () => 'en', t: k => k, fetchJson: async () => ({}),
      navigate: () => { ran++; navigate(); }, goTool() {}, afterChoose: () => main.focus()});
    palette.open();
    assert.equal(palette.isOpen(), true, name);
    const overlay = doc.body.children[0];
    overlay.listeners.keydown({key: 'Enter', preventDefault() {}});   // choose the first entry
    assert.equal(palette.isOpen(), false, `${name}: closed`);
    assert.equal(ran, 1, `${name}: the item ran`);
    assert.equal(main.focused, true, `${name}: focus is on main, not on the removed input`);
    assert.notEqual(doc.activeElement, overlay);
  }
  delete globalThis.document;
});
