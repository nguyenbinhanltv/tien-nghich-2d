import test from 'node:test';
import assert from 'node:assert/strict';
import { drawGuide, figureFor, figureWarnings, guidanceText, guideShapes, measureFigure } from '../figure/figure.mjs';
import { createImage } from '../image.mjs';

const GUIDE = { name: 'upright', profiles: ['hero'], headToBody: { min: 0.28, max: 0.52, target: 0.37 }, minLimbWidthPx: 3, accentMinPixels: 6,
  guide: { headWidth: 0.42, bodyWidth: 0.58, legWidth: 0.14, legGap: 0.07 } };

/** A synthetic 32x32 figure: head (a block), body, two legs; every number is a parameter. */
function figure({ headRows = 10, headW = 12, bodyRows = 10, bodyW = 16, neck = 6, legRows = 6, legW = 4, gap = 2, top = 1, accent = null } = {}) {
  const img = createImage(32, 32, [0, 0, 0]);
  img.pixels.fill(0);
  const put = (x, y, rgb) => img.pixels.set([...rgb, 255], (y * 32 + x) * 4);
  const block = (y0, rows, w, rgb) => { for (let y = y0; y < y0 + rows; y++) for (let x = 16 - Math.floor(w / 2); x < 16 - Math.floor(w / 2) + w; x++) put(x, y, rgb); };
  block(top, headRows, headW, [200, 150, 120]);
  block(top + headRows, 1, neck, [200, 150, 120]);
  block(top + headRows + 1, bodyRows, bodyW, [60, 70, 120]);
  const ly = top + headRows + 1 + bodyRows;
  for (let y = ly; y < ly + legRows; y++) { for (let x = 0; x < legW; x++) { put(16 - Math.floor(gap / 2) - legW + x, y, [40, 40, 60]); put(16 + Math.ceil(gap / 2) + x, y, [40, 40, 60]); } }
  if (accent) for (let i = 0; i < accent.count; i++) put(10 + (i % 6), top + headRows + 2 + Math.floor(i / 6), accent.rgb);
  return img;
}

test('measureFigure: head share where a neck shows, leg width, colours', () => {
  const m = measureFigure(figure());
  assert.equal(m.height, 27);
  assert.ok(Math.abs(m.headShare - 10 / 27) < 0.04, `head share ${m.headShare}`);
  assert.equal(m.limbWidth, 4);
  assert.equal(m.width, 16);
  assert.equal(m.colors['#c89678'] > 100, true);
  // No neck at all (the head merges into the body): nothing is claimed about the head.
  assert.equal(measureFigure(figure({ headW: 12, neck: 12, bodyW: 12 })).headShare, null);
  const empty = createImage(8, 8, [0, 0, 0]); empty.pixels.fill(0);
  assert.deepEqual([measureFigure(empty).height, measureFigure(empty).headShare, measureFigure(empty).limbWidth], [0, null, null], 'an empty frame has nothing to measure');
});

test('figureWarnings: thin limbs, a tiny head, a lost accent; a sturdy figure with a big head is clean', () => {
  const sturdy = figureWarnings(measureFigure(figure()), GUIDE);
  assert.deepEqual(sturdy, []);
  const thin = figureWarnings(measureFigure(figure({ legW: 2, gap: 4 })), GUIDE);
  assert.deepEqual(thin.map((w) => w.check), ['thin_limbs']);
  assert.match(thin[0].message, /thinner than this project's minimum: its legs are 2 px wide .* minimum is 3/);
  const realistic = figureWarnings(measureFigure(figure({ headRows: 5, headW: 8, neck: 4, bodyRows: 14, bodyW: 12, legRows: 8 })), GUIDE);
  assert.ok(realistic.some((w) => w.check === 'head_proportion'), 'a realistic small head is flagged');
  assert.match(realistic.find((w) => w.check === 'head_proportion').message, /Draw a larger head on a shorter body/);
  const scarf = { id: 'accent_01', hex: '#e07020' };
  const lost = figureWarnings(measureFigure(figure()), GUIDE, { accents: [scarf] });
  assert.deepEqual(lost.map((w) => [w.check, w.accent, w.measured]), [['accent_lost', 'accent_01', 0]]);
  assert.match(lost[0].message, /vanished in pixelisation/);
  const few = figureWarnings(measureFigure(figure({ accent: { count: 4, rgb: [224, 112, 32] } })), GUIDE, { accents: [scarf] });
  assert.deepEqual(few.map((w) => w.measured), [4]);
  const enough = figureWarnings(measureFigure(figure({ accent: { count: 8, rgb: [224, 112, 32] } })), GUIDE, { accents: [scarf] });
  assert.deepEqual(enough, []);
});

test('figureFor picks the guide by profile or name; guidanceText states the numbers; the guide is a silhouette inside the cell', () => {
  const figures = { upright: GUIDE, other: { ...GUIDE, profiles: ['beast'] } };
  assert.equal(figureFor(figures, 'hero').name, 'upright');
  assert.equal(figureFor(figures, 'beast').name, 'other');
  assert.equal(figureFor(figures, 'rock'), null);
  assert.equal(figureFor(figures, 'rock', 'other').name, 'other');
  assert.equal(figureFor(figures, 'hero', 'missing'), null);
  const text = guidanceText(figureFor(figures, 'hero'), { nativePx: [32, 32] });
  assert.match(text, /about 37% of the figure's height \(28% to 52% reads right; about 2\.7 heads tall\)/);
  assert.match(text, /at least 3 final pixels wide/);
  assert.match(text, /at least 6 final pixels/);
  const shapes = guideShapes(GUIDE, { cx: 100, ground: 400, top: 100 });
  assert.deepEqual(shapes.map((s) => s.kind), ['ellipse', 'rect', 'rect', 'rect']);
  assert.ok(shapes.every((s) => (s.kind === 'ellipse' ? s.cy - s.ry >= 100 && s.cy + s.ry <= 400 : s.y0 >= 100 && s.y1 <= 400)), 'the silhouette stays between the crown and the ground');
  const hits = new Set();
  drawGuide(shapes, (x, y) => hits.add(`${x},${y}`), 2);
  assert.ok(hits.size > 200);
  assert.equal(guideShapes({ ...GUIDE, guide: undefined }, { cx: 0, ground: 10, top: 0 }).length, 0, 'no guide, no shapes');
});
