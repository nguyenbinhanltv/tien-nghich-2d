// The Sandbox stays project-agnostic, reads no catalog file itself, and has no way to approve, sign or delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('./', import.meta.url);
const files = fs.readdirSync(dir).filter(f => /\.(mjs|css)$/.test(f) && !f.endsWith('.test.mjs'));
const text = f => fs.readFileSync(new URL(f, dir), 'utf8');
const banned = [/\bassets\//, /\btools\//, /palette\.json/, /manifest[\w.]*\.json/, /tien[-_ ]?nghich/i, /xianxia/i, /pixellab/i, /longtime/i, /hengyue/i, /blood[_-]?sea/i,
  /courtyard/i, /dong[_-]?phu/i, /\bbgm_|\bsfx_/, /#[0-9a-f]{6}\b/i, /preview-app/];

test('no project-specific literal in the tab sources', () => {
  const hits = [];
  for (const f of files) text(f).split('\n').forEach((line, i) => banned.forEach(re => {
    // The overlay colours are tool colours drawn over sprites, not project colours.
    if (re.source.startsWith('#') && /strokeStyle|fillStyle|cross\(/.test(line)) return;
    if (/ctx\.(api|tabApi|fetchJson)\(/.test(line) && /assets/.test(re.source)) return; // catalog API routes, not project paths
    if (re.test(line)) hits.push(`${f}:${i + 1} ${re} ${line.trim()}`);
  }));
  assert.deepEqual(hits, []);
});

test('the page never touches an approval, sign-off or delete route, and only the save form writes', () => {
  for (const f of files.filter(f => f.endsWith('.mjs'))) {
    assert.doesNotMatch(text(f), /audio-signoff|\/api\/tabs\/review\/|approve|publish|method: 'DELETE'/i, f);
    if (f !== 'index.mjs') assert.doesNotMatch(text(f), /method: 'POST'/, f + ' must not write');
  }
  assert.equal((text('index.mjs').match(/fetch\(/g) ?? []).length, 1, 'one fetch in the page: the scene save');
  assert.match(text('server.mjs'), /sec-fetch-site/);
});

test('no audio engine is created at load: AudioContext only inside the mixer, only in unlock()', () => {
  for (const f of files.filter(f => f.endsWith('.mjs') && f !== 'audio.mjs')) assert.doesNotMatch(text(f), /AudioContext/, f);
  const audio = text('audio.mjs');
  assert.equal((audio.match(/new AudioContext/g) ?? []).length, 1);
  assert.match(audio, /function unlock\(\) \{\s*if \(!ctx\) ctx = new AudioContext\(\)/);
  assert.match(text('stage.mjs'), /addEventListener\('click', \(\) => \{[\s\S]{0,200}?mixer\.unlock\(\)/);
});
