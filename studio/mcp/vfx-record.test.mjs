// The VFX recorder (F8): first frame, last frame, skip and columns for the exported sheet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { createImage, decodePng, setPixel } from '../forge/index.mjs';
import { composeSheet, describeRecord, recordedDurations, recordedEvents, resolveRecord } from './workflow/vfx-record.mjs';
import { HAVE_SPRITEFX, REPO, connect, makeProject } from './testkit.mjs';

test('VFX-002 resolveRecord: defaults keep everything in one row; first, last, skip and columns are checked', () => {
  const all = resolveRecord(undefined, 12);
  assert.deepEqual([all.first, all.last, all.skip, all.columns, all.rows, all.indices.length], [0, 11, 0, 12, 1, 12]);
  const r = resolveRecord({ first: 2, last: 10, skip: 1, columns: 3 }, 12);
  assert.deepEqual(r.indices, [2, 4, 6, 8, 10]);
  assert.deepEqual([r.columns, r.rows], [3, 2]);
  assert.deepEqual(resolveRecord({ first: 4, last: 4 }, 12).indices, [4]);
  assert.match(describeRecord(r, 12), /frames 2\.\.10 of 12, skip 1 \(5 kept: 2,4,6,8,10\), 3 column\(s\) x 2 row\(s\)/);
  for (const [bad, why] of [[{ first: 12 }, /record\.first/], [{ first: 5, last: 4 }, /record\.last/], [{ last: 12 }, /record\.last/], [{ skip: -1 }, /record\.skip/], [{ columns: 0 }, /record\.columns/],
    [{ columns: 13 }, /record\.columns/], [{ first: 1.5 }, /whole number/], [{ stride: 2 }, /no setting "stride"/], [[], /must be an object/]]) assert.throws(() => resolveRecord(bad, 12), why);
  assert.throws(() => resolveRecord({}, 0), /no frames/);
});

test('VFX-002 recorded durations keep the clip length and events move to the kept frame that shows them', () => {
  const durations = Array(12).fill(33);
  const r = resolveRecord({ first: 2, last: 10, skip: 1 }, 12);
  const kept = recordedDurations(durations, r);
  assert.deepEqual(kept, [66, 66, 66, 66, 33 + 0], 'each kept frame carries the frame left out after it; the last one ends at "last"');
  assert.equal(kept.reduce((a, b) => a + b, 0), 9 * 33, 'the total is the time from first to last');
  const events = recordedEvents([{ id: 'hit', frame: 6 }, { id: 'early', frame: 0 }, { id: 'late', frame: 11 }, { id: 'loose' }], r);
  assert.deepEqual(events, [{ id: 'hit', frame: 2 }, { id: 'loose' }]);
});

test('VFX-002 composeSheet lays the frames out columns to a row, byte for byte the same every time', () => {
  const frames = Array.from({ length: 5 }, (_, i) => { const f = createImage(4, 3); setPixel(f, i % 4, 0, [i * 40, 10, 20]); return f; });
  const s = composeSheet(frames, 3);
  assert.deepEqual([s.width, s.height], [12, 6]);
  assert.deepEqual(s.cells[4], { x: 4, y: 3, w: 4, h: 3 });
  assert.equal(composeSheet(frames, 3).sha256, s.sha256);
  assert.notEqual(composeSheet(frames, 5).sha256, s.sha256);
  const back = decodePng(s.png);
  assert.deepEqual([...back.pixels.subarray(((3) * 12 + 4 + 0) * 4, ((3) * 12 + 4 + 1) * 4)], [160, 10, 20, 255]);
  assert.throws(() => composeSheet([], 1), /no frames/);
  assert.throws(() => composeSheet([createImage(2, 2), createImage(3, 2)], 2), /differ in size/);
});

const skipFx = HAVE_SPRITEFX ? false : 'the SpriteFX environment is not available';
const FX = 'lt_fx_test_spark';
const spec = () => JSON.parse(fs.readFileSync(join(REPO, 'tools/generators/vfx_specs/hit_spark.json'), 'utf8')); // 12 ticks, 32x32
const planFx = (a, frames) => a.call('studio_asset_plan', { op: 'create', id: FX, chunk: 'wards', brief: 'A test spark.', custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { play: { frames, frameMs: 33 } } } });
const text = (r) => r.content?.[0]?.text ?? '';

test('VFX-002 studio_vfx_build record: the kept frames are the clip, the cut and the recorded sheet hash go into provenance', { skip: skipFx }, async () => {
  const p = makeProject({ git: false, toolchain: true });
  try {
    const a = connect(p.root, { agent: 'codex' });
    await planFx(a, 6);
    const record = { first: 0, last: 10, skip: 1, columns: 3 };
    const dry = await a.call('studio_vfx_build', { assetId: FX, spec: spec(), record, dryRun: true });
    assert.equal(dry.isError, undefined, text(dry));
    const s = dry.structuredContent;
    assert.equal(s.frameTable.count, 6);
    assert.deepEqual(s.record.kept, [0, 2, 4, 6, 8, 10]);
    assert.deepEqual([s.record.columns, s.record.rows, s.record.sheet.width, s.record.sheet.height], [3, 2, 96, 64]);
    assert.match(s.record.sheet.sha256, /^[0-9a-f]{64}$/);
    assert.equal(s.frameTable.durationsMs.length, 6);
    // the same cut twice gives the same recorded sheet; another cut does not
    const again = await a.call('studio_vfx_build', { assetId: FX, spec: spec(), record, dryRun: true });
    assert.equal(again.structuredContent.record.sheet.sha256, s.record.sheet.sha256);
    // a cut that does not match the clip is explained, not committed
    const wrong = await a.call('studio_vfx_build', { assetId: FX, spec: spec(), record: { first: 0, last: 10, skip: 0 }, submit: true });
    assert.equal(wrong.isError, true);
    assert.match(text(wrong) + JSON.stringify(wrong.structuredContent), /the recorder keeps 11 of the 12 rendered frames/);
    const bad = await a.call('studio_vfx_build', { assetId: FX, spec: spec(), record: { first: 20 } });
    assert.match(text(bad), /record\.first/);
    const sub = await a.call('studio_vfx_build', { assetId: FX, spec: spec(), record, submit: true });
    assert.equal(sub.isError, undefined, text(sub));
    assert.equal(sub.structuredContent.submit.written.length, 6);
    const log = fs.readFileSync(join(p.root, 'assets/raw/longtime', FX, 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)[0];
    assert.match(log.notes, /recorded frames 0\.\.10 of 12, skip 1 \(6 kept: 0,2,4,6,8,10\), 3 column\(s\) x 2 row\(s\); recorded sheet [0-9a-f]{64}/);
    assert.ok(log.notes.includes(s.record.sheet.sha256));
  } finally { await p.cleanup(); }
});
