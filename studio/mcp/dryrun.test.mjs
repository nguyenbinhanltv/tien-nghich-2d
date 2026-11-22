// dryRun on every MCP tool that writes: it returns what the real call would change and writes NOTHING.
// "Nothing" is proved by fingerprinting the whole project directory (every file, every directory, the
// revision store and the Studio database included) before and after, for every writing tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { join, relative } from 'node:path';
import { REPO, HAVE_PYTHON, HAVE_SPRITEFX, PROVENANCE, clipFrames, connect, makeFrame, makeProject } from './testkit.mjs';
import { buildRegistry } from './tools/index.mjs';
import { convertPrototypeRig } from '../forge/rig/tests/fixtures/convert-prototype-rig.mjs';
import { openProject } from './project.mjs';
import { JobRunner } from '../core/jobs.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const withProject = async (fn, opts = {}) => { const p = makeProject({ git: false, toolchain: true, ...opts }); try { return await fn(p); } finally { await p.cleanup(); } };
const ICON = 'lt_icon_realm_step'; // planned 16x16 icon, one frame
const square = [{ op: 'fill', box: [4, 4, 12, 12], color: 'jade_03' }, { op: 'outline' }];
const skipPy = HAVE_PYTHON ? false : 'the project Python environment is not available';
const skipFx = HAVE_SPRITEFX ? false : 'the SpriteFX environment is not available';

/** SHA-256 over every path (files and directories, symlinks by target) and every file's bytes under root. */
function fingerprint(root) {
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = join(dir, e.name), rel = relative(root, abs);
      if (e.isSymbolicLink()) hash.update(`L ${rel} ${fs.readlinkSync(abs)}\n`);
      else if (e.isDirectory()) { hash.update(`D ${rel}\n`); walk(abs); }
      else hash.update(`F ${rel} ${crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}\n`);
    }
  };
  walk(root);
  return hash.digest('hex');
}
const scratchDirs = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('studio-dry-'));

/** Run `call` (a dryRun call) and prove the project is byte-identical afterwards; returns the result. */
async function writesNothing(p, call) {
  const before = fingerprint(p.root), scratch = scratchDirs().length;
  const r = await call();
  assert.equal(fingerprint(p.root), before, 'the project changed during a dryRun');
  assert.equal(scratchDirs().length, scratch, 'a dryRun left a scratch directory behind');
  assert.equal(r.isError, undefined, text(r));
  assert.equal(r.structuredContent.dryRun, true);
  assert.equal(r.structuredContent.wrote, 'nothing');
  return r.structuredContent;
}

const exists = (p, rel) => fs.existsSync(join(p.root, rel));

// ---- the tools that write, and the ones that do not -------------------------------------------------
const WRITERS = ['studio_asset_plan', 'studio_audio_render', 'studio_frame_patch', 'studio_frames_submit', 'studio_generator_run', 'studio_metadata_set',
  'studio_pack', 'studio_process', 'studio_qa_run', 'studio_review_reply', 'studio_review_request', 'studio_rig_bake', 'studio_sheet_import',
  'studio_template_get', 'studio_vfx_build'];
const READERS = ['studio_asset_get', 'studio_audio_analyze', 'studio_catalog_search', 'studio_diff', 'studio_frame_read', 'studio_job_status', 'studio_job_wait',
  'studio_preview_render', 'studio_project_info', 'studio_review_list', 'studio_scene_snapshot'];

test('every tool that can write takes dryRun, and none of the others does; 26 tools in all', () => {
  const tools = buildRegistry().list('pack');
  assert.equal(tools.length, 26, 'the studio MCP has 26 tools after studio_frame_read');
  assert.deepEqual(tools.map((t) => t.name).sort(), [...WRITERS, ...READERS].sort(), 'a new tool must be listed here as a writer (with a dryRun test below) or a reader');
  for (const t of tools) {
    const has = Object.hasOwn(t.inputSchema.properties, 'dryRun');
    assert.equal(has, WRITERS.includes(t.name), `${t.name} ${has ? 'has' : 'lacks'} dryRun`);
    if (has) assert.equal(t.inputSchema.properties.dryRun.type, 'boolean');
  }
  // The author-scope tools that write are the ones not marked read-only, plus the two read-scope tools with a write switch.
  const notReadOnly = tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name);
  for (const name of notReadOnly) assert.ok(WRITERS.includes(name), `${name} is not read-only but is not listed as a writer`);
  assert.deepEqual(WRITERS.filter((n) => !notReadOnly.includes(n)).sort(), ['studio_template_get'], 'a read-scope tool with a write switch');
});

