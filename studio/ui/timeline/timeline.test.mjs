// The timeline panel: its strings (EN and VI) and its HTTP route, on a throwaway project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { handleTimeline } from './route.mjs';
import { PROVENANCE, clipFrames, connect, makeProject } from '../../mcp/testkit.mjs';

const dir = new URL('./', import.meta.url);
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', dir)));
const vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', dir)));
const source = fs.readFileSync(new URL('panel.mjs', dir), 'utf8');

test('OBJECTS-010: the timeline panel has every string in English and Vietnamese, and hard-codes none', () => {
  assert.deepEqual(Object.keys(vi).sort(), Object.keys(en).sort());
  for (const m of source.matchAll(/\btr\('([A-Za-z0-9_.]+)'/g)) assert.ok(m[1].endsWith('.') || m[1] in en, m[1]);
  for (const kind of ['flip_h', 'flip_v', 'rotate90', 'rotate180', 'rotate270', 'shift', 'centre']) assert.ok(`kind.${kind}` in en, kind);
  for (const key of ['play.forward', 'play.reverse', 'play.pingpong', 'scope.frame', 'scope.clip', 'scope.all']) assert.ok(key in vi, key);
  assert.ok(!/textContent\s*=\s*'[A-Za-z]/.test(source));
  assert.ok(!/\.replaceChildren\(/.test(source.split('\n').filter(l => !l.includes('const put')).join('\n')), 'use put(): replaceChildren prints null');
});

const ASSET = 'lt_reed_crane';
async function call(root, method, query, body) {
  const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []), {method, headers: {'content-type': 'application/json'}});
  let status, out;
  const res = {writeHead(s) { status = s; }, end(text) { out = JSON.parse(text); }};
  try { await handleTimeline(req, res, {root, url: new URL(`http://127.0.0.1/api/tabs/objects/timeline${query ?? ''}`), allow: () => true}); }
  catch (error) { return {status: error.status, error: error.code, message: error.message}; }
  return {status, body: out};
}

test('OBJECTS-010: the route shows tags and links, and transforms and imports are checked first and refused with reasons', async () => {
  const p = makeProject({git: false});
  try {
    const a = connect(p.root);
    await a.ok('studio_frames_submit', {assetId: ASSET, provenance: PROVENANCE ?? {tool: 'testkit', prompt: 'x', sourceHash: 'a'.repeat(64)}, frames: clipFrames('idle', 'south', 4)});
    const info = await call(p.root, 'GET', `?id=${ASSET}`);
    assert.equal(info.status, 200);
    assert.deepEqual(info.body.timeline.tags.map(t => t.name), ['idle', 'follow']);
    assert.deepEqual(info.body.formats.map(f => f.id), ['pxo', 'ase', 'ase-indexed']);
    // a check changes nothing; the default is a check
    const check = await call(p.root, 'POST', '', {assetId: ASSET, action: 'transform', clip: 'idle', n: 1, scope: 'clip', transform: {kind: 'flip_h'}});
    assert.equal(check.body.dryRun, true);
    assert.equal(check.body.written, false);
    assert.equal(check.body.frames.length, 4);
    const done = await call(p.root, 'POST', '', {assetId: ASSET, action: 'transform', clip: 'idle', n: 1, scope: 'clip', transform: {kind: 'flip_h'}, dryRun: false});
    assert.equal(done.body.written, true);
    assert.ok(done.body.frames.every(f => f.status === 'pending'));
    const tile = await call(p.root, 'POST', '', {assetId: ASSET, action: 'tile', clip: 'idle', n: 0});
    assert.equal(tile.body.width, 96);
    assert.ok(tile.body.pngBase64.length > 100);
    const tags = await call(p.root, 'POST', '', {assetId: ASSET, action: 'tags', clip: 'idle', play: 'reverse', dryRun: false});
    assert.equal(tags.body.timeline.tags[0].play, 'reverse');
    assert.deepEqual(tags.body.timeline.tags[0].order, [3, 2, 1, 0]);
    // export then a refused import, with a reason
    const exp = await call(p.root, 'POST', '', {assetId: ASSET, action: 'tags', clip: 'follow', play: 'forward'});
    assert.equal(exp.body.written, false);
    assert.equal((await call(p.root, 'POST', '', {assetId: ASSET, action: 'import', fileBase64: Buffer.from('junk').toString('base64')})).status, 422);
    assert.equal((await call(p.root, 'POST', '', {assetId: ASSET, action: 'bogus'})).status, 422);
    assert.equal((await call(p.root, 'POST', '', {assetId: ASSET, action: 'tile', clip: 'idle', n: 0, extra: 1})).status, 422);
    assert.equal((await call(p.root, 'PUT', '')).status, 405);
    assert.equal((await call(p.root, 'GET', '?id=nope')).status, 404);
  } finally { await p.cleanup(); }
});
