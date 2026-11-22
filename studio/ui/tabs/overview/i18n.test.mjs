import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', dir))), vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', dir)));
const shell = JSON.parse(fs.readFileSync(new URL('../../i18n/en.json', dir)));
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join();

test('English and Vietnamese carry the same keys and the same placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort());
  for (const key of Object.keys(en)) assert.equal(placeholders(en[key]), placeholders(vi[key]), key);
});

test('every literal t() key in the tab modules exists in the tab or shell strings', () => {
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'server.mjs')) {
    const text = fs.readFileSync(new URL(file, dir), 'utf8');
    for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) assert.ok(m[1].endsWith('.') || m[1] in en || m[1] in shell, `${file}: ${m[1]}`);
  }
});

test('the stage and nav keys built at run time exist', () => {
  for (const s of ['packed', 'authored', 'planned']) assert.ok(`stage.${s}` in en, s);
  for (const s of ['ok', 'full', 'over', 'none']) assert.ok(`state.${s}` in en, s);
  for (const tab of ['review', 'jobs', 'characters', 'atlas']) assert.ok(`nav.${tab}` in shell, tab);
});
