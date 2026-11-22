// The Audio tab stays project-agnostic, owns no sign-off store, and can only send a listening sign-off from a person's click.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const files = fs.readdirSync(dir).filter(f => /\.(mjs|css)$/.test(f) && !f.endsWith('.test.mjs'));
const text = f => fs.readFileSync(new URL(f, dir), 'utf8');
const banned = [/\bassets\//, /\btools\//, /palette\.json/, /manifest[\w.]*\.json/, /tien[-_ ]?nghich/i, /xianxia/i, /pixellab/i, /longtime/i, /hengyue/i, /blood[_-]?sea/i,
  /dong[_-]?phu/i, /\bbgm_|\bsfx_(?!levels\b)/, /#[0-9a-f]{6}\b/i, /preview-app/];

test('no project-specific literal or colour in the tab sources', () => {
  const hits = [];
  for (const f of files) text(f).split('\n').forEach((line, i) => banned.forEach(re => {
    // The three swatch colours in the legend repeat the picture's own line colours, so they are the one allowed hex group.
    if (re.source.startsWith('#') && f === 'audio.css' && /swatch/.test(line)) return;
    if (re.test(line)) hits.push(`${f}:${i + 1} ${re} ${line.trim()}`);
  }));
  assert.deepEqual(hits, []);
});

test('only side.mjs mentions the sign-off route, and it requires a trusted click', () => {
  const mentions = files.filter(f => /audio-signoff/.test(text(f)));
  assert.deepEqual(mentions, ['side.mjs']);
  const side = text('side.mjs');
  assert.match(side, /event\.isTrusted/);
  assert.match(side, /method: 'POST'/);
  assert.equal((side.match(/fetch\(/g) ?? []).length, 1, 'one fetch in the sign-off module');
  for (const f of files.filter(f => f.endsWith('.mjs') && !['side.mjs', 'index.mjs'].includes(f))) assert.doesNotMatch(text(f), /audio-signoff|\/api\/tabs\/review\//, f + ' must not call the review store');
  assert.doesNotMatch(text('server.mjs'), /DatabaseSync|sqlite|signoff/i, 'the server keeps no sign-off store');
});

test('the sign-off request carries only the fields the Review route accepts', () => {
  const side = text('side.mjs');
  const body = /const body = \{([^}]*)\}/s.exec(side)[1];
  const keys = [...body.matchAll(/\b(id|content|verdict|note)\b\s*[:,]/g)].map(m => m[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['content', 'id', 'note', 'verdict']);
});

test('playback is only reachable from click handlers: nothing starts at mount', () => {
  for (const f of ['listen.mjs', 'ab.mjs', 'sprite.mjs', 'patch.mjs']) {
    const src = text(f);
    // every engine.play( call sits inside a function that a button or key handler runs; mount-time code never calls it directly.
    const topLevel = src.split('\n').filter(line => /^\s{0,2}engine\.play\(/.test(line));
    assert.deepEqual(topLevel, [], f);
  }
  assert.doesNotMatch(text('engine.mjs'), /new AudioContext\([^)]*\)[\s\S]{0,40}autoplay/);
  assert.match(text('engine.mjs'), /function ensure/);
  assert.doesNotMatch(text('index.mjs'), /AudioContext|\.play\(/);
});

test('the sign-off gate and the note use heardFor, and every playback label carries its cue', () => {
  const side = text('side.mjs');
  assert.match(side, /heardFor\(engine\.heardLabels\(\), entry\.id, entry\.masterSha\)/);
  assert.doesNotMatch(side, /heardLabels\(\)\.map/, 'no unscoped label list');
  for (const f of ['listen.mjs', 'ab.mjs', 'sprite.mjs', 'patch.mjs']) {
    const src = text(f);
    for (const m of src.matchAll(/label: ([^,}]+)/g)) assert.match(m[1], /playLabel\(|\btag\(|\blabel\b|'preview'|'bed:'/, `${f}: ${m[1]}`);
    assert.doesNotMatch(src, /label: 'main:|label: 'ab:|label: 'sprite:/, f);
  }
});
