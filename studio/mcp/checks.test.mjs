import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeRgba } from '../core/png.mjs';
import { PROVENANCE, clipFrames, connect, makeFrame, makeProject, writeFrame } from './testkit.mjs';
import { openProject } from './project.mjs';
import { JobRunner } from '../core/jobs.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn, opts = { git: true }) => { const p = makeProject(opts); try { return await fn(p); } finally { await p.cleanup(); } };
const RAW = 'assets/raw/longtime/lt_seed_broker/frames';
const submitIdle = (c, n = 4, base = 0) => c.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', n, 32, 32, base) });
const damage = (root, name, dmg, variant = 1) => writeFileSync(join(root, RAW, `${name}.png`), makeFrame(32, 32, { variant, damage: dmg }).png);

// ---- qa_run --------------------------------------------------------------------------------
test('qa_run: shipped frames pass every check; partial raw work passes with warnings', () => withProject(async (p) => {
  const { ok } = connect(p.root, { scope: 'read' });
  const kk = await ok('studio_qa_run', { assetId: 'lt_kiln_keeper' });
  assert.equal(kk.stage, 'processed');
  assert.equal(kk.pass, true);
  assert.deepEqual(kk.summary, { frames: 32, expected: 32, errors: 0, warnings: 0, framesWithErrors: 0, rawStage: false });
  assert.deepEqual(Object.values(kk.checks).map((c) => c.pass), [true, true, true, true, true, true]);
  assert.deepEqual(Object.keys(kk.checks), ['palette', 'alpha', 'outline', 'size', 'frameCount', 'naming']);

  const a = connect(p.root);
  await submitIdle(a);
  const raw = await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' });
  assert.equal(raw.stage, 'raw', 'no processed frames, so the raw submissions are judged');
  assert.equal(raw.pass, true);
  assert.equal(raw.summary.rawStage, true);
  assert.match(raw.stageNote, /raw stage: .*warnings \(not errors\).*does not mean the run skipped anything/);
  assert.equal(kk.stageNote, undefined);
  assert.equal(raw.summary.frames, 4);
  assert.equal(raw.checks.frameCount.pass, true, 'a partial raw set is progress, not failure');
  assert.equal(raw.checks.frameCount.warnings, 28);
  assert.equal(raw.missingCount, 28);
  assert.deepEqual(raw.authors, [{ agent: 'tester', session: a.session.slice(0, 8) }]);
  const processedNone = await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', stage: 'processed' });
  assert.equal(processedNone.pass, false, 'no processed frames: nothing passed');
  assert.equal(processedNone.summary.frames, 0);
}));

test('qa_run: every kind of defect is attributed to its check, with coordinates', () => withProject(async (p) => {
  const a = connect(p.root);
  await submitIdle(a);
  // Frames are immutable through the tools; tamper on disk the way a careless script or merge could.
  damage(p.root, 'idle_south_1', [{ x: 10, y: 12, kind: 'alpha' }]);
  damage(p.root, 'idle_south_2', [{ x: 14, y: 15, kind: 'color' }]);
  damage(p.root, 'idle_south_3', [{ x: 6, y: 9, kind: 'gap' }]);
  writeFrame(p.root, `${RAW}/idle_south_9.png`, makeFrame(32, 32));   // beyond the spec's 4 frames
  writeFrame(p.root, `${RAW}/idle_west_x.png`, makeFrame(32, 32));    // not a valid name
  writeFrame(p.root, `${RAW}/interact_south_0.png`, makeFrame(24, 24)); // wrong canvas
  const r = await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', detail: 'frames' });
  assert.equal(r.pass, false);
  assert.equal(r.checks.alpha.pass, false);
  assert.equal(r.checks.palette.pass, false);
  assert.equal(r.checks.outline.pass, false);
  assert.equal(r.checks.size.pass, false);
  assert.equal(r.checks.naming.pass, false);
  assert.equal(r.checks.frameCount.pass, false);
  assert.match(r.checks.alpha.details[0], /idle_south_1: 1 partial_alpha e\.g\. \(10, 12\)/);
  assert.match(r.checks.palette.details[0], /idle_south_2: 1 off_palette e\.g\. \(14, 15\)/);
  assert.match(r.checks.outline.details[0], /idle_south_3: 1 outline_gap e\.g\. \(6, 9\)/);
  assert.match(r.checks.size.details.join(), /interact_south_0: canvas 24x24 does not match 32x32/);
  assert.match(r.checks.naming.details.join(), /idle_west_x\.png does not match/);
  assert.deepEqual(r.unexpected, ['idle_south_9']);
  const byName = Object.fromEntries(r.frames.map((f) => [f.name, f]));
  assert.deepEqual(byName.idle_south_1.defects.map((d) => [d.code, d.x, d.y]), [['partial_alpha', 10, 12]]);
  assert.equal(byName.idle_south_0, undefined, 'clean frames are not listed');
}));