test('asset_plan dryRun: the entry, field by field; nothing written; the real call then does exactly that', () => withProject(async (p) => {
  const a = connect(p.root);
  const args = { op: 'create', id: 'lt_dry_monk', profile: 'npc', chunk: 'abode', brief: 'A monk who carries a paper lantern.', dependencies: ['lt_kiln_keeper'] };
  const d = await writesNothing(p, () => a.call('studio_asset_plan', { ...args, dryRun: true }));
  assert.equal(d.op, 'create');
  assert.deepEqual(d.wouldWrite, ['assets/studio_plans.json']);
  assert.deepEqual(d.changes.map((c) => c.field).sort(), ['brief', 'chunk_group', 'dependencies', 'method', 'phase', 'profile']);
  assert.equal(d.changes.find((c) => c.field === 'brief').to, args.brief);
  assert.equal(exists(p, 'assets/studio_plans.json'), false);
  assert.match(text(await a.call('studio_asset_get', { assetId: 'lt_dry_monk' })), /No asset/);
  const real = await a.ok('studio_asset_plan', args);
  assert.deepEqual(real.entry.brief, d.entry.brief);
  // An edit: from and to per field; the stale-etag and locked-manifest rules still apply.
  const e = await writesNothing(p, () => a.call('studio_asset_plan', { op: 'edit', id: 'lt_dry_monk', etag: real.etag, brief: 'A monk with a bell.', phase: 'wave_1', dryRun: true }));
  assert.deepEqual(e.changes.sort((x, y) => (x.field < y.field ? -1 : 1)), [{ field: 'brief', from: args.brief, to: 'A monk with a bell.' }, { field: 'phase', from: 'later', to: 'wave_1' }]);
  assert.match(text(await a.call('studio_asset_plan', { op: 'edit', id: 'lt_dry_monk', etag: 'nope', brief: 'x', dryRun: true })), /changed since you read it/);
  assert.match(text(await a.call('studio_asset_plan', { op: 'create', id: 'lt_dry_monk', profile: 'npc', chunk: 'abode', brief: 'x', dryRun: true })), /already exists/);
}));

test('frames_submit dryRun: the gates and the file list; nothing written; same on a project with history', () => withProject(async (p) => {
  const a = connect(p.root);
  const frames = [{ clip: 'glyph', direction: 'none', n: 0, pngBase64: makeFrame(16, 16).png.toString('base64') }];
  const d = await writesNothing(p, () => a.call('studio_frames_submit', { assetId: ICON, frames, provenance: PROVENANCE, dryRun: true }));
  assert.deepEqual(d.wouldWrite, [`assets/raw/longtime/${ICON}/frames/glyph_none_0.png`]);
  assert.equal(exists(p, d.wouldWrite[0]), false);
  const bad = await a.call('studio_frames_submit', { assetId: ICON, frames: [{ ...frames[0], pngBase64: makeFrame(16, 16, { damage: [{ x: 8, y: 8, kind: 'color' }] }).png.toString('base64') }], provenance: PROVENANCE, dryRun: true });
  assert.equal(bad.isError, true, 'the gates judge a dry run exactly as a real one');
  assert.equal(bad.structuredContent.wrote, 'nothing');
  const before = fingerprint(p.root);
  const real = await a.ok('studio_frames_submit', { assetId: ICON, frames, provenance: PROVENANCE });
  assert.deepEqual(real.written, d.wouldWrite);
  assert.notEqual(fingerprint(p.root), before, 'the fingerprint does see a real write');
  const again = await writesNothing(p, () => a.call('studio_frames_submit', { assetId: ICON, frames, provenance: PROVENANCE, dryRun: true }));
  assert.deepEqual([again.wouldWrite, again.unchanged], [[], d.wouldWrite]);
}));

