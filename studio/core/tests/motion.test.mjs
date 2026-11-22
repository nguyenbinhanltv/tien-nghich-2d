import test from 'node:test';
import assert from 'node:assert/strict';
import { changedBetween, components, detachedPieces, measureClip, onionSkin, onionStrip, opaqueBounds } from '../motion.mjs';
import { clipContract, defaultLint, durationMs, lintClip, lintThresholds } from '../clips.mjs';
import { criteriaOf, evaluateRubric, rubricText } from '../rubric.mjs';
import { decodeRgba } from '../png.mjs';

const frame = (w, h, boxes = [], color = [200, 40, 40]) => {
  const pixels = Buffer.alloc(w * h * 4);
  for (const [x0, y0, x1, y1] of boxes) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixels.set([...color, 255], (y * w + x) * 4);
  return { width: w, height: h, pixels };
};

test('MCP-011: opaque bounds, changed pixels and box of a pair, the loop seam', () => {
  const a = frame(16, 16, [[4, 4, 7, 9]]), b = frame(16, 16, [[5, 4, 8, 9]]);
  assert.deepEqual(opaqueBounds(a), { x: 4, y: 4, w: 4, h: 6, pixels: 24 });
  assert.deepEqual(opaqueBounds(frame(4, 4)), { x: 0, y: 0, w: 0, h: 0, pixels: 0 });
  const d = changedBetween(a, b);
  assert.equal(d.changedPixels, 12);                                  // one column leaves, one arrives
  assert.deepEqual(d.box, { x: 4, y: 4, w: 5, h: 6 });
  assert.equal(changedBetween(a, a).changedPixels, 0);
  assert.equal(changedBetween(a, frame(8, 8)).sizeChanged, true);
  const m = measureClip([a, b, a], { loop: true });
  assert.equal(m.pairs.length, 3);
  assert.deepEqual(m.pairs.map((p) => [p.from, p.to, p.seam ?? false]), [[0, 1, false], [1, 2, false], [2, 0, true]]);
  assert.equal(m.pairs[2].changedPixels, 0);
  assert.equal(measureClip([a, b]).pairs.length, 1, 'no seam unless the clip loops');
});

test('MCP-011: orphan pixels and detached fragments; the body and design-sized pieces are not reported', () => {
  const img = frame(32, 32, [[8, 8, 20, 24], [28, 2, 28, 2], [2, 28, 3, 29], [28, 28, 31, 31]]);
  assert.deepEqual(components(img).map((g) => g.pixels), [13 * 17, 16, 4, 1]);
  const d = detachedPieces(img, { orphanMaxPx: 1, fragmentMaxPx: 4 });
  assert.deepEqual(d.orphans.map((o) => [o.x, o.y]), [[28, 2]]);
  assert.deepEqual(d.fragments.map((o) => [o.x, o.y, o.pixels]), [[2, 28, 4]]);
  assert.equal(frame(8, 8, [[0, 0, 1, 1], [2, 2, 3, 3]]).pixels.length, 256);
  assert.equal(components(frame(8, 8, [[0, 0, 1, 1], [2, 2, 3, 3]])).length, 1, 'touching diagonally is one group');
});

