import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVENANCE, clipFrames, connect, makeFrame, makeProject } from './testkit.mjs';
import { staleReasons } from './workflow/evidence.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const RAW = 'assets/raw/longtime/lt_seed_broker/frames';
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const submit = (c) => c.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) });
// Damage `n` pixels (off-palette colours) of frame 1 on disk; a different variant is a different frame, so the content hash changes.
const damage = (root, n, variant) => writeFileSync(join(root, RAW, 'idle_south_1.png'), makeFrame(32, 32, { variant, damage: Array.from({ length: n }, (_, i) => ({ x: 8 + i, y: 12, kind: 'color' })) }).png);
const setPolicy = (p, stop) => { const f = join(p.root, 'studio.project.json'); const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (stop) d.policy = { stop }; else delete d.policy; fs.writeFileSync(f, JSON.stringify(d)); };

test('the real pack carries the policy numbers (3 fix rounds, 2 without progress)', () => {
  const pack = JSON.parse(fs.readFileSync(new URL('../../studio.project.json', import.meta.url), 'utf8'));
  assert.deepEqual(pack.policy.stop, { maxFixRounds: 3, noProgressRounds: 2 });
});

test('stop policy: two fix rounds in a row without progress stop the work, refuse more edits, and an escalation asks the human and starts a new cycle', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  await submit(a);
  damage(p.root, 3, 1);
  const r0 = (await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy;
  assert.deepEqual([r0.round, r0.decision, r0.progress], [0, 'continue', true], 'the first measurement is the baseline');
  assert.equal((await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy.repeated, true, 'measuring the same frames again is not a new round');
  damage(p.root, 3, 2);
  const r1 = (await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy;
  assert.deepEqual([r1.round, r1.decision, r1.progress], [1, 'continue', false]);
  damage(p.root, 3, 3);
  const r2 = (await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy;
  assert.deepEqual([r2.round, r2.decision, r2.reason], [2, 'stop', 'no-progress']);
  assert.match(r2.message, /2 fix rounds in a row without fewer errors or warnings.*studio_review_request.*without a passing check.*rather than regenerating/);
  assert.deepEqual(r2.history.map((h) => h.progress), [true, false, false]);
  // Every writing tool refuses now, and says so.
  const refused = await a.call('studio_frame_patch', { assetId: 'lt_seed_broker', target: 'revision', edits: [{ frame: 'idle_south_1', ops: [{ op: 'set', pixels: [[8, 12, 'ink_01']] }] }] });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /Stop policy: .*Nothing was changed/);
  assert.match(text(await a.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1, 32, 32, 9) })), /Stop policy/);
  assert.equal((await a.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1), dryRun: true })).isError, undefined, 'a dry run writes nothing, so it is allowed');
  // It is visible in asset_get, and a read-scope connection sees but never records.
  const seen = (await a.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).stopPolicy;
  assert.deepEqual([seen.stopped, seen.round, seen.history.length], ['no-progress', 2, 3]);
  // The escalation: allowed without a passing check or an independent check, recorded as such, and it ends the cycle.
  const esc = await a.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Stuck on the off-palette pixels in idle_south_1; how should it look?' });
  assert.equal(esc.isError, undefined, text(esc));
  assert.equal(esc.structuredContent.escalation, 'stop policy: no-progress');
  const listed = await a.ok('studio_review_list', { assetId: 'lt_seed_broker', detail: 'full' });
  assert.equal(listed.evidence.requests[0].escalation, 'stop policy: no-progress');
  assert.equal(listed.byStatus.pending, 4, 'a request, never a status');
  const after = await a.call('studio_frame_patch', { assetId: 'lt_seed_broker', target: 'revision', edits: [{ frame: 'idle_south_1', ops: [{ op: 'set', pixels: [[8, 12, 'ink_01']] }] }] });
  assert.doesNotMatch(text(after), /Stop policy/, 'a new cycle: edits are allowed again');
  const next = (await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy;
  assert.equal(next.round, 0, 'the count restarts');
}));