test('frame_patch dryRun: every pixel it would change, for create, revision and bake; nothing written', () => withProject(async (p) => {
  const a = connect(p.root);
  const create = { assetId: ICON, target: 'create', edits: [{ frame: 'glyph_none_0', ops: square }] };
  const c = await writesNothing(p, () => a.call('studio_frame_patch', { ...create, dryRun: true }));
  assert.deepEqual(c.wouldWrite, [`assets/raw/longtime/${ICON}/frames/glyph_none_0.png`]);
  assert.equal(c.frames[0].changedPixels, 8 * 8, 'the 8x8 box, whose edge is the outline');
  assert.deepEqual(c.frames[0].changes[0], { x: 4, y: 4, from: '.', to: c.frames[0].changes[0].to });
  assert.notEqual(c.frames[0].changes[0].to, '.');
  assert.equal(exists(p, c.wouldWrite[0]), false);
  // The gates apply: a shape with no outline is refused, as a real call would refuse it.
  const bad = await a.call('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: 'glyph_none_0', ops: [square[0]] }], dryRun: true });
  assert.equal(bad.isError, true);
  assert.equal(exists(p, c.wouldWrite[0]), false);
  await a.ok('studio_frame_patch', create);

  // revision: per-pixel, with from and to; and no new revision appears.
  const rev = await writesNothing(p, () => a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', ops: [{ op: 'set', pixels: [[7, 7, 'bronze_04'], [8, 8, 'bronze_04']] }] }], dryRun: true }));
  assert.equal(rev.target, 'revision');
  assert.equal(rev.frames[0].changedPixels, 2);
  assert.deepEqual(rev.frames[0].changes.map((x) => [x.x, x.y]), [[7, 7], [8, 8]]);
  assert.equal(rev.wouldSave[0].as, 'new revision, pending');
  assert.equal((await a.ok('studio_diff', { assetId: ICON })).frames[0].status, 'single_revision');
  // The text form proposes the same way.
  const read = await a.ok('studio_frame_read', { assetId: ICON, frame: 'glyph_none_0' });
  const rows = read.rows.map((row, y) => (y === 7 ? row.slice(0, 7) + 'b' + row.slice(8) : row));
  const text1 = await writesNothing(p, () => a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: 'glyph_none_0', rows, legend: { ...Object.fromEntries(read.legend.map((l) => [l.char, l.id])), b: 'bronze_04' }, hash: read.hash }], dryRun: true }));
  assert.deepEqual(text1.frames[0].changes.map((x) => [x.x, x.y]), [[7, 7]]);
  // bake: the stored operations, and the file they would go to.
  await a.ok('studio_frame_patch', { assetId: 'lt_reed_crane', target: 'bake', edits: [{ frame: 'idle_south_0', ops: [{ op: 'set', pixels: [[1, 1, 'jade_03']] }] }] });
  const bake = await writesNothing(p, () => a.call('studio_frame_patch', { assetId: 'lt_reed_crane', target: 'bake', edits: [{ frame: 'idle_south_1', ops: [{ op: 'set', pixels: [[2, 2, 'jade_03']] }] }], dryRun: true }));
  assert.deepEqual(bake.wouldWrite, ['assets/raw/longtime/lt_reed_crane/forge/patch.json']);
  assert.equal(JSON.parse(fs.readFileSync(join(p.root, bake.wouldWrite[0]), 'utf8')).frames.idle_south_1, undefined);
}));

