// Every string the Atlas tab asks for exists in English and Vietnamese with the same placeholders, including the keys built from a value.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describeDifference } from './model.mjs';

const dir = new URL('./', import.meta.url);
const load = lang => JSON.parse(fs.readFileSync(new URL(`i18n/${lang}.json`, dir), 'utf8'));
const [en, vi] = [load('en'), load('vi')];
const names = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const sources = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs')).map(f => [f, fs.readFileSync(new URL(f, dir), 'utf8')]);

test('English and Vietnamese have the same keys and placeholders', () => {
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) assert.deepEqual(names(vi[key]), names(en[key]), key);
  assert.ok(Object.values(vi).every(v => v.trim()), 'no empty Vietnamese string');
});

test('every literal key used in the sources exists', () => {
  const used = new Set();
  for (const [, s] of sources) {
    for (const m of s.matchAll(/\bt\('([A-Za-z0-9_.-]+)'/g)) used.add(m[1]);
    for (const m of s.matchAll(/\[('[a-z]+\.col\.[a-zA-Z]+'(?:, '[a-z]+\.col\.[a-zA-Z]+')*)\]/g)) for (const k of m[1].matchAll(/'([^']+)'/g)) used.add(k[1]);
  }
  const missing = [...used].filter(k => !(k in en) && !k.endsWith('.') && !k.startsWith('nav.'));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 60);
});

test('every key built from a value has a string for each value', () => {
  const built = {
    'budget.state.': ['ok', 'full', 'over', 'none', 'empty'],
    'pack.status.': ['identical', 'equivalent', 'differs', 'not_produced', 'absent'],
    'pack.verdict.': ['identical', 'equivalent', 'differs', 'empty'],
    'pack.engine.': ['studio', 'authority'],
    'view.': ['atlas', 'budget', 'pack', 'export', 'ledger'],
    'viewer.show.': ['borders', 'frames', 'unused'],
    'ledger.download.': ['md', 'json'],
    'ledger.status.': ['filled', 'unknown', 'not-applicable', 'not-produced', 'open'],
    'ledger.gap.': ['all', 'unknown', 'planned', 'open'],
    'ledger.field.': ['tool', 'toolPin', 'producer', 'script', 'scriptSha256', 'seed', 'promptHash', 'sourceHash', 'method', 'agent', 'document'],
    'ledger.kind.': ['generator', 'tool-render', 'forge-sheet', 'retired-tool', 'audio-engine', 'audio-script', 'third-party', 'unclassified', 'not-recorded']
  };
  for (const [prefix, values] of Object.entries(built)) for (const v of values) assert.ok(prefix + v in en, prefix + v);
  for (const v of ['identical', 'equivalent', 'differs', 'empty']) assert.ok(`pack.verdict.${v}.text` in en);
  const reasons = ['pixels', 'size', 'content', 'bytes', 'formatting', 'png_hash', 'png_bytes', 'missing_staged', 'extra_staged', 'other'];
  for (const reason of reasons) {
    const d = describeDifference({status: 'differs', reason, firstDifference: {x: 1, y: 1, staged: [0], shipped: [1], path: 'p', offset: 1, line: 1, message: 'm'}});
    assert.ok(d[0] in en, `${reason} -> ${d[0]}`);
    assert.deepEqual(names(en[d[0]]).filter(n => !(n in d[1])), [], `${d[0]} placeholders are supplied`);
  }
});

test('every key in the files is used somewhere (no dead strings)', () => {
  const text = sources.map(([, s]) => s).join('\n');
  const dynamicPrefixes = ['budget.state.', 'pack.status.', 'pack.verdict.', 'pack.engine.', 'view.', 'viewer.show.', 'ledger.download.', 'ledger.kind.', 'ledger.status.', 'ledger.gap.', 'ledger.field.', 'diff.', 'viewer.detail.', 'ledger.col.', 'budget.col.', 'pack.col.', 'pack.authority.', 'ledger.present', 'ledger.absent'];
  const dead = Object.keys(en).filter(k => !text.includes(`'${k}'`) && !dynamicPrefixes.some(p => k.startsWith(p)));
  assert.deepEqual(dead, []);
});