test('MCP-011: the onion skin tints neighbours and keeps the current frame in its own colours; the strip has a panel per frame', () => {
  const a = frame(8, 8, [[1, 1, 2, 2]], [10, 200, 10]), b = frame(8, 8, [[5, 5, 6, 6]], [200, 10, 10]);
  const o = onionSkin([a, b], { current: 1, before: 1, after: 0, scale: 1, background: [100, 100, 100] });
  const at = (x, y) => [...o.pixels.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  assert.deepEqual(at(5, 5), [200, 10, 10], 'current frame untinted');
  assert.notDeepEqual(at(1, 1), [100, 100, 100], 'the earlier frame shows as a ghost');
  assert.ok(at(1, 1)[0] > at(1, 1)[2] - 1 && at(1, 1)[0] > 100, 'earlier frames lean red');
  assert.deepEqual(at(7, 0), [100, 100, 100]);
  const big = onionSkin([a, b], { current: 0, scale: 3 });
  assert.equal(big.width, 24);
  const strip = onionStrip([a, b, a, b], { scale: 2 });
  assert.deepEqual(strip.panels, [0, 1, 2, 3]);
  const png = decodeRgba(strip.png);
  assert.equal(png.width, 16 * 4 + 2 * 3);
  assert.throws(() => onionSkin([]), /at least one/);
});

const T = lintThresholds({});
test('MCP-012: thresholds come from the pack and fall back to the studio defaults', () => {
  assert.deepEqual(T.tell, defaultLint.tell);
  const t = lintThresholds({ motion: { lint: { tell: { minMs: 500 }, cadence: { ratio: 9 } } } });
  assert.equal(t.tell.minMs, 500);
  assert.equal(t.tell.minFrames, defaultLint.tell.minFrames);
  assert.equal(t.cadence.ratio, 9);
  assert.equal(t.cadence.floorPx, defaultLint.cadence.floorPx);
});

test('MCP-012: a telegraph too short to read is flagged with its duration and limit; a long one passes; missing timing is not proven', () => {
  const imgs = [0, 1, 2, 3].map((i) => frame(32, 32, [[4 + i * 3, 6, 15 + i * 3, 25]]));
  const contract = clipContract({ asset: { clips: { windup: { frames: 4 } } }, clip: 'windup', declared: { events: [{ frame: 0, name: 'tell' }, { frame: 2, name: 'hit' }] } });
  const short = lintClip({ images: imgs, frameMs: 80, contract, thresholds: T });
  const f = short.findings.find((x) => x.code === 'tell_too_short');
  assert.ok(f, JSON.stringify(short.findings));
  assert.deepEqual([f.measured, f.threshold, f.unit], [160, 200, 'ms']);
  const long = clipContract({ asset: { clips: { windup: { frames: 4 } } }, clip: 'windup', declared: { events: [{ frame: 0, name: 'tell' }, { frame: 3, name: 'hit' }] } });
  assert.equal(lintClip({ images: imgs, frameMs: [100, 100, 100, 100], contract: long, thresholds: T }).findings.some((x) => x.code === 'tell_too_short'), false);
  const untimed = lintClip({ images: imgs, frameMs: undefined, contract: long, thresholds: T });
  assert.ok(untimed.notProven.some((n) => /milliseconds/.test(n.what)));
  const oneFrame = clipContract({ asset: { clips: { windup: { frames: 4 } } }, clip: 'windup', declared: { events: [{ frame: 2, name: 'tell' }, { frame: 3, name: 'hit' }] } });
  assert.equal(lintClip({ images: imgs, frameMs: 300, contract: oneFrame, thresholds: T }).findings.find((x) => x.code === 'tell_too_short').unit, 'frames');
  assert.equal(durationMs([10, 20, 30], 1, 3), 50);
  assert.equal(durationMs(undefined, 0, 2), null);
});

test('MCP-012: a role in the pack makes a whole clip a tell; declared events beat it; a hit before its tell is flagged', () => {
  const pack = { motion: { roles: { telegraph: 'tell' } } };
  const asset = { clips: { telegraph: { frames: 3, loop: false } } };
  const c = clipContract({ asset, clip: 'telegraph', pack });
  assert.deepEqual([c.events, c.eventsSource, c.loopPolicy, c.loopSource], [[{ frame: 0, name: 'tell' }], 'pack role', 'once', 'manifest']);
  const d = clipContract({ asset, clip: 'telegraph', pack, declared: { loopPolicy: 'hold', events: [{ frame: 2, name: 'hit' }, { frame: 1, name: 'tell' }] } });
  assert.deepEqual([d.loopPolicy, d.eventsSource, d.loopSource], ['hold', 'declared', 'declared']);
  const imgs = [0, 1, 2].map((i) => frame(32, 32, [[4 + i * 3, 6, 15 + i * 3, 25]]));
  const r = lintClip({ images: imgs, frameMs: 160, contract: { ...d, events: [{ frame: 1, name: 'hit' }, { frame: 2, name: 'tell' }] }, thresholds: T });
  assert.ok(r.findings.some((x) => x.code === 'hit_before_tell'));
  assert.ok(lintClip({ images: imgs, frameMs: 160, contract: { loopPolicy: null, events: [{ frame: 9, name: 'step' }] }, thresholds: T }).findings.some((x) => x.code === 'event_out_of_range'));
  assert.ok(!lintClip({ images: imgs, frameMs: 160, contract: c, thresholds: T }).findings.some((x) => x.code === 'tell_too_short'), '3 x 160 ms reads');
});

test('MCP-012: near-duplicate held frames, uneven cadence and lone pixels are flagged; effects are measured but not linted', () => {
  const body = (dx) => [[4 + dx, 6, 15 + dx, 25]];
  const none = { loopPolicy: 'loop', events: [] };
  const dup = lintClip({ images: [frame(32, 32, body(0)), frame(32, 32, body(0)), frame(32, 32, body(4))], frameMs: 100, contract: none, thresholds: T });
  const nd = dup.findings.find((x) => x.code === 'near_duplicate');
  assert.deepEqual([nd.frames, nd.measured], [[0, 1], 0]);
  assert.ok(nd.threshold >= T.nearDuplicate.minPx);
  const steady = [0, 2, 4, 6, 8].map((d) => frame(32, 32, body(d)));
  assert.equal(lintClip({ images: steady, frameMs: 100, contract: { loopPolicy: 'once', events: [] }, thresholds: T }).findings.filter((x) => x.code === 'uneven_cadence').length, 0);
  const jump = [0, 1, 2, 3, 15].map((d) => frame(32, 32, d === 15 ? [[16, 6, 27, 25]] : body(d)));
  const uj = lintClip({ images: jump, frameMs: 100, contract: { loopPolicy: 'once', events: [] }, thresholds: T }).findings.find((x) => x.code === 'uneven_cadence');
  assert.ok(uj && uj.measured > uj.threshold, JSON.stringify(uj));
  const lone = lintClip({ images: [frame(32, 32, [...body(0), [30, 1, 30, 1]]), frame(32, 32, body(5))], frameMs: 100, contract: none, thresholds: T });
  assert.deepEqual(lone.findings.filter((x) => x.code === 'orphan_pixel').map((x) => [x.frame, x.at]), [[0, [30, 1]]]);
  const fx = lintClip({ images: [frame(32, 32, [...body(0), [30, 1, 30, 1]]), frame(32, 32, body(0))], frameMs: 100, contract: none, thresholds: T, figure: false });
  assert.deepEqual(fx.findings, []);
  assert.equal(fx.measure.pairs.length, 2, 'measured all the same');
  assert.ok(lintClip({ images: [frame(8, 8, [[1, 1, 3, 3]])], frameMs: 100, contract: none, thresholds: T }).notProven.length, 'one frame cannot show motion');
});

const pack = {
  rubric: { minConfidence: 0.5, criteria: [
    { id: 'silhouette', mandatory: true, label: { en: 'Silhouette', vi: 'Hình bóng' }, expectation: 'The figure reads at native size.' },
    { id: 'identity', mandatory: true, label: { en: 'Identity' }, expectation: 'The named marks are there.' },
    { id: 'motion', mandatory: false, label: { en: 'Motion' }, expectation: 'The clip reads at game speed.' },
  ] },
};
const ev = [{ frame: 'idle_south_0', region: { x: 1, y: 2, w: 3, h: 4 } }];
const row = (id, result, extra = {}) => ({ id, observation: `saw ${id}`, result, confidence: 0.9, evidence: ev, ...extra });

test('MCP-013: criteria come from the pack; a pack without a rubric says so', () => {
  assert.equal(criteriaOf(pack).length, 3);
  assert.equal(evaluateRubric({}, []).status, 'none');
  const e = evaluateRubric(pack, [row('silhouette', 'pass'), row('identity', 'pass'), row('motion', 'pass')]);
  assert.equal(e.status, 'pass');
  assert.equal(e.criteria[0].expectation, 'The figure reads at native size.');
  assert.match(e.note, /not an approval/);
  assert.match(rubricText(e), /^Agent rubric \(pass; evidence, not an approval/);
  assert.match(rubricText(e, 'vi'), /Hình bóng/);
});

test('MCP-013: unknown is never a pass: not assessed, low confidence, no evidence, no confidence, a bad row', () => {
  const e = evaluateRubric(pack, [row('silhouette', 'pass', { confidence: 0.3 }), row('identity', 'pass', { evidence: [] })]);
  assert.deepEqual(e.criteria.map((c) => c.result), ['unknown', 'unknown', 'unknown']);
  assert.equal(e.criteria[0].claimed, 'pass');
  assert.match(e.criteria[0].why, /below/);
  assert.match(e.criteria[1].why, /evidence/);
  assert.equal(e.criteria[2].why, 'not assessed');
  assert.equal(e.status, 'partial');
  assert.deepEqual(e.unknownMandatory, ['silhouette', 'identity']);
  assert.equal(evaluateRubric(pack, [row('silhouette', 'pass', { confidence: undefined })]).criteria[0].result, 'unknown');
  assert.equal(evaluateRubric(pack, [row('silhouette', 'pass', { result: 'great' })]).criteria[0].result, 'unknown');
  assert.equal(evaluateRubric(pack, [row('silhouette', 'pass', { evidence: [{ note: 'no place' }] })]).criteria[0].result, 'unknown');
  assert.ok(evaluateRubric(pack, [row('nope', 'pass')]).issues.some((i) => /not a criterion/.test(i)));
  assert.ok(evaluateRubric(pack, [row('silhouette', 'pass'), row('silhouette', 'fail')]).issues.some((i) => /twice/.test(i)));
  assert.equal(evaluateRubric(pack, [row('silhouette', 'unknown')]).counts.pass, 0);
});

test('MCP-013: a failed mandatory criterion cannot be offset by passes elsewhere; an optional failure only makes it partial', () => {
  const fail = evaluateRubric(pack, [row('silhouette', 'fail'), row('identity', 'pass'), row('motion', 'pass')]);
  assert.deepEqual([fail.status, fail.failedMandatory], ['fail', ['silhouette']]);
  const optional = evaluateRubric(pack, [row('silhouette', 'pass'), row('identity', 'pass'), row('motion', 'fail')]);
  assert.equal(optional.status, 'partial');
  assert.deepEqual(optional.failedMandatory, []);
});