test('metadata_set dryRun: each field that would change, from and to', () => withProject(async (p) => {
  const a = connect(p.root);
  const d = await writesNothing(p, () => a.call('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [16, 30], clips: { idle: { frameMs: [100, 100, 100, 100] } }, dryRun: true }));
  assert.deepEqual(d.wouldWrite, ['assets/raw/longtime/lt_seed_broker/studio-metadata.json']);
  assert.deepEqual(d.changes, [{ field: 'pivot', from: null, to: [16, 30] }, { field: 'clips.idle.frameMs', from: null, to: [100, 100, 100, 100] }]);
  assert.equal(exists(p, d.wouldWrite[0]), false);
  await a.ok('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [16, 30] });
  const etag = (await a.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['metadata'] })).metadata.etag;
  const same = await writesNothing(p, () => a.call('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [16, 30], etag, dryRun: true }));
  assert.deepEqual([same.changes, same.wouldWrite], [[], []]);
  const moved = await writesNothing(p, () => a.call('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [8, 8], etag, dryRun: true }));
  assert.deepEqual(moved.changes, [{ field: 'pivot', from: [16, 30], to: [8, 8] }]);
  assert.match(text(await a.call('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [8, 8], dryRun: true })), /already has metadata; pass the etag/);
  assert.match(text(await a.call('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [99, 8], etag, dryRun: true })), /inside the 32x32 frame/);
}));

test('review_request and review_reply dryRun: the frames and the exact comment; nothing posted', () => withProject(async (p) => {
  const project = openProject(p.root);
  const jobs = new JobRunner();
  const author = connect(project, { agent: 'codex', jobs }), checker = connect(project, { agent: 'claude-code', jobs });
  await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) });
  // Without the other session's check the request is refused, in a dry run too.
  const refused = await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Look.', dryRun: true });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /different session/);
  await checker.ok('studio_qa_run', { assetId: 'lt_seed_broker', independent: true });
  const d = await writesNothing(p, () => author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Idle looks right.', questions: ['Is the pole too long?'], dryRun: true }));
  assert.equal(d.wouldAsk.length, 4);
  assert.match(d.comment, /\[agent codex · .{8}\] REVIEW REQUEST rq-\(assigned when sent\): Idle looks right\.\nQuestions:\n1\. Is the pole too long\?/);
  assert.equal((await author.ok('studio_review_list', { assetId: 'lt_seed_broker', detail: 'full' })).items.every((i) => i.requests === 0), true, 'no request exists');
  const real = await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'Idle looks right.', questions: ['Is the pole too long?'] });
  assert.equal(real.asked, 4);

  const key = 'longtime/lt_seed_broker/idle_south_0';
  const r = await writesNothing(p, () => author.call('studio_review_reply', { key, text: 'A note.', dryRun: true }));
  assert.match(r.wouldPost, /\[agent codex · .{8}\] NOTE: A note\./);
  assert.match(text(await author.call('studio_review_reply', { key, text: 'x', replyTo: 0, dryRun: true })), /comment|replyTo/);
  assert.equal((await author.ok('studio_review_list', { assetId: 'lt_seed_broker', detail: 'full' })).items[0].replies.length, 0);
}));

test('qa_run dryRun: the check it would record, recorded nowhere', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  await a.ok('studio_frames_submit', { assetId: ICON, frames: [{ clip: 'glyph', direction: 'none', n: 0, pngBase64: makeFrame(16, 16).png.toString('base64') }], provenance: PROVENANCE });
  const d = await writesNothing(p, () => a.call('studio_qa_run', { assetId: ICON, record: true, dryRun: true }));
  assert.equal(d.pass, true);
  assert.equal(d.recorded, undefined);
  assert.equal(d.wouldRecord.pass, true);
  const checks = (await a.project.workspace.db()).checks(ICON, 10);
  assert.deepEqual(checks, [], 'no check row exists');
  await a.ok('studio_qa_run', { assetId: ICON, record: true });
  assert.equal((await a.project.workspace.db()).checks(ICON, 10).length, 1);
}));

test('template_get dryRun: the files write=true would save, saved nowhere', () => withProject(async (p) => {
  const a = connect(p.root);
  const r = await writesNothing(p, () => a.call('studio_template_get', { assetId: 'lt_reed_crane', write: true, dryRun: true }));
  assert.match(r.template.wouldWrite.png, /work\/lt_reed_crane\/templates\/.+\.png$/);
  assert.equal(r.template.files, undefined);
  assert.equal(fs.existsSync(join(p.root, r.template.wouldWrite.png)), false);
  const real = await a.ok('studio_template_get', { assetId: 'lt_reed_crane', write: true });
  assert.equal(real.template.files.png, r.template.wouldWrite.png);
  assert.equal(fs.existsSync(join(p.root, real.template.files.png)), true);
}));

test('audio_render dryRun: numbers and pictures, no scratch, no candidate; says which version keep would make', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const doc = json(join(REPO, 'studio/audio/examples/zap.patch.json'));
  const d = await writesNothing(p, () => a.call('studio_audio_render', { cueId: 'sfx_step', document: doc, keep: true, dryRun: true }));
  assert.equal(d.deterministic, true);
  assert.equal(d.wouldKeep.version, 1);
  assert.deepEqual(d.wouldWrite.files, ['render.wav', 'waveform.png', 'spectrogram.png']);
  const r = await a.call('studio_audio_render', { cueId: 'sfx_step', document: doc, keep: true, dryRun: true });
  assert.deepEqual(r.content.map((c) => c.type), ['text', 'image', 'image'], 'you still see the pictures');
  assert.match(text(r), /DRY RUN, nothing was written/);
  const real = await a.ok('studio_audio_render', { cueId: 'sfx_step', document: doc, keep: true });
  assert.equal(real.kept.version, d.wouldKeep.version);
  assert.equal((await writesNothing(p, () => a.call('studio_audio_render', { cueId: 'sfx_step', document: doc, keep: true, dryRun: true }))).wouldKeep.version, 2);
}));

test('pack dryRun: the staging files it would write, written nowhere', () => withProject(async (p) => {
  const a = connect(p.root);
  const d = await writesNothing(p, () => a.call('studio_pack', { chunk: 'abode', dryRun: true }));
  assert.ok(d.wouldWrite.length >= 4 && d.wouldWrite.every((f) => f.startsWith('.inspector-revisions/staging/abode/')), d.wouldWrite.join());
  assert.equal(d.pass, true);
  assert.equal(d.shippedAtlases.unchanged, true);
  const real = await a.ok('studio_pack', { chunk: 'abode' });
  for (const f of d.wouldWrite) assert.equal(exists(p, f), true, `${f} is written by the real call`);
  assert.deepEqual(real.mobile.files, d.mobile.files, 'the dry run packed the same bytes');
  // Staging exists now: a dry run still leaves it exactly as it was.
  await writesNothing(p, () => a.call('studio_pack', { chunk: 'abode', dryRun: true }));
}));

// ---- the forge chain: import, pixelise, bake -----------------------------------------------------------
const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
const CRANE = 'lt_reed_crane';
const MARKS = [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }];

test('sheet_import, process and rig_bake dryRun: the files they would store, the frames submit would write; nothing written', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  const layout = json(join(EXP, 'layout.forge.json')), prompt = fs.readFileSync(join(EXP, 'prompt.txt'), 'utf8');
  const rig = convertPrototypeRig(json(join(EXP, 'rig.json')), { id: CRANE });
  const library = json(join(REPO, 'studio/forge/rig/tests/fixtures/marten/bakeoff-motion.json'));
  const imp = { assetId: CRANE, sheet: { file: 'work/turnaround.png' }, layout, prompt, tool: 'Codex built-in image generation' };

  const i = await writesNothing(p, () => a.call('studio_sheet_import', { ...imp, dryRun: true }));
  assert.equal(i.cells.length, 4);
  assert.ok(i.wouldWrite.some((f) => /forge\/sheets\/[0-9a-f]{16}\.png$/.test(f)) && i.wouldWrite.some((f) => /forge\/import\.json$/.test(f)), i.wouldWrite.join());
  assert.equal(exists(p, `assets/raw/longtime/${CRANE}/forge`), false);
  // Process needs a stored import: do the real one, then propose.
  const real = await a.ok('studio_sheet_import', imp);
  assert.ok(i.wouldWrite.filter((f) => !f.includes('(')).every((f) => exists(p, f)), 'the real import wrote what the dry run listed');
  assert.equal(real.sheet.file, i.wouldWrite.find((f) => f.endsWith('.png')));

  const px = await writesNothing(p, () => a.call('studio_process', { assetId: CRANE, marks: MARKS, dryRun: true }));
  assert.deepEqual(px.marks, ['soul_07']);
  assert.equal(px.wouldStoreMarks, `assets/raw/longtime/${CRANE}/forge/process.json`);
  assert.equal(exists(p, px.wouldStoreMarks), false);
  assert.match(text(await a.call('studio_process', { assetId: CRANE, marks: [{ color: 'nope_99' }], dryRun: true })), /./);
  await a.ok('studio_process', { assetId: CRANE, marks: MARKS });

  const bakeArgs = { assetId: CRANE, rig, library, qa: { weightTransfer: false } };
  const b = await writesNothing(p, () => a.call('studio_rig_bake', { ...bakeArgs, dryRun: true }));
  assert.equal(b.pass, true);
  assert.equal(b.frames, 32);
  assert.deepEqual(b.wouldStore, [`assets/raw/longtime/${CRANE}/forge/rig.json`, `assets/raw/longtime/${CRANE}/forge/library.json`]);
  assert.equal(b.bakeDir, undefined, 'no scratch directory is named, none exists');
  // dryRun + submit: the files submit would commit. submit=false stays the plain preview.
  const s = await writesNothing(p, () => a.call('studio_rig_bake', { ...bakeArgs, submit: true, dryRun: true }));
  assert.equal(s.submit.dryRun, true);
  assert.equal(s.submit.wouldWrite.length, 32);
  assert.equal(exists(p, `assets/raw/longtime/${CRANE}/frames`), false);
  const plain = await a.ok('studio_rig_bake', { ...bakeArgs });
  assert.equal(plain.submit, undefined, 'submit=false means preview and nothing else');
  assert.ok(plain.bakeDir, 'the real preview writes scratch');
  const sub = await a.ok('studio_rig_bake', { assetId: CRANE, submit: true, qa: { weightTransfer: false } });
  assert.deepEqual(sub.submit.written, 32);
  assert.deepEqual(s.submit.wouldWrite.slice().sort(), fs.readdirSync(join(p.root, `assets/raw/longtime/${CRANE}/frames`)).map((n) => `assets/raw/longtime/${CRANE}/frames/${n}`).sort(), 'dryRun listed exactly the files the commit wrote');
}));

