import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderDocument, validateDocument } from '../index.mjs';
import { canonical, resolveWindow } from '../window.mjs';

const zap = () => JSON.parse(fs.readFileSync(new URL('../examples/zap.patch.json', import.meta.url), 'utf8'));
const withWindow = (window) => ({ ...zap(), window });

test('AUDIOWINDOW-001 a window sets the length and stretches layers and envelopes; the sized patch is valid and renders to that length', () => {
  const { document, window } = resolveWindow(withWindow({ frames: 6, frameMs: 100, tailMs: 40 }));
  assert.equal(document.window, undefined);
  assert.equal(document.durationMs, 640);
  assert.equal(window.windowMs, 600);
  assert.equal(window.totalMs, 640);
  assert.equal(window.scale, round(640 / 220));
  const k = 640 / 220;
  assert.equal(document.layers[0].env.attackMs, round(3 * k));
  assert.equal(document.layers[0].env.releaseMs, round(60 * k));
  assert.equal(document.layers[2].startMs, round(20 * k));
  assert.ok(document.layers.every((l) => l.startMs + l.ms <= 640 + 1e-9));
  assert.deepEqual(validateDocument(document), []);
  const r = renderDocument(document);
  assert.equal(r.frames, Math.round(640 * 44100 / 1000));
  // a shorter window shrinks everything the same way, and the zap still starts and ends at digital zero
  const short = resolveWindow(withWindow({ ms: 110 })).document;
  assert.equal(short.durationMs, 110);
  const sr = renderDocument(short);
  assert.equal(sr.pcm[0][0], 0); assert.equal(sr.pcm[0].at(-1), 0);
});
const round = (v) => Math.round(v * 1000) / 1000;

test('AUDIOWINDOW-001 a window is refused when it is malformed, on a score, or too long', () => {
  const bad = (window, why, doc = zap()) => assert.throws(() => resolveWindow({ ...doc, window }), why);
  bad({}, /exactly one source/);
  bad({ ms: 100, frames: 3, frameMs: 10 }, /exactly one source/);
  bad({ ms: -5 }, /positive/);
  bad({ frames: 0, frameMs: 10 }, /whole number/);
  bad({ frames: 3 }, /frameMs/);
  bad({ ms: 100, tailMs: -1 }, /tailMs/);
  bad({ ms: 100, speed: 2 }, /no setting "speed"/);
  bad({ ms: 40000 }, /limit for a patch/);
  bad('long', /must be an object/);
  bad({ ms: 100 }, /sizes a one-shot patch/, { schema: 'studio.audio.score', version: 1, id: 'x' });
  bad({ clip: { asset: 'a' } }, /window\.clip must be/);
  bad({ clip: { asset: 'a', clip: 'b', when: 1 } }, /no setting "when"/);
  bad({ clip: { asset: 'a', clip: 'b' } }, /look the clip up/);
  assert.deepEqual(resolveWindow(zap()), { document: zap(), window: null }, 'no window, no change');
});

test('AUDIOWINDOW-002 the configuration hash is stable, canonical, and changes with the window, the patch and the clip timing', () => {
  const a = resolveWindow(withWindow({ ms: 300, tailMs: 50 })).window;
  assert.match(a.configSha256, /^[0-9a-f]{64}$/);
  assert.equal(resolveWindow(withWindow({ tailMs: 50, ms: 300 })).window.configSha256, a.configSha256, 'key order does not matter');
  assert.notEqual(resolveWindow(withWindow({ ms: 301, tailMs: 50 })).window.configSha256, a.configSha256);
  assert.notEqual(resolveWindow({ ...withWindow({ ms: 300, tailMs: 50 }), seed: 1 }).window.configSha256, a.configSha256, 'the source patch is part of the hash');
  assert.equal(canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  const t = (ms) => resolveWindow(withWindow({ clip: { asset: 'm', clip: 'tell' } }), { clipTiming: () => ({ ms, source: 'x' }) }).window;
  assert.notEqual(t(200).configSha256, t(300).configSha256);
  assert.equal(t(200).configSha256, t(200).configSha256);
  assert.throws(() => resolveWindow(withWindow({ clip: { asset: 'm', clip: 'tell' } }), { clipTiming: () => ({ ms: 0, source: 'x' }) }), /positive time/);
});
