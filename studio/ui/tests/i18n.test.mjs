import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pickLanguage, translator, localize, interpolate } from '../i18n.mjs';

const dir = new URL('../', import.meta.url);
const tables = [dir, new URL('hub/', dir), ...fs.readdirSync(new URL('tabs/', dir), {withFileTypes: true}).filter(e => e.isDirectory()).map(e => new URL('tabs/' + e.name + '/', dir))];

test('the stored language wins, then the browser, then the first supported', () => {
  assert.equal(pickLanguage(['en', 'vi'], 'vi', ['en-US']), 'vi');
  assert.equal(pickLanguage(['en', 'vi'], null, ['fr', 'vi-VN']), 'vi');
  assert.equal(pickLanguage(['en', 'vi'], 'xx', ['fr']), 'en');
});

test('translator falls back across scopes, then English, then the key', () => {
  const t = translator('vi', [{en: {a: 'tab {n}'}, vi: {}}, {en: {b: 'shell'}, vi: {b: 'vỏ'}}]);
  assert.equal(t('a', {n: 2}), 'tab 2');
  assert.equal(t('b'), 'vỏ');
  assert.equal(t('missing'), 'missing');
  assert.equal(interpolate('{x} {y}', {x: 1}), '1 {y}');
  assert.equal(localize({en: 'A', vi: 'B'}, 'vi'), 'B');
  assert.equal(localize({en: 'A'}, 'vi'), 'A');
});

test('every string file has the same keys in English and Vietnamese, with the same placeholders', () => {
  for (const base of tables) {
    const i18n = new URL('i18n/', base);
    if (!fs.existsSync(i18n)) continue;
    const en = JSON.parse(fs.readFileSync(new URL('en.json', i18n))), vi = JSON.parse(fs.readFileSync(new URL('vi.json', i18n)));
    assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort(), base.pathname);
    for (const key of Object.keys(en)) {
      const names = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      assert.deepEqual(names(vi[key]), names(en[key]), `${base.pathname} ${key}`);
    }
  }
});