// ---- the toolchain: generators and SpriteFX run a program, in a scratch directory OUTSIDE the project -------------
test('generator_run dryRun: the program runs outside the project; the frames submit would write; nothing written, nothing left behind', { skip: skipPy }, () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const args = { assetId: ICON, generator: 'primitives', params: { shape: 'diamond', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 7 };
  const preview = await writesNothing(p, () => a.call('studio_generator_run', { ...args, dryRun: true }));
  assert.equal(preview.deterministic, true);
  assert.equal(preview.workDir, undefined);
  const d = await writesNothing(p, () => a.call('studio_generator_run', { ...args, submit: true, dryRun: true }));
  assert.equal(d.submit.dryRun, true);
  assert.deepEqual(d.submit.wouldWrite, [`assets/raw/longtime/${ICON}/frames/glyph_none_0.png`]);
  const real = await a.ok('studio_generator_run', { ...args, submit: true });
  assert.deepEqual(real.submit.written, d.submit.wouldWrite);
}));

test('vfx_build dryRun: SpriteFX runs outside the project; the frames submit would write; nothing written', { skip: skipFx }, () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const FX = 'lt_fx_dry_spark';
  const plan = await a.call('studio_asset_plan', { op: 'create', id: FX, chunk: 'wards', brief: 'A test spark.', custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { play: { frames: 12, frameMs: 33 } } } });
  assert.equal(plan.isError, undefined, text(plan));
  const spec = json(join(REPO, 'tools/generators/vfx_specs/hit_spark.json'));
  const d = await writesNothing(p, () => a.call('studio_vfx_build', { assetId: FX, spec, submit: true, dryRun: true }));
  assert.equal(d.submit.dryRun, true);
  assert.equal(d.submit.wouldWrite.length, 12);
  assert.equal(d.workDir, undefined);
  const real = await a.ok('studio_vfx_build', { assetId: FX, spec, submit: true });
  assert.deepEqual(real.submit.written.slice().sort(), d.submit.wouldWrite.slice().sort());
}));

