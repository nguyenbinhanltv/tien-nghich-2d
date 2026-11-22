import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envelopeProblems } from './workflow/envelope.mjs';
import { openProject } from './project.mjs';
import { JobRunner } from '../core/jobs.mjs';
import { PROVENANCE, REPO, clipFrames, connect, makeProject } from './testkit.mjs';
import { loadPack } from '../core/pack.mjs';
import { loadAssetIndex } from './asset-index.mjs';
import { runMotion } from '../core/motion-qa.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const EV = [{ frame: 'idle_south_0', region: { x: 2, y: 2, w: 8, h: 8 } }];
const rows = (over = {}) => ['silhouette', 'perspective', 'identity', 'proportion', 'palette_light', 'motion'].map((id) => ({ id, observation: `looked at ${id}`, result: 'pass', confidence: 0.9, evidence: EV, ...(over[id] ?? {}) }));

test('MCP-011: studio_diff motion=true measures a shipped clip: bounds per frame, a pair per neighbour, no history needed', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'claude-code' });
  const r = await a.ok('studio_diff', { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'south', motion: true });
  const clip = r.motion.clips[0];
  assert.deepEqual([clip.clip, clip.direction, clip.frames], ['idle', 'south', 4]);
  assert.equal(clip.bounds.length, 4);
  assert.equal(clip.pairs.length, 3, 'a clip with no loop contract has no seam pair');
  for (const pair of clip.pairs) assert.ok(Number.isInteger(pair.changedPixels) && pair.changedPixels > 0 && pair.box.w > 0);
  assert.deepEqual(r.motion.thresholds.tell, { minMs: 200, minFrames: 2 });
  assert.equal(r.summary.noHistory, 4, 'the revision comparison still runs');
  // Without the flag nothing is added.
  assert.equal((await a.ok('studio_diff', { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'south' })).motion, undefined);
}));

test('MCP-011: studio_diff onion=true returns one picture of the clip and needs clip and direction', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'claude-code' });
  assert.match(text(await a.call('studio_diff', { assetId: 'lt_kiln_keeper', onion: true })), /needs clip and direction/);
  const r = await a.call('studio_diff', { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'south', onion: true });
  assert.ok(!r.isError, text(r));
  const img = r.content.find((c) => c.type === 'image');
  assert.equal(img.mimeType, 'image/png');
  assert.equal(Buffer.from(img.data, 'base64').subarray(1, 4).toString(), 'PNG');
  assert.deepEqual(r.structuredContent.motion.onion.panels, [0, 1, 2, 3]);
  // One frame is no clip.
  assert.match(text(await a.call('studio_diff', { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'south', frame: 1, onion: true })), /whole clip: leave out frame/);
}));

test('MCP-011: studio_qa_run carries the motion check with value and thresholds in the one envelope; a single frame leaves it unproven', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'claude-code' });
  const r = await a.ok('studio_qa_run', { assetId: 'lt_kiln_keeper', detail: 'frames' });
  assert.deepEqual(envelopeProblems(r.qa), []);
  const m = r.qa.checks.find((c) => c.name === 'motion');
  assert.ok(m && m.measured.clips >= 4 && m.threshold.cadence.ratio > 0, JSON.stringify(m));
  assert.ok(r.motion.clips.every((c) => c.bounds && c.pairs), 'detail=frames adds the measures');
  const one = await a.ok('studio_qa_run', { assetId: 'lt_kiln_keeper', clip: 'idle', direction: 'south', frame: 0 });
  assert.equal(one.qa.checks.some((c) => c.name === 'motion'), false);
  assert.ok(one.qa.notProven.some((n) => /motion measures and lint/.test(n.what) && /single frame/.test(n.why)));
}));

test('MCP-012: a declared contract (loopPolicy, tell/hit events) is what the lint judges; a bad loopPolicy is refused', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) });
  const asset = await a.ok('studio_asset_get', { assetId: 'lt_seed_broker' });
  const bad = await a.call('studio_metadata_set', { assetId: 'lt_seed_broker', clips: { idle: { loopPolicy: 'forever' } }, ...(asset.metadata?.etag ? { etag: asset.metadata.etag } : {}) });
  assert.equal(bad.isError ?? Boolean(bad.rpcError), true);
  const set = await a.ok('studio_metadata_set', { assetId: 'lt_seed_broker', clips: { idle: { loopPolicy: 'loop', frameMs: [160, 160, 160, 160], events: [{ frame: 0, name: 'tell' }, { frame: 2, name: 'hit' }] } } });
  assert.ok(set.ok ?? true);
  const r = await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', stage: 'raw', detail: 'frames' });
  const clip = r.motion.clips.find((c) => c.clip === 'idle' && c.direction === 'south');
  assert.equal(clip.loopPolicy, 'loop');
  assert.deepEqual(clip.events, [{ frame: 0, name: 'tell' }, { frame: 2, name: 'hit' }]);
  assert.equal(clip.pairs.at(-1).seam, true, 'a looping clip gets its seam measured');
  // 2 frames of 160 ms = 320 ms: readable. Shorten the timing and the same clip is flagged, with the numbers.
  await a.ok('studio_metadata_set', { assetId: 'lt_seed_broker', clips: { idle: { frameMs: [60, 60, 60, 60] } }, etag: (await a.ok('studio_asset_get', { assetId: 'lt_seed_broker' })).metadata.etag });
  const again = await a.ok('studio_qa_run', { assetId: 'lt_seed_broker', stage: 'raw', detail: 'frames' });
  const f = again.motion.clips.find((c) => c.clip === 'idle' && c.direction === 'south').findings.find((x) => x.code === 'tell_too_short');
  assert.deepEqual([f.measured, f.threshold, f.unit], [120, 200, 'ms']);
  assert.notEqual(again.qa.status, 'fail', 'lint findings are warnings, never failures');
}));

