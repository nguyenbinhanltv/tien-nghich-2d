import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', dir)));
const vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', dir)));
const sources = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !['server.mjs', 'data.mjs'].includes(f)).map(f => [f, fs.readFileSync(new URL(f, dir), 'utf8')]);
const holes = text => [...text.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(m => m[1]).sort().join(',');

test('en and vi have the same keys and the same placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort());
  for (const key of Object.keys(en)) assert.equal(holes(vi[key]), holes(en[key]), key);
});

test('every literal t() key exists in the tab strings', () => {
  for (const [file, text] of sources) for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) if (!m[1].endsWith('.')) assert.ok(m[1] in en, `${file}: ${m[1]}`);
});

test('dynamic key families are complete', () => {
  const families = {ready: ['planned', 'authored', 'packed'], group: ['core', 'longtime'], floor: ['grey', 'court', 'dark'], kind: ['once', 'loop'],
    view: ['spec', 'audit', 'provenance', 'rounds', 'read'], 'spec.col': ['name', 'ticks', 'fast', 'events'], 'audit.col': ['check', 'measured', 'limit', 'result'],
    'audit.check': ['first', 'last', 'peak', 'jump', 'colors'], 'prov.hash': ['sheet', 'descriptor', 'spec']};
  for (const [family, names] of Object.entries(families)) for (const n of names) assert.ok(`${family}.${n}` in en, `${family}.${n}`);
});

test('no hard-coded user-visible text in the modules', () => {
  for (const [file, text] of sources) assert.ok(!/textContent\s*=\s*'[A-Za-z]/.test(text), file);
});