test('dryRun fails exactly where the real call fails: a bake patch past the size limit, a cue at its candidate limit', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  // Bake patch: an existing patch.json that is invalid, then one that the append would push past the size limit.
  const docRel = 'assets/raw/longtime/lt_reed_crane/forge/patch.json';
  const op = { frame: 'idle_south_0', ops: [{ op: 'set', pixels: [[1, 1, 'jade_03']] }] };
  fs.mkdirSync(join(p.root, 'assets/raw/longtime/lt_reed_crane/forge'), { recursive: true });
  fs.writeFileSync(join(p.root, docRel), JSON.stringify({ schema: 'studio.patch', version: 1, frames: { idle_south_1: [{ op: 'nope' }] } }));
  const bad = await a.call('studio_frame_patch', { assetId: 'lt_reed_crane', target: 'bake', edits: [op], dryRun: true });
  const badReal = await a.call('studio_frame_patch', { assetId: 'lt_reed_crane', target: 'bake', edits: [op] });
  assert.equal(bad.isError, true); assert.equal(badReal.isError, true);
  assert.match(text(bad), /stored patch would be invalid/);
  const big = { schema: 'studio.patch', version: 1, frames: { idle_south_1: Array.from({ length: 300 }, () => ({ op: 'set', pixels: Array.from({ length: 40 }, (_, i) => [i % 32, i % 32, 'jade_03']) })) } };
  fs.writeFileSync(join(p.root, docRel), JSON.stringify(big));
  const before = fingerprint(p.root);
  const huge = await a.call('studio_frame_patch', { assetId: 'lt_reed_crane', target: 'bake', edits: [op], dryRun: true });
  assert.equal(huge.isError, true);
  assert.match(text(huge), /patch document is \d+ bytes; the limit is/);
  assert.equal((await a.call('studio_frame_patch', { assetId: 'lt_reed_crane', target: 'bake', edits: [op] })).isError, true);
  assert.equal(fingerprint(p.root), before);
}));

