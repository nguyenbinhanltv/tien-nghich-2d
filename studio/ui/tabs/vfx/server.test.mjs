import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { handle } from './server.mjs';
import os from 'node:os';
import { compareFrames, buildAndAudit } from './build.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const context = {root, prefix: '/api/tabs/vfx/'};
async function call(path, method = 'GET') {
  let status, body;
  const res = {writeHead(s) { status = s; }, end(text) { body = JSON.parse(text); }};
  try { await handle({method}, res, new URL('http://127.0.0.1/api/tabs/vfx/' + path), context); status ??= 200; }
  catch (error) { return {status: error.status, error: error.code}; }
  return {status, body};
}

test('VFX-001: read-only apart from build; unknown routes and ids are refused', async () => {
  assert.equal((await call('effects', 'POST')).status, 405);
  assert.equal((await call('floors', 'POST')).status, 405);
  assert.equal((await call('nope')).error, 'unknown_route');
  assert.equal((await call('effect')).status, 422);
  assert.equal((await call('effect?id=ghost')).error, 'unknown_effect');
});

test('real project: eighteen effects, core first, with readiness and variants', async () => {
  const {body} = await call('effects');
  assert.equal(body.effects.length, 18);
  assert.equal(body.effects.filter(e => e.group === 'core').length, 12);
  assert.equal(body.effects[0].group, 'core'); assert.equal(body.effects.at(-1).group, 'design');
  const ward = body.effects.find(e => e.id === 'lt_fx_ward_pulse');
  assert.deepEqual(ward.variants, ['anchor', 'mirror', 'thorn', 'tide', 'flare', 'bell']);
  assert.equal(ward.frames, 78 / 6);
  assert.deepEqual(body.floors.map(f => f.id), ['grey', 'court', 'dark']);
  assert.ok(body.floors.every(f => /^#[0-9a-f]{6}$/.test(f.color)));
  assert.equal(body.effects.reduce((n, e) => n + (e.group === 'design' ? e.frames * e.variants.length : 0), 0), 188);
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

test('the pack\'s ui.vfx block supplies floors, history and the two docs; the tab server carries none of them', async () => {
  const pack = JSON.parse(fs.readFileSync(root + 'studio.project.json', 'utf8'));
  assert.deepEqual(pack.ui.vfx.floors.map(f => f.id), ['grey', 'court', 'dark']);
  for (const k of ['roundsDir', 'rubricDoc', 'effectsDoc']) assert.ok(fs.existsSync(root + pack.ui.vfx[k]), k);
  const server = fs.readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.ok(!/ink_0\d|LESSONS_vfx|LONGTIME_VFX|vfx_specs\/history/.test(server), 'no project colour or document name is left in the tab server');
});

test('compareFrames: identical, differing, resized and missing frames', () => {
  const img = (w, h, v) => ({width: w, height: h, pixels: Buffer.alloc(w * h * 4, v)});
  const same = compareFrames([img(2, 2, 1), img(2, 2, 2)], [img(2, 2, 1), img(2, 2, 2)]);
  assert.equal(same.identical, true);
  const bad = compareFrames([img(2, 2, 1), img(2, 2, 2), img(3, 3, 0), img(2, 2, 0)], [img(2, 2, 1), img(2, 2, 9), img(2, 2, 0), null]);
  assert.deepEqual([bad.identical, bad.pixelIdentical, bad.differing, bad.sizeMismatch, bad.missing], [false, 1, [1], [2], [3]]);
  assert.equal(compareFrames([img(1, 1, 0)], [img(1, 1, 0), img(1, 1, 0)]).identical, false, 'a different frame count is not identical');
});

const post = (body, ctx = context) => {
  let status, out;
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {method: 'POST', headers: {'content-type': 'application/json'}});
  const res = {writeHead(s) { status = s; }, end(t) { out = JSON.parse(t); }};
  return handle(req, res, new URL('http://127.0.0.1/api/tabs/vfx/build'), ctx).then(() => ({status, body: out}), e => ({status: e.status, error: e.code}));
};
const haveFx = fs.existsSync(root + 'tools/.venvs/spritefx/bin/python') && fs.existsSync(root + 'tools/skills/spritefx');
const dirty = () => execFileSync('git', ['status', '--porcelain', '--', 'assets', 'tools', 'docs', 'studio.project.json'], {cwd: root, encoding: 'utf8'});

test('build: refuses a bad request before running anything', async () => {
  assert.equal((await post({id: 'ghost'})).error, 'unknown_effect');
  const noType = Object.assign(Readable.from([Buffer.from('{}')]), {method: 'POST', headers: {}});
  await assert.rejects(handle(noType, {writeHead() {}, end() {}}, new URL('http://127.0.0.1/api/tabs/vfx/build'), context), {status: 415});
});

test('build: rebuilds a core and a Longtime effect in scratch, reports audits and identity, writes nothing the project tracks', { skip: haveFx ? false : 'the SpriteFX environment is not available' }, async () => {
  const before = dirty();
  const core = (await post({id: 'hit_spark'})).body;
  assert.equal(core.ok, true);
  assert.equal(core.audit.faults, 0); assert.equal(core.deterministic, true); assert.equal(core.gate.verdict, 'pass');
  assert.equal(core.compare.frames.identical, true);
  assert.match(core.compare.verdict, /identical/);
  assert.ok(!core.audit.output.includes(root), 'program output carries project-relative paths only');
  assert.equal(core.writesToAssets, false); assert.equal(core.changesStatus, false);
  assert.ok(core.sheet.png.length > 100 && core.sheet.frames.length === core.table.count);
  const lt = (await post({id: 'lt_fx_stamp', clip: 'press', variant: 'oath'})).body;
  assert.equal(lt.spec.path, 'assets/raw/longtime/lt_fx_stamp/specs/press_oath.json');
  assert.equal(lt.compare.byteIdentical, true, 'the rebuilt sheet matches the hash its provenance recorded');
  assert.equal(lt.compare.verdict, 'byte-identical');
  assert.equal(dirty(), before, 'no tracked or new project file changed');
});

test('build: a project that cannot be opened does not leave the build slot taken', async () => {
  const empty = fs.mkdtempSync(os.tmpdir() + '/vfx-nopack-');
  const effect = {id: 'x'};
  for (let i = 0; i < 2; i++) {
    await assert.rejects(buildAndAudit({root: empty, effect, specPath: 'x.json', deliveredPaths: []}), e => e.code !== 'build_running', `attempt ${i + 1} fails on the project, not on a stuck slot`);
  }
  fs.rmSync(empty, {recursive: true});
});
