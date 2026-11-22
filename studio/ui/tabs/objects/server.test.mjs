import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { handle, buildLinks, summarizeProvenance } from './server.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const context = {root, prefix: '/api/tabs/objects/'};
async function call(path, method = 'GET') {
  let status, body;
  const res = {writeHead(s) { status = s; }, end(text) { body = JSON.parse(text); }};
  try { await handle({method}, res, new URL('http://127.0.0.1/api/tabs/objects/' + path), context); status ??= 200; }
  catch (error) { return {status: error.status, error: error.code}; }
  return {status, body};
}

test('buildLinks stores every relation in both directions and drops unknown ids', () => {
  const known = new Set(['wp', 'pj', 'a', 'b', 'relic', 'fx']);
  const links = buildLinks([{assets: [{id: 'wp', projectile_id: 'pj'}, {id: 'pj', weapon_id: 'wp'}, {id: 'relic', dependencies: ['a', 'b', 'ghost']}],
    effects: [{id: 'fx', related: ['a', 'nope']}]}], known);
  assert.deepEqual(links.wp, {projectile: ['pj']});
  assert.deepEqual(links.pj, {weapon: ['wp']});
  assert.deepEqual(links.relic, {builtFrom: ['a', 'b']});
  assert.deepEqual(links.a, {usedBy: ['relic'], effectFor: ['fx']});
  assert.deepEqual(links.fx, {effects: ['a']});
});

test('summarizeProvenance keeps known fields and per-frame hashes only', () => {
  const out = summarizeProvenance('p.json', {generator: 'g.py', seed: 4, secret: 'x', frames: [{key: 'k', sha256: 's', duration_ms: 80, extra: 1}, null]});
  assert.deepEqual(out, {path: 'p.json', generator: 'g.py', seed: 4, frames: [{key: 'k', sha256: 's', durationMs: 80}]});
});

test('real project: weapon ↔ projectile, fusion relic parents, ward ↔ pulse effect', async () => {
  const {body} = await call('links');
  const l = body.links;
  assert.deepEqual(l.wp_heaven_defying_bead.projectile, ['pj_heaven_defying_bead']);
  assert.deepEqual(l.pj_heaven_defying_bead.weapon, ['wp_heaven_defying_bead']);
  assert.deepEqual(l.lt_reed_verdict.builtFrom, ['lt_reed_blade', 'lt_seal_chisel']);
  assert.ok(l.lt_reed_blade.usedBy.includes('lt_reed_verdict'));
  assert.ok(l.lt_ward_bell.effectFor.includes('lt_fx_ward_pulse'));
});

test('real project: provenance shows generator and hashes where recorded, and is honest where not', async () => {
  const bell = (await call('provenance?id=lt_ward_bell&source=longtime')).body;
  assert.match(bell.files[0].generator, /^tools\/generators\/.+\.py$/);
  assert.match(bell.files[0].source_sha256, /^[0-9a-f]{64}$/);
  const core = (await call('provenance?id=wp_heaven_defying_bead')).body;
  assert.deepEqual(core.files, []);
  assert.ok(core.record.outputPath);
});

test('OBJECTS-001: the API is read only and rejects bad input', async () => {
  assert.equal((await call('links', 'POST')).status, 405);
  assert.equal((await call('provenance')).status, 422);
  assert.equal((await call('provenance?id=nope')).status, 404);
  assert.equal((await call('elsewhere')).status, 404);
});