test('audio_render dryRun with keep refuses a cue at its candidate limit, as the real call does', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const doc = json(join(REPO, 'studio/audio/examples/zap.patch.json'));
  const dir = join(p.root, 'assets/studio_audio/sfx_step');
  for (let v = 1; v <= 50; v++) fs.mkdirSync(join(dir, `v${v}`), { recursive: true });
  const d = await a.call('studio_audio_render', { cueId: 'sfx_step', document: doc, keep: true, dryRun: true });
  const real = await a.call('studio_audio_render', { cueId: 'sfx_step', document: doc, keep: true });
  assert.equal(d.isError, true); assert.equal(real.isError, true);
  assert.match(text(d), /already has 50 candidates/);
  assert.equal(d.structuredContent?.wouldKeep, undefined);
}));

test('pack dryRun lists the staging files the real call would remove; sheet_import dryRun refuses a corrupted stored sheet', () => withProject(async (p) => {
  const a = connect(p.root);
  await a.ok('studio_pack', { chunk: 'abode' });
  const both = await a.ok('studio_pack', { chunk: 'abode', dryRun: true });
  assert.ok(both.wouldReplace.length > 0 && both.wouldRemove.length === 0, 'the same pack replaces its own files');
  const web = await writesNothing(p, () => a.call('studio_pack', { chunk: 'abode', platform: 'web', dryRun: true }));
  assert.ok(web.wouldRemove.some((f) => f.includes('/mobile/')), 'the mobile output the real call clears is listed');
  assert.ok(web.wouldWrite.every((f) => f.includes('/web/')));
  const real = await a.ok('studio_pack', { chunk: 'abode', platform: 'web' });
  for (const f of web.wouldRemove) assert.equal(exists(p, f), false, `${f} was removed by the real call`);
  assert.ok(real.mobile === undefined);

  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  const imp = { assetId: CRANE, sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: fs.readFileSync(join(EXP, 'prompt.txt'), 'utf8'), tool: 'Codex' };
  const first = await a.ok('studio_sheet_import', imp);
  fs.writeFileSync(join(p.root, first.sheet.file), 'corrupted');
  const before = fingerprint(p.root);
  const d = await a.call('studio_sheet_import', { ...imp, dryRun: true });
  const r = await a.call('studio_sheet_import', imp);
  assert.equal(d.isError, true); assert.equal(r.isError, true);
  assert.match(text(d), /exists with different bytes/);
  assert.equal(fingerprint(p.root), before);
}));

test('process dryRun with marks only keeps the accents already stored, as the real call does', () => withProject(async (p) => {
  const a = connect(p.root);
  const MOB = 'lt_ash_skater';
  fs.mkdirSync(join(p.root, 'work'), { recursive: true });
  fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
  await a.ok('studio_sheet_import', { assetId: MOB, sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: 'x', tool: 'test' });
  await a.ok('studio_process', { assetId: MOB, accents: ['bronze_04', 'soul_07'] });
  const d = await writesNothing(p, () => a.call('studio_process', { assetId: MOB, marks: MARKS, dryRun: true }));
  assert.deepEqual(d.figure.accents, ['bronze_04', 'soul_07'], 'a marks-only dry run still checks the stored accents');
  const real = await a.ok('studio_process', { assetId: MOB, marks: MARKS });
  assert.deepEqual(real.figure.accents, d.figure.accents);
  // And a dry run that supplies accents replaces them, without storing.
  const d2 = await writesNothing(p, () => a.call('studio_process', { assetId: MOB, accents: ['bronze_04'], dryRun: true }));
  assert.deepEqual(d2.figure.accents, ['bronze_04']);
}));
