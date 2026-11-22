// studio_audio_render sized by a clip's gameplay window (F9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { REPO, connect, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const CUE = 'sfx_step';
const FX = 'lt_fx_test_spark';
const zap = () => JSON.parse(fs.readFileSync(join(REPO, 'studio/audio/examples/zap.patch.json'), 'utf8'));
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const plan = (a) => a.call('studio_asset_plan', { op: 'create', id: FX, chunk: 'wards', brief: 'A test spark.', custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { play: { frames: 12, frameMs: 40 } } } });

test('AUDIOWINDOW-003 a clip window reads the clip contract: the whole clip, or the time between two declared events; it says what is missing', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  assert.equal((await plan(a)).isError, undefined);
  const render = (clip, extra = {}) => a.call('studio_audio_render', { cueId: CUE, document: { ...zap(), window: { clip: { asset: FX, ...clip }, ...extra } }, dryRun: true });
  const whole = await render({ clip: 'play' });
  assert.equal(whole.isError, undefined, text(whole));
  assert.equal(whole.structuredContent.window.windowMs, 480, '12 frames at 40 ms');
  assert.match(whole.structuredContent.window.source, new RegExp(`${FX} clip play: frames 0 to 12 \\(start to end\\), 40 ms a frame`));
  assert.equal(whole.structuredContent.measurements.durationMs, 480);
  assert.match(text(await render({ clip: 'play', from: 'tell', to: 'hit' })), /has no event "tell"/);
  const set = await a.call('studio_metadata_set', { assetId: FX, clips: { play: { events: [{ frame: 2, name: 'tell' }, { frame: 8, name: 'hit' }], frameMs: Array(12).fill(40).map((v, i) => (i < 2 ? 100 : v)) } } });
  assert.equal(set.isError, undefined, text(set));
  const win = await render({ clip: 'play', from: 'tell', to: 'hit' }, { tailMs: 100 });
  assert.equal(win.isError, undefined, text(win));
  assert.equal(win.structuredContent.window.windowMs, 240, 'frames 2 to 8 at 40 ms, from the declared per-frame timing');
  assert.equal(win.structuredContent.window.totalMs, 340);
  assert.equal(win.structuredContent.measurements.durationMs, 340);
  assert.match(text(await render({ clip: 'nope' })), /has no clip "nope"/);
  assert.match(text(await render({ clip: 'play', to: 'hit', from: 'hit' })), /at least one frame/);
  assert.match(text(await a.call('studio_audio_render', { cueId: CUE, document: { ...zap(), window: { clip: { asset: 'ghost_asset', clip: 'play' } } } })), /not a frame asset with clips/);
}));

test('AUDIOWINDOW-004 audio_render sizes by the window before rendering, returns and records the hash, and dryRun writes nothing', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const document = { ...zap(), window: { frames: 6, frameMs: 100, tailMs: 40 } };
  const before = fs.existsSync(join(p.root, 'assets/studio_audio', CUE));
  const dry = await a.call('studio_audio_render', { cueId: CUE, document, dryRun: true });
  assert.equal(dry.isError, undefined, text(dry));
  const s = dry.structuredContent;
  assert.equal(s.window.totalMs, 640);
  assert.match(s.window.configSha256, /^[0-9a-f]{64}$/);
  assert.equal(s.measurements.durationMs, 640);
  assert.equal(s.deterministic, true);
  assert.equal(fs.existsSync(join(p.root, 'assets/studio_audio', CUE)), before, 'a dry run wrote nothing');
  const again = await a.call('studio_audio_render', { cueId: CUE, document, dryRun: true });
  assert.equal(again.structuredContent.window.configSha256, s.window.configSha256);
  assert.equal(again.structuredContent.wavSha256, s.wavSha256);
  const kept = await a.call('studio_audio_render', { cueId: CUE, document, keep: true });
  assert.equal(kept.isError, undefined, text(kept));
  const dir = join(p.root, kept.structuredContent.kept.dir);
  const prov = JSON.parse(fs.readFileSync(join(dir, 'provenance.json'), 'utf8'));
  assert.equal(prov.window.configSha256, s.window.configSha256, 'the configuration hash is recorded with the candidate');
  assert.equal(prov.window.config.windowMs, 600);
  const source = JSON.parse(fs.readFileSync(join(dir, 'source.json'), 'utf8'));
  assert.equal(source.durationMs, 640);
  assert.equal(source.window, undefined, 'the stored source is the sized patch the engine rendered');
  // a window on a score is refused; a bad window says why
  assert.match(text(await a.call('studio_audio_render', { cueId: CUE, document: { ...JSON.parse(fs.readFileSync(join(REPO, 'studio/audio/examples/dusk.score.json'), 'utf8')), window: { ms: 500 } } })), /sizes a one-shot patch/);
  assert.match(text(await a.call('studio_audio_render', { cueId: CUE, document: { ...zap(), window: { ms: 0 } } })), /positive/);
}));