test('qa_run: a selection narrows the frames judged', () => withProject(async (p) => {
  const a = connect(p.root);
  await submitIdle(a);
  damage(p.root, 'idle_south_1', [{ x: 10, y: 12, kind: 'alpha' }]);
  assert.equal((await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', frame: 0 })).pass, true);
  assert.equal((await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', frame: 1 })).pass, false);
  assert.equal((await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', clip: 'idle', direction: 'south' })).summary.frames, 4);
  assert.equal((await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', clip: 'interact' })).summary.frames, 0);
  assert.match(text(await a.call('studio_qa_run', { assetId: 'bgm_hengyue' })), /has no candidate yet/, 'an audio cue is judged on its candidates');
}));

test('qa_run: an independent check must come from a different session than the author', () => withProject(async (p) => {
  const project = openProject(p.root);
  const jobs = new JobRunner();
  const author = connect(project, { agent: 'codex', jobs });
  const checker = connect(project, { agent: 'claude-code', jobs });
  assert.notEqual(author.session, checker.session);
  await submitIdle(author);

  const self = await author.call('studio_qa_run', { assetId: 'lt_seed_broker', independent: true });
  assert.equal(self.isError, true);
  assert.match(text(self), /must come from a different session than the one that authored/);
  assert.match(text(self), new RegExp(author.session.slice(0, 8)));
  assert.equal((await author.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).checks.length, 0, 'the refused claim recorded nothing');

  // The author may still check their own work; it is recorded as NOT independent.
  const own = await author.ok('studio_qa_run', { assetId: 'lt_seed_broker', record: true });
  assert.equal(own.recorded.independent, false);
  assert.match(own.recorded.note, /not independent/);

  // A second session, even running the same agent, is independent: independence is about sessions.
  const sameAgent = connect(project, { agent: 'codex', jobs });
  const other = await sameAgent.ok('studio_qa_run', { assetId: 'lt_seed_broker', independent: true });
  assert.equal(other.recorded.independent, true);
  assert.equal(other.recorded.pass, true);

  const checks = (await checker.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).checks;
  assert.deepEqual(checks.map((c) => [c.independent, c.pass, c.current]), [[true, true, true], [false, true, true]]);
  assert.equal(checks[0].session, sameAgent.session.slice(0, 8));

  // Changing the frames makes earlier checks stale.
  damage(p.root, 'idle_south_0', [], 5);
  const after = (await checker.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).checks;
  assert.deepEqual(after.map((c) => c.current), [false, false]);
}));

test('qa_run: recording needs author scope and a whole-asset run', () => withProject(async (p) => {
  const a = connect(p.root);
  await submitIdle(a);
  const read = connect(p.root, { scope: 'read' });
  assert.match(text(await read.call('studio_qa_run', { assetId: 'lt_seed_broker', record: true })), /needs scope "author"/);
  assert.match(text(await read.call('studio_qa_run', { assetId: 'lt_seed_broker', independent: true })), /needs scope "author"/);
  assert.equal((await read.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).pass, true, 'a plain run is read-only');
  assert.match(text(await a.call('studio_qa_run', { assetId: 'lt_seed_broker', record: true, clip: 'idle' })), /whole asset/);
  assert.equal((await a.project.workspace.db()).checks('lt_seed_broker').length, 0, 'nothing was recorded by the refused calls');
}));

test('qa_run, preview_render and diff run as jobs: status, wait, result', () => withProject(async (p) => {
  const { ok, call, jobs } = connect(p.root);
  await submitIdle(ok.constructor === Function ? { ok } : { ok });
  const started = await ok('studio_qa_run', { assetId: 'lt_seed_broker', background: true });
  assert.match(started.jobId, /^job-/);
  assert.equal(['queued', 'running', 'succeeded'].includes(started.status), true);
  const status = await ok('studio_job_status', { jobId: started.jobId });
  assert.equal(status.name, 'qa_run');
  assert.equal(status.owner.agent, 'tester');
  const done = await call('studio_job_wait', { jobId: started.jobId, timeoutSeconds: 20 });
  assert.equal(done.structuredContent.job.status, 'succeeded');
  assert.equal(done.structuredContent.result.pass, true);
  assert.ok(done.structuredContent.job.cost.wallMs >= 0);

  const img = await call('studio_preview_render', { assetId: 'lt_seed_broker', background: true });
  const img2 = await call('studio_job_wait', { jobId: img.structuredContent.jobId, timeoutSeconds: 20 });
  assert.deepEqual(img2.content.map((c) => c.type), ['text', 'image'], 'a job result keeps its image');
  const d = await call('studio_diff', { assetId: 'lt_seed_broker', against: 'main', background: true });
  assert.equal((await call('studio_job_wait', { jobId: d.structuredContent.jobId, timeoutSeconds: 20 })).structuredContent.result.summary.added, 4);

  // A job that is still running reports so; a job that fails reports why; unknown ids say what to do.
  const slow = jobs.submit({ name: 'slow', owner: {}, run: async () => { await new Promise((r) => setTimeout(r, 1500)); return { content: [{ type: 'text', text: 'late' }], structuredContent: { late: true } }; } });
  const running = await call('studio_job_wait', { jobId: slow.id, timeoutSeconds: 1 });
  assert.equal(running.structuredContent.job.status, 'running');
  assert.match(text(running), /call studio_job_wait again/);
  assert.equal((await call('studio_job_wait', { jobId: slow.id, timeoutSeconds: 20 })).structuredContent.result.late, true);
  const failing = jobs.submit({ name: 'f', owner: {}, run: async () => { throw new Error('it broke'); } });
  const failed = await call('studio_job_wait', { jobId: failing.id, timeoutSeconds: 5 });
  assert.equal(failed.isError, true);
  assert.match(text(failed), /failed: it broke/);
  assert.match(text(await call('studio_job_status', { jobId: 'job-ffffffffff' })), /No job "job-ffffffffff"/);
  assert.match(text(await call('studio_job_wait', { jobId: 'job-ffffffffff' })), /No job/);
}));

// ---- diff ----------------------------------------------------------------------------------
test('diff against main: unchanged, changed (with pixels) and added frames', () => withProject(async (p) => {
  const { ok, call } = connect(p.root);
  const clean = await ok('studio_diff', { assetId: 'lt_kiln_keeper', against: 'main', clip: 'idle', direction: 'south' });
  assert.equal(clean.main.ref === 'main' || clean.main.ref === 'origin/main', true);
  assert.match(clean.main.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(clean.summary, { frames: 4, changed: 0, unchanged: 4, added: 0, noHistory: 0 });

  // Change one pixel of one processed frame in the worktree.
  const rel = 'assets/processed_longtime/lt_kiln_keeper/idle_south_2.png';
  const frame = decodeRgba(readFileSync(join(p.root, rel)));
  const k = frame.pixels.findIndex((_, i) => i % 4 === 3 && frame.pixels[i] === 255);
  const px = (k - 3) / 4, x = px % 32, y = Math.floor(px / 32);
  const { encodePixels } = await import('../core/png.mjs');
  const edited = Buffer.from(frame.pixels);
  edited[k - 3] = (edited[k - 3] + 1) & 255; // red channel of that pixel
  writeFileSync(join(p.root, rel), encodePixels(32, 32, edited));
  const changed = await ok('studio_diff', { assetId: 'lt_kiln_keeper', against: 'main', clip: 'idle', direction: 'south' });
  assert.equal(changed.summary.changed, 1);
  const f = changed.frames.find((r) => r.frame === 'idle_south_2');
  assert.equal(f.changedPixels, 1);
  assert.deepEqual(f.box, { x, y, w: 1, h: 1 });
  assert.equal(f.sample[0].x, x);
  assert.match(f.sample[0].before, /^#[0-9a-f]{6}$/);
  assert.notEqual(f.hashes.before, f.hashes.after);

  // New frames are not on main.
  await submitIdle({ ok });
  const added = await ok('studio_diff', { assetId: 'lt_seed_broker', against: 'main' });
  assert.equal(added.stage, 'raw');
  assert.equal(added.summary.added, 4);
  assert.match(added.frames[0].note, /not on /);

  assert.match(text(await call('studio_diff', { assetId: 'lt_kiln_keeper', clip: 'dance' })), /no processed frames matching/);
  assert.match(text(await call('studio_diff', { assetId: 'lt_kiln_keeper', against: 'yesterday' })), /must be one of/);
}));

test('diff against main without git says so; against previous reports missing history', () => withProject(async (p) => {
  const { ok, call } = connect(p.root);
  assert.match(text(await call('studio_diff', { assetId: 'lt_kiln_keeper', against: 'main' })), /Cannot find main/);
  const none = await ok('studio_diff', { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'south' });
  assert.equal(none.against, 'previous');
  assert.equal(none.summary.noHistory, 4);
  assert.equal(none.frames[0].status, 'no_history');
  await submitIdle({ ok });
  const single = await ok('studio_diff', { assetId: 'lt_seed_broker' });
  assert.equal(single.summary.noHistory, 4);
  assert.equal(single.frames[0].status, 'single_revision');
}, { git: false }));

test('diff against previous: a new revision in the store is compared with the one before', () => withProject(async (p) => {
  const c = connect(p.root);
  await submitIdle(c);
  // A second revision, made the way the review UI makes one: through the revision store.
  const ws = c.project.workspace;
  const store = await ws.store();
  const { bareFrame } = await import('../core/review.mjs');
  const png = makeFrame(32, 32, { variant: 7 }).png;
  store.operate(bareFrame('longtime/lt_seed_broker/idle_south_1'), png, 'save', { baseRevision: 0, png });
  const r = await c.ok('studio_diff', { assetId: 'lt_seed_broker', clip: 'idle', direction: 'south' });
  const f1 = r.frames.find((x) => x.frame === 'idle_south_1');
  assert.equal(f1.revision, 1);
  assert.equal(f1.comparedWith, 0);
  assert.ok(f1.changedPixels > 0 && f1.box && f1.sample.length);
  assert.equal(r.frames.find((x) => x.frame === 'idle_south_0').status, 'single_revision');
  assert.equal(r.summary.changed, 1);
}));

// ---- preview_render ------------------------------------------------------------------------
const GREEN = [0x4c, 0xd1, 0x7c], RED = [0xff, 0x2d, 0x6f];
const pixelAt = (img, x, y) => [...img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];

test('preview_render: returns a real image with a status bar and defect boxes in the right place', () => withProject(async (p) => {
  const { call, ok } = connect(p.root);
  await submitIdle({ ok });
  const clean = await call('studio_preview_render', { assetId: 'lt_seed_broker' });
  assert.deepEqual(clean.content.map((c) => c.type), ['text', 'image']);
  assert.equal(clean.content[1].mimeType, 'image/png');
  const img = decodeRgba(Buffer.from(clean.content[1].data, 'base64'));
  const meta = clean.structuredContent;
  assert.equal(img.width, meta.width);
  assert.equal(img.height, meta.height);
  assert.deepEqual(meta.layout.rows, [{ clip: 'idle', direction: 'south', frames: [0, 1, 2, 3], status: ['clean', 'clean', 'clean', 'clean'] }]);
  assert.equal(meta.layout.scale, 4);
  assert.equal(meta.width, 6 * 2 + 4 * 128 + 3 * 4, 'four 32px frames at x4, gutters and edges');
  assert.deepEqual(pixelAt(img, 6, 6), GREEN, 'clean frames have a green bar');
  assert.match(text(clean), /Contact sheet of lt_seed_broker \(raw\), 4 frames at x4/);
  assert.match(text(clean), /row 1: idle south, frames 0,1,2,3/);
  assert.match(text(clean), /0 error pixel/);

  damage(p.root, 'idle_south_1', [{ x: 10, y: 12, kind: 'alpha' }]);
  const dirty = await call('studio_preview_render', { assetId: 'lt_seed_broker' });
  const d = decodeRgba(Buffer.from(dirty.content[1].data, 'base64'));
  assert.deepEqual(dirty.structuredContent.layout.rows[0].status, ['clean', 'error', 'clean', 'clean']);
  assert.equal(dirty.structuredContent.defects.errors, 1);
  assert.equal(dirty.structuredContent.defects.framesWithErrors, 1);
  const cellX = 6 + 1 * (128 + 4), top = 6 + 3 + 1;
  assert.deepEqual(pixelAt(d, cellX, 6), RED, 'the bar over the defective frame is red');
  assert.deepEqual(pixelAt(d, cellX + 10 * 4, top + 12 * 4), RED, 'the defective pixel is boxed (corner of its 4x4 block)');
  assert.deepEqual(pixelAt(d, 6, 6), GREEN, 'its neighbour is still green');
  assert.match(text(dirty), /1 error pixel/);

  const bare = decodeRgba(Buffer.from((await call('studio_preview_render', { assetId: 'lt_seed_broker', overlay: false })).content[1].data, 'base64'));
  assert.notDeepEqual(pixelAt(bare, cellX + 10 * 4, top + 12 * 4), RED, 'overlay=false draws no defect box');
  for (const x of [6, cellX]) assert.ok(![GREEN, RED, [255, 200, 0]].some((c) => JSON.stringify(c) === JSON.stringify(pixelAt(bare, x, 6))), 'overlay=false draws no status bar either');

  const two = await call('studio_preview_render', { assetId: 'lt_seed_broker', scale: 2, frame: 1 });
  assert.equal(two.structuredContent.frames, 1);
  assert.equal(two.structuredContent.width, 6 * 2 + 64);
}));

test('preview_render: processed frames, narrowing, size limit and plain errors', () => withProject(async (p) => {
  const { call } = connect(p.root);
  const all = await call('studio_preview_render', { assetId: 'lt_kiln_keeper' });
  assert.equal(all.structuredContent.stage, 'processed');
  assert.equal(all.structuredContent.layout.rows.length, 8, '2 clips x 4 directions');
  assert.equal(all.structuredContent.defects.errors, 0);
  assert.ok(all.structuredContent.bytes < 100000);
  const one = await call('studio_preview_render', { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'east' });
  assert.deepEqual(one.structuredContent.layout.rows.map((r) => `${r.clip}/${r.direction}`), ['idle/east']);
  assert.match(text(await call('studio_preview_render', { assetId: 'lt_kiln_keeper', clip: 'dance' })), /no processed frames matching/);
  assert.match(text(await call('studio_preview_render', { assetId: 'lt_seed_broker' })), /no processed frames/);
  assert.match(text(await call('studio_preview_render', { assetId: 'bgm_hengyue' })), /has no candidate yet/);
  assert.match(text(await call('studio_preview_render', { assetId: 'lt_kiln_keeper', scale: 9 })), /above maximum 8/);
}));

test('preview_render: a sheet that would be huge is refused with advice, not rendered', () => withProject(async (p) => {
  const { call } = connect(p.root);
  const r = await call('studio_preview_render', { assetId: 'wl_outer_disciple', scale: 8 });
  assert.equal(r.isError, true);
  assert.match(text(r), /contact sheet would be \d+x\d+; narrow it with clip, direction or frames/);
  const narrowed = await call('studio_preview_render', { assetId: 'wl_outer_disciple', scale: 8, clip: 'idle', direction: 'south' });
  assert.equal(narrowed.isError, undefined);
}, { git: false, extraDirs: ['assets/processed/players/wl_outer_disciple'] }));