test('stop policy: the round limit stops even while progress is made; a clean result never stops; no policy in the pack means no limit', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  await submit(a);
  const run = async (n, v) => { damage(p.root, n, v); return (await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy; };
  assert.equal((await run(5, 1)).decision, 'continue');
  assert.deepEqual([(await run(4, 2)).progress, (await run(3, 3)).progress], [true, true]);
  const last = await run(2, 4);
  assert.deepEqual([last.round, last.progress, last.decision, last.reason], [3, true, 'stop', 'round-limit']);
  assert.match(last.message, /3 fix rounds \(the limit is 3\) and 2 error/);
  // A pass is never stopped, whatever the round number.
  setPolicy(p, { maxFixRounds: 1, noProgressRounds: 1 });
  await a.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'escalate' }).catch(() => {});
  fs.writeFileSync(join(p.root, RAW, 'idle_south_1.png'), clipFrames('idle', 'south', 4)[1] ? Buffer.from(clipFrames('idle', 'south', 4)[1].pngBase64, 'base64') : Buffer.alloc(0));
  assert.equal((await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy.decision, 'continue');
  // No policy: nothing is reported or enforced.
  setPolicy(p, null);
  damage(p.root, 3, 7);
  assert.equal((await a.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy, undefined);
}));

test('a read-scope connection sees the policy state but records nothing', () => withProject(async (p) => {
  const w = connect(p.root, { agent: 'codex' }), r = connect(p.root, { scope: 'read' });
  await submit(w);
  damage(p.root, 3, 1);
  assert.equal((await r.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy.round, 0);
  damage(p.root, 3, 2);
  assert.equal((await r.ok('studio_qa_run', { assetId: 'lt_seed_broker' })).stopPolicy.round, 0, 'the read connection computes a baseline each time; it never advances the count');
  assert.equal((await w.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).stopPolicy.history.length, 0);
}));

test('evidence expires: a check and a request are tied to frames, sheets and the contact sheet; changing any makes them stale, visibly', () => withProject(async (p) => {
  const author = connect(p.root, { agent: 'codex' }), checker = connect(p.root, { agent: 'claude' });
  await submit(author);
  // The checker looks at the contact sheet, then records an independent check: the evidence carries the frames hash and that picture.
  const look = await checker.ok('studio_preview_render', { assetId: 'lt_seed_broker' });
  assert.match(look.looked.image, /^[0-9a-f]{12}$/);
  assert.equal((await checker.ok('studio_qa_run', { assetId: 'lt_seed_broker', independent: true })).recorded.independent, true);
  const checks = (await checker.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).checks;
  assert.equal(checks[0].current, true);
  assert.match(checks[0].evidence.frames, /^[0-9a-f]{64}$/);
  assert.equal(checks[0].evidence.contact.frames, checks[0].evidence.frames, 'the contact sheet was of exactly these frames');
  const req = await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'ready' });
  assert.equal(req.isError, undefined, text(req));
  const listed = await author.ok('studio_review_list', { assetId: 'lt_seed_broker' });
  assert.equal(listed.evidence.requests[0].current, true);
  // The frames change: the check and the request go stale, and both say why.
  damage(p.root, 1, 5);
  const stale = (await checker.ok('studio_asset_get', { assetId: 'lt_seed_broker', sections: ['checks'] })).checks[0];
  assert.deepEqual([stale.current, stale.stale[0].what], [false, 'frames']);
  const after = await author.ok('studio_review_list', { assetId: 'lt_seed_broker' });
  assert.deepEqual([after.evidence.requests[0].current, after.evidence.requests[0].stale.map((s) => s.what)], [false, ['frames', 'contact sheet'].slice(0, after.evidence.requests[0].stale.length)]);
}));

test('staleReasons: sheets and the contact sheet are compared too', () => {
  const rec = { frames: 'f1', sheets: { rig: 'aaaa', pose: 'bbbb' }, contact: { image: 'i', frames: 'f1' } };
  assert.deepEqual(staleReasons(rec, { frames: 'f1', sheets: { rig: 'aaaa', pose: 'bbbb' } }), []);
  assert.deepEqual(staleReasons(rec, { frames: 'f1', sheets: { rig: 'aaaa', pose: 'cccc' } }).map((s) => s.what), ['pose sheet']);
  assert.deepEqual(staleReasons(rec, { frames: 'f1', sheets: { rig: 'aaaa' } }).map((s) => s.what), ['pose sheet'], 'a removed sheet is a change');
  assert.deepEqual(staleReasons(rec, { frames: 'f2', sheets: { rig: 'aaaa', pose: 'bbbb' } }).map((s) => s.what), ['frames', 'contact sheet']);
  assert.deepEqual(staleReasons(null, { frames: 'x' }), [], 'legacy evidence is judged on frames by the caller');
});
