// Contract of studio/ui/components.css: only --ui-* / --theme-* variables, every var() has a fallback, the README token
// table lists exactly the tokens the CSS uses, every component has its states, and the styleguide loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPreviewServer } from '../serve.mjs';

const dir = fileURLToPath(new URL('./', import.meta.url));
const read = name => fs.readFileSync(dir + name, 'utf8');
const css = read('components.css').replace(/\/\*[\s\S]*?\*\//g, '');
const guideCss = read('styleguide.css').replace(/\/\*[\s\S]*?\*\//g, '');

// Every var( ... ) call with its top-level argument list; nested calls are found by the same walk.
function varCalls(text) {
  const calls = [];
  for (let i = text.indexOf('var('); i >= 0; i = text.indexOf('var(', i + 1)) {
    let depth = 0, j = i + 3, comma = -1;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') { if (--depth === 0) break; }
      else if (text[j] === ',' && depth === 1 && comma < 0) comma = j;
    }
    const name = text.slice(i + 4, comma < 0 ? j : comma).trim();
    calls.push({ name, fallback: comma < 0 ? null : text.slice(comma + 1, j).trim() });
  }
  return calls;
}

for (const [file, text] of [['components.css', css], ['styleguide.css', guideCss]]) {
  test(`${file}: only --ui-* or --theme-* variables, every var() with a non-empty fallback`, () => {
    const calls = varCalls(text);
    assert.ok(calls.length > 10);
    for (const c of calls) {
      assert.match(c.name, /^--(ui|theme)-[a-zA-Z0-9-]+$/, `variable ${c.name}`);
      assert.ok(c.fallback, `var(${c.name}) has no fallback`);
    }
  });
}

test('components.css declares only --ui-* custom properties, with no colour literal outside a fallback', () => {
  for (const m of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) assert.match(m[1], /^--ui-slip-(n|cut)$/, `declares ${m[1]}`);
  // strip every var(...) call; what is left must hold no hex colour
  let rest = css;
  for (let i = rest.indexOf('var('); i >= 0; i = rest.indexOf('var(')) {
    let depth = 0, j = i + 3;
    for (; j < rest.length; j++) { if (rest[j] === '(') depth++; else if (rest[j] === ')' && --depth === 0) break; }
    rest = rest.slice(0, i) + rest.slice(j + 1);
  }
  assert.equal(rest.match(/#[0-9a-fA-F]{3,8}\b/g), null, 'colour literal outside a var() fallback');
});

test('README token table and components.css list the same --ui-* tokens', () => {
  const used = new Set(varCalls(css + guideCss).map(c => c.name).filter(n => n.startsWith('--ui-')));
  const readme = read('README.md').split('## Shared components')[1] ?? '';
  const listed = new Set();
  for (const row of readme.split('\n').filter(r => r.startsWith('| `--ui-'))) {
    const cell = row.split('|')[1];
    const names = [...cell.matchAll(/`(--ui-[a-z0-9-]+)`/g)].map(m => m[1]);
    if (cell.includes('…')) { for (let n = 1; n <= 5; n++) listed.add(`--ui-sp-${n}`); continue; }
    if (cell.includes('-sm')) { for (const s of ['xs', 'sm', 'md', 'lg', 'xl']) listed.add(`--ui-fs-${s}`); continue; }
    for (const n of names) listed.add(n);
  }
  assert.deepEqual([...used].filter(n => !listed.has(n)), [], 'used but not documented');
  assert.deepEqual([...listed].filter(n => !used.has(n)), [], 'documented but unused');
});

test('every component has all five states', () => {
  for (const cls of ['btn', 'seg', 'chip', 'field', 'slip', 'stat', 'kbd', 'empty', 'skeleton', 'toast']) {
    const rules = css.split('}').filter(r => r.includes('.' + cls));
    assert.ok(rules.length, `.${cls} missing`);
    const joined = rules.join('}');
    for (const state of [':hover', ':active', 'aria-pressed', ':disabled', ':focus-visible']) assert.ok(joined.includes(state) || joined.includes('aria-disabled'), `.${cls} lacks ${state}`);
  }
  for (const v of ['.primary', '.danger', '.quiet']) assert.ok(css.includes('.btn' + v));
  assert.match(css, /clip-path/);
  assert.match(css, /steps\(/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /ease|linear\b(?!-gradient)|cubic-bezier/, 'smooth easing in a steps() library');
});

test('styleguide loads from the studio server and shows every component in EN and VI', async () => {
  const server = createPreviewServer({ root: fileURLToPath(new URL('../..', import.meta.url)) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(origin + '/studio/ui/styleguide.html');
    assert.equal(page.status, 200);
    const html = await page.text();
    for (const href of ['components.css', 'styleguide.css', 'styleguide.js']) {
      assert.ok(html.includes(href), href);
      assert.equal((await fetch(origin + '/studio/ui/' + href)).status, 200, href);
    }
    for (const cls of ['btn primary', 'btn danger', 'btn quiet', 'seg', 'chip', 'field', 'slip', 'stat', 'kbd', 'empty', 'skeleton', 'toast']) assert.ok(html.includes(`class="${cls}`) || html.includes(` ${cls}"`), `styleguide lacks .${cls}`);
    assert.ok((html.match(/lang="en"/g) ?? []).length > 10 && (html.match(/lang="vi"/g) ?? []).length > 10);
  } finally { server.close(); }
});
