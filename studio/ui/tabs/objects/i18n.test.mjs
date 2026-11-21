import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', dir)));
const vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', dir)));
const shell = JSON.parse(fs.readFileSync(new URL('../../i18n/en.json', dir)));
const sources = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'server.mjs').map(f => [f, fs.readFileSync(new URL(f, dir), 'utf8')]);

test('every literal ctx.t key exists in the tab strings or the shell strings, in both languages', () => {
  for (const [file, text] of sources) for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) {
    const key = m[1];
    if (key.endsWith('.')) continue; // dynamic suffix, checked below
    assert.ok(key in en || key in shell, `${file}: ${key}`);
    assert.ok(!(key in en) || key in vi, `${file}: ${key} (vi)`);
  }
});

test('dynamic key families are complete', () => {
  const families = {links: ['projectile', 'weapon', 'builtFrom', 'usedBy', 'effects', 'effectFor'], ready: ['planned', 'authored', 'packed'],
    review: ['pending', 'approved', 'changes_requested'], tool: ['blob', 'nine', 'hud'], 'nine.inset': ['L', 'T', 'R', 'B'],
    meta: ['kind', 'ready', 'chunk', 'source', 'wave', 'size', 'brief'], prov: ['generator', 'seed', 'generatorHash', 'sourceHash', 'producer', 'method', 'palette', 'output']};
  for (const [family, names] of Object.entries(families)) for (const n of names) assert.ok(`${family}.${n}` in en, `${family}.${n}`);
});

test('no hard-coded user-visible text in the modules', () => {
  for (const [file, text] of sources) assert.ok(!/textContent\s*=\s*'[A-Za-z]/.test(text), file);
});
