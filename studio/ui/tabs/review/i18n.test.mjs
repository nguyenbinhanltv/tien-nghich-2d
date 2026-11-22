import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', dir)));
const vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', dir)));
const shell = JSON.parse(fs.readFileSync(new URL('../../i18n/en.json', dir)));
const sources = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !['server.mjs', 'inbox.mjs', 'signoff.mjs', 'wav.mjs'].includes(f)).map(f => [f, fs.readFileSync(new URL(f, dir), 'utf8')]);

test('every literal ctx.t key exists in the tab or shell strings, in both languages', () => {
  for (const [file, text] of sources) for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) {
    if (m[1].endsWith('.')) continue; // dynamic suffix, checked below
    assert.ok(m[1] in en || m[1] in shell, `${file}: ${m[1]}`);
    if (m[1] in en) assert.ok(m[1] in vi, `${file}: ${m[1]} (vi)`);
  }
});

test('dynamic key families are complete', () => {
  const families = {status: ['pending', 'approved', 'changes_requested'], signoff: ['none', 'signed', 'needs_work', 'stale'], state: ['waiting', 'agent', 'decided', 'all'],
    ready: ['planned', 'authored', 'packed'], thread: ['reply', 'handledReply'], inbox: ['empty', 'nothingHere']};
  for (const [family, names] of Object.entries(families)) for (const n of names) assert.ok(`${family}.${n}` in en, `${family}.${n}`);
});

test('modules never call replaceChildren directly: it would print "null" for an empty slot (use fill)', () => {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !['server.mjs', 'inbox.mjs', 'signoff.mjs', 'wav.mjs'].includes(f))) {
    const lines = fs.readFileSync(new URL(f, dir), 'utf8').split('\n').filter(l => !l.trim().startsWith('//') && !l.includes('replaceChildren that') && !l.includes('el.replaceChildren(...kids'));
    assert.ok(!lines.some(l => /\.replaceChildren\(/.test(l)), f);
  }
});