test('MCP-013: studio_project_info hands out the rubric and the lint thresholds', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'claude-code' });
  const info = await a.ok('studio_project_info', { sections: ['rubric', 'motion'] });
  assert.ok(info.rubric.criteria.length >= 4 && info.rubric.criteria.every((c) => c.id && c.expectation && c.label.en && c.label.vi));
  assert.ok(info.rubric.criteria.some((c) => c.mandatory) && info.rubric.criteria.some((c) => !c.mandatory));
  assert.equal(info.motion.roles.telegraph, 'tell');
  assert.ok(info.motion.lint.nearDuplicate.ratio > 0);
}));

test('MCP-013: the rubric in studio_qa_run: unknown is never a pass; a failed mandatory criterion fails its check whatever else passed; it never touches the gate verdict', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'claude-code' });
  const good = await a.ok('studio_qa_run', { assetId: 'lt_kiln_keeper', rubric: rows() });
  assert.equal(good.rubric.status, 'pass');
  assert.equal(good.qa.checks.find((c) => c.name === 'rubric').status, 'pass');
  const unknown = await a.ok('studio_qa_run', { assetId: 'lt_kiln_keeper', rubric: rows({ identity: { result: 'unknown' }, motion: { confidence: 0.2 } }) });
  assert.equal(unknown.rubric.status, 'partial');
  assert.equal(unknown.qa.checks.find((c) => c.name === 'rubric').status, 'warn');
  assert.ok(unknown.qa.notProven.some((n) => /rubric: 2 criterion/.test(n.what)));
  assert.notEqual(unknown.qa.status, 'pass');
  const failed = await a.ok('studio_qa_run', { assetId: 'lt_kiln_keeper', rubric: rows({ silhouette: { result: 'fail', observation: 'legs vanish' } }) });
  assert.equal(failed.rubric.status, 'fail');
  assert.equal(failed.qa.status, 'fail');
  assert.equal(failed.pass, good.pass, 'the pixel gates decide pass; the rubric is evidence');
  assert.match(failed.rubric.note, /not an approval/);
}));

test('MCP-013: studio_review_request shows the rubric beside the art, refuses a failed mandatory criterion, and records no decision', () => withProject(async (p) => {
  const project = openProject(p.root);
  const jobs = new JobRunner();
  const author = connect(project, { agent: 'codex', jobs }), checker = connect(project, { agent: 'claude-code', jobs });
  await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) });
  await checker.ok('studio_qa_run', { assetId: 'lt_seed_broker', independent: true });
  const refused = await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please look.', rubric: rows({ perspective: { result: 'fail' } }) });
  assert.equal(refused.isError, true);
  assert.match(text(refused), /fails mandatory criterion perspective/);
  assert.match(text(refused), /does not offset/);
  const dry = await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please look.', rubric: rows({ motion: { result: 'unknown' } }), dryRun: true });
  assert.match(dry.comment, /Agent rubric \(partial; evidence, not an approval/);
  assert.match(dry.comment, /PASS \*Silhouette reads at native size/);
  assert.match(dry.comment, /\? Motion reads and loops cleanly/);
  assert.match(dry.comment, /\[idle_south_0 2,2 8x8\]/);
  const sent = await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please look.', rubric: rows() });
  assert.match(sent.status, /only a human decides/);
  assert.match(text(await author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'x', rubric: [{ id: 'silhouette', result: 'pass' }] })), /^(?!.*approved)/s);
}));

test('MCP-012: calibration: on the approved roster the lint flags a minority of assets and characters, and never raises an error', async () => {
  const root = REPO;
  const loaded = await loadPack(root);
  const pack = loaded.pack ?? loaded;
  const index = await loadAssetIndex(pack, root);
  const people = new Set(['player', 'mob', 'boss', 'pet', 'npc']);
  const seen = { assets: 0, flagged: 0, people: 0, peopleFlagged: 0 };
  for (const asset of index.assets.values()) {
    if (!asset.clips || !asset.layout || asset.layout.nameStyle === 'palette') continue;
    const r = await runMotion({ root, pack, asset, stage: 'processed', metadata: null });
    if (!r.clips.length) continue;
    seen.assets++; if (r.findings.length) seen.flagged++;
    if (people.has(asset.category)) { seen.people++; if (r.findings.length) seen.peopleFlagged++; }
    for (const f of r.findings) assert.equal(f.severity, 'warn');
  }
  assert.ok(seen.assets > 100 && seen.people > 40, JSON.stringify(seen));
  assert.ok(seen.flagged / seen.assets < 0.35, `lint flags ${seen.flagged} of ${seen.assets} assets`);
  assert.ok(seen.peopleFlagged / seen.people < 0.5, `lint flags ${seen.peopleFlagged} of ${seen.people} characters`);
});
