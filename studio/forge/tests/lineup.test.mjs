import test from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../image.mjs';
import { BODY, INK, figure } from './lineup-fixture.mjs';
import { ghostFigure, judgeLineup, lineupMessages, lineupNumbers, medianMeasure, outlineWeight, referenceMeasure, renderLineup, standingMeasure, trimFigure } from '../figure/lineup.mjs';
import { renderTemplate } from '../sheet/template.mjs';
import { turnaroundLayout } from '../sheet/layout.mjs';

test('CHARACTERS-028: the outline weight is the mean inward run of outline pixels: 1 for a one-pixel outline, 2 for a two-pixel one', () => {
  assert.ok(Math.abs(outlineWeight(figure({ ow: 1 }), INK) - 1) < 0.2);
  const two = outlineWeight(figure({ ow: 2 }), INK);
  assert.ok(two > 1.5, `a two-pixel outline weighs more than a one-pixel one: ${two}`);
  assert.equal(outlineWeight(createImage(8, 8), INK), null);
});

test('CHARACTERS-028: a standing figure is measured: height, head share (where a neck shows), limb width, outline weight; the median of a pose', () => {
  const m = standingMeasure(figure(), INK);
  assert.equal(m.height, 27);
  assert.ok(Math.abs(m.headShare - 10 / 27) < 0.001, String(m.headShare));
  assert.equal(m.limbWidth, 4);
  const pose = medianMeasure([figure(), figure(), figure({ head: 9, body: 12 })], INK);
  assert.equal(pose.height, 27);
  assert.equal(standingMeasure(createImage(8, 8, [0, 0, 0, 0]), INK).height, 0);
  const ref = referenceMeasure([standingMeasure(figure(), INK), standingMeasure(figure({ head: 12, body: 9 }), INK), standingMeasure(figure({ head: 11, body: 10 }), INK)]);
  assert.equal(ref.height, 27);
});

const spec = {
  tolerance: { heightRatio: { min: 0.5, max: 1.15 }, headShareDelta: { max: 0.3 }, limbWidthRatio: { min: 0.15, max: 5 }, outlineWeightDelta: { max: 4 } },
  typical: { heightRatio: { min: 0.6, max: 1.05 }, headShareDelta: { max: 0.15 }, limbWidthRatio: { min: 0.5, max: 3.5 }, outlineWeightDelta: { max: 0.8 } },
};
const ref = medianMeasure([figure()], INK);
const judge = (over) => judgeLineup({ figure: medianMeasure([figure(over)], INK), reference: ref, spec });

test('CHARACTERS-029: the same build passes; a figure far too small is blocked with the numbers; a small deviation only warns', () => {
  const same = judge({});
  assert.equal(same.status, 'pass');
  assert.deepEqual(same.rows.map((r) => r.metric), ['heightRatio', 'headShareDelta', 'limbWidthRatio', 'outlineWeightDelta']);
  const small = judge({ head: 3, headW: 6, neck: 1, body: 3, leg: 3 });
  assert.equal(small.status, 'fail');
  const row = small.rows.find((r) => r.metric === 'heightRatio');
  assert.deepEqual([row.status, row.figure, row.reference, row.block], ['fail', 10, 27, { min: 0.5, max: 1.15 }]);
  assert.ok(row.measured < 0.5);
  assert.match(lineupMessages(small, 'the keeper').join(' '), /BLOCKED: height is 37% of the keeper's \(10 px against 27\); allowed 0\.5 to 1\.15/);
  const warn = judge({ leg: 9, body: 7, legW: 15, gap: 2 });                    // chunkier legs: inside the tolerance, outside the typical band
  assert.equal(warn.status, 'warn', JSON.stringify(warn.rows));
  assert.match(lineupMessages(warn).join(' '), /^warning: limbs are 15 px wide against 4 px/);
});

test('CHARACTERS-029: a tiny or giant figure is blocked on height; a metric that cannot be measured is not proven, never a pass', () => {
  const tiny = judgeLineup({ figure: { height: 10, headShare: 0.4, limbWidth: 4, outlineWeight: 1 }, reference: ref, spec });
  assert.equal(tiny.status, 'fail');
  assert.equal(tiny.rows.find((r) => r.metric === 'heightRatio').status, 'fail');
  const giant = judgeLineup({ figure: { height: 40, headShare: 0.4, limbWidth: 4, outlineWeight: 1 }, reference: ref, spec });
  assert.equal(giant.rows.find((r) => r.metric === 'heightRatio').status, 'fail');
  const noNeck = judgeLineup({ figure: { height: 27, headShare: null, limbWidth: 4, outlineWeight: 1 }, reference: ref, spec });
  assert.equal(noNeck.status, 'pass');
  assert.ok(!noNeck.rows.some((r) => r.metric === 'headShareDelta'));
  assert.ok(noNeck.notProven.some((n) => /headShareDelta/.test(n.what) && /could not be measured/.test(n.why)));
  assert.deepEqual(lineupNumbers({ height: 27, headShare: null, limbWidth: 0, outlineWeight: null }, { height: 27, headShare: 0.4, limbWidth: 4, outlineWeight: 1 }), { heightRatio: 1, headShareDelta: null, limbWidthRatio: 0, outlineWeightDelta: null });
});

test('CHARACTERS-028: the reference ghost keys out (green only) and the lineup stands everyone on one ground line at one scale', () => {
  const g = ghostFigure(figure(), 270);
  assert.equal(g.scale, 10);
  for (let i = 0; i < g.image.pixels.length; i += 4) if (g.image.pixels[i + 3]) assert.ok(g.image.pixels[i] === 0 && g.image.pixels[i + 2] === 0 && g.image.pixels[i + 1] >= 110, 'a ghost pixel is green-dominant');
  assert.equal(trimFigure(figure()).height, 27);
  assert.equal(trimFigure(createImage(4, 4)), null);
  const pic = renderLineup({ figures: [{ image: figure(), name: 'keeper', tone: 'reference' }, { image: figure({ head: 12, body: 9 }), name: 'new one' }], reference: ref, bands: { min: 0.5, max: 1.15, typicalMin: 0.6, typicalMax: 1.05 }, scale: 4 });
  assert.equal(pic.placed.length, 2);
  assert.equal(pic.placed[0].height, pic.placed[1].height);
  assert.equal(pic.scale, 4);
  // the feet of both figures are on the ground row
  const feet = (p) => { for (let x = p.x; x < p.x + p.width; x++) if (pic.pixels[((pic.ground - 1) * pic.width + x) * 4 + 3] && pic.pixels[((pic.ground - 1) * pic.width + x) * 4] !== 128) return true; return false; };
  assert.ok(pic.placed.every(feet));
  assert.throws(() => renderLineup({ figures: [{ image: createImage(4, 4), name: 'x' }] }), /at least one figure/);
});

test('CHARACTERS-028: a template cell with a ghost differs from one without, the ghost stands on the cell\'s ground line, and every added pixel keys out', () => {
  const layout = turnaroundLayout({ id: 't', facings: ['south'], size: [512, 512], heightPx: 20 });
  const plain = renderTemplate(layout, {}), ghosted = renderTemplate(layout, { ghost: () => figure() });
  assert.notDeepEqual(plain.pixels, ghosted.pixels);
  let added = 0;
  for (let i = 0; i < plain.pixels.length; i += 4) if (plain.pixels.compare(ghosted.pixels, i, i + 4, i, i + 4) !== 0) { added++; const [r, g, b] = ghosted.pixels.subarray(i, i + 3); assert.ok(r === 0 && b === 0 && g >= 110); }
  assert.ok(added > 500);
});
