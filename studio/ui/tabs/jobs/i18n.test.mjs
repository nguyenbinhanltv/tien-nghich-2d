import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', dir))), vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', dir)));
const shell = JSON.parse(fs.readFileSync(new URL('../../i18n/en.json', dir)));
const text = fs.readFileSync(new URL('index.mjs', dir), 'utf8');

test('every literal ctx.t key exists in the tab or shell strings, in both languages', () => {
  for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) {
    if (m[1].endsWith('.')) continue;
    assert.ok(m[1] in en || m[1] in shell, m[1]);
    if (m[1] in en) assert.ok(m[1] in vi, m[1] + ' (vi)');
  }
});

test('dynamic key families are complete', () => {
  const families = {phase: ['queued', 'running', 'failed', 'done'], state: ['all', 'running', 'failed', 'done'], 'link.asset': ['submitted', 'checked'], time: ['now', 'seconds', 'minutes', 'hours'], outcome: ['ok', 'failed']};
  for (const [family, names] of Object.entries(families)) for (const n of names) assert.ok(`${family}.${n}` in en, `${family}.${n}`);
  for (const k of ['col.state', 'col.tool', 'col.agent', 'col.started', 'col.duration', 'col.time', 'col.outcome']) assert.ok(k in en, k);
});

test('modules never call replaceChildren directly: it would print "null" for an empty slot (use fill)', () => {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && f !== 'server.mjs' && f !== 'links.mjs')) {
    const body = fs.readFileSync(new URL(f, dir), 'utf8').split('\n').filter(l => !l.trim().startsWith('//') && !l.includes('replaceChildren that'));
    assert.ok(!body.some(l => /\.replaceChildren\(/.test(l) && !l.includes('el.replaceChildren(...kids')), f);
  }
});
