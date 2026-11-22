import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checklistItems, views, codecs, stages, listeningStates, kinds } from './model.mjs';

const dir = new URL('./', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', dir)));
const vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', dir)));
const shell = JSON.parse(fs.readFileSync(new URL('../../i18n/en.json', dir)));
const sources = fs.readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.endsWith('.test.mjs') && !['server.mjs', 'evidence.mjs'].includes(f)).map(f => [f, fs.readFileSync(new URL(f, dir), 'utf8')]);

test('English and Vietnamese have the same keys and the same {placeholders}', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(vi).sort());
  const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const key of Object.keys(en)) assert.equal(slots(vi[key]), slots(en[key]), key);
});

test('every literal ctx.t key exists in the tab strings or the shell strings, in both languages', () => {
  for (const [file, text] of sources) for (const m of text.matchAll(/\bt\('([A-Za-z0-9_.]+)'/g)) {
    const key = m[1];
    if (key.endsWith('.')) continue;
    assert.ok(key in en || key in shell, `${file}: ${key}`);
    assert.ok(!(key in en) || key in vi, `${file}: ${key} (vi)`);
  }
});

test('dynamic key families are complete', () => {
  const families = {
    kind: kinds, stage: stages, listening: listeningStates, codec: codecs, view: views,
    check: [...new Set([...checklistItems.bed, ...checklistItems.effect])], 'check.hint': [...new Set([...checklistItems.bed, ...checklistItems.effect])],
    'sign.state': ['none', 'signed', 'needs_work', 'stale'], 'sign.verdict': ['signed', 'needs_work'], 'blind.verdict': ['none', 'distinct', 'confusable'],
    'sprite.issue': ['overlap', 'gap', 'leadGap', 'past', 'trailGap'], 'sprite.col': ['cue', 'start', 'onset', 'tailEnd', 'end', 'gaps', 'active', 'ogg', 'm4a'],
    'patch.kind': ['patch', 'score'], pictures: ['waveform', 'spectrogram']
  };
  for (const [family, names] of Object.entries(families)) for (const n of names) assert.ok(`${family}.${n}` in en, `${family}.${n}`);
});

test('no hard-coded user-visible text in the modules', () => {
  for (const [file, text] of sources) assert.ok(!/textContent\s*=\s*'[A-Za-z]/.test(text), file);
});
