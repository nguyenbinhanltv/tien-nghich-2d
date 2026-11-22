import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { handle } from './server.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const context = {root, prefix: '/api/tabs/vfx/'};
async function call(path, method = 'GET') {
  let status, body;
  const res = {writeHead(s) { status = s; }, end(text) { body = JSON.parse(text); }};
  try { await handle({method}, res, new URL('http://127.0.0.1/api/tabs/vfx/' + path), context); status ??= 200; }
  catch (error) { return {status: error.status, error: error.code}; }
  return {status, body};
}

test('read-only; unknown routes and ids are refused', async () => {
  assert.equal((await call('effects', 'POST')).status, 405);
  assert.equal((await call('nope')).error, 'unknown_route');
  assert.equal((await call('effect')).status, 422);
  assert.equal((await call('effect?id=ghost')).error, 'unknown_effect');
});

test('real project: eighteen effects, core first, with readiness and variants', async () => {
  const {body} = await call('effects');
  assert.equal(body.effects.length, 18);
  assert.equal(body.effects.filter(e => e.group === 'core').length, 12);
  assert.equal(body.effects[0].group, 'core'); assert.equal(body.effects.at(-1).group, 'longtime');
  const ward = body.effects.find(e => e.id === 'lt_fx_ward_pulse');
  assert.deepEqual(ward.variants, ['anchor', 'mirror', 'thorn', 'tide', 'flare', 'bell']);
  assert.equal(ward.frames, 78 / 6);
  assert.deepEqual(body.floors.map(f => f.id), ['grey', 'court', 'dark']);
  assert.ok(body.floors.every(f => /^#[0-9a-f]{6}$/.test(f.color)));
  assert.equal(body.effects.reduce((n, e) => n + (e.group === 'longtime' ? e.frames * e.variants.length : 0), 0), 188);
});

test('real project: per-frame durations, sections and events survive', async () => {
  const {effect} = (await call('effect?id=thien_loi_cuc_canh')).body;
  const clip = effect.clips[0];
  assert.equal(clip.ms.length, 34); assert.equal(clip.ms.reduce((a, b) => a + b, 0), 1133);
  assert.deepEqual(clip.events.map(e => [e.name, e.frame]), [['hit', 1], ['shake:4', 1]]);
  assert.deepEqual(effect.anchor, [32, 62]);
  const cam = (await call('effect?id=cam_che_tran_phap')).body.effect.clips[0];
  assert.deepEqual(cam.sections.filter(s => s.role).map(s => [s.name, s.from, s.to, s.kind]), [['start', 0, 15, 'once'], ['loop', 16, 45, 'loop'], ['end', 46, 84, 'once']]);
});

test('real project: evidence for a core and a Longtime effect', async () => {
  const core = (await call('evidence?id=hit_spark')).body;
  assert.equal(core.provenance.recorded, false);
  assert.equal(core.rounds.rounds.length, 4); assert.ok(core.rounds.rounds.every(r => r.exists));
  assert.ok(core.rounds.sheets.every(s => s.sheet === null), 'no round frames or sheets exist; the UI says so');
  assert.equal(core.recorded.selfScore.auditErrors.v4, 0);
  const lt = (await call('evidence?id=lt_fx_impact')).body;
  assert.equal(lt.provenance.recorded, true); assert.equal(lt.provenance.frames.mismatch, 0); assert.equal(lt.provenance.frames.missing, 0);
  assert.ok(lt.specs.every(s => s.hashMatches === true));
  assert.ok(lt.computed.every(c => c.checks.every(k => k.pass)));
  assert.equal(lt.rounds, null);
});
