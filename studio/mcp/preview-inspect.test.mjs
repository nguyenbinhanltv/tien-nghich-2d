// studio_preview_render as an inspection tool: zoom, pixel grid, rulers, region zoom and a cap on the image size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePng } from '../forge/index.mjs';
import { connect, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const ICON = 'lt_icon_realm_step'; // 16x16, one frame
const square = [{ op: 'fill', box: [4, 4, 12, 12], color: 'jade_03' }, { op: 'outline' }];
const setup = async (p) => { const a = connect(p.root); await a.ok('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: 'glyph_none_0', ops: square }] }); return connect(p.root, { scope: 'read' }); };
const png = (r) => decodePng(Buffer.from(r.content.find((c) => c.type === 'image').data, 'base64'));
const px = (img, x, y) => [...img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)];
const EDGE = 6, BAR_AND_GAP = 4; // the sheet's outer margin; the status bar plus its gap above each frame

test('preview_render: the default sheet is unchanged (x4, no rulers, no grid)', () => withProject(async (p) => {
  const a = await setup(p);
  const r = await a.call('studio_preview_render', { assetId: ICON });
  const img = png(r);
  assert.equal(img.width, EDGE * 2 + 16 * 4);
  assert.equal(img.height, EDGE * 2 + 16 * 4 + BAR_AND_GAP);
  assert.equal(r.structuredContent.layout.rulers, undefined);
  assert.equal(r.structuredContent.capped, undefined);
}));

test('preview_render: zoom up to 32, nearest-neighbour; zoom wins over scale', () => withProject(async (p) => {
  const a = await setup(p);
  const r = await a.call('studio_preview_render', { assetId: ICON, zoom: 16, scale: 2 });
  const img = png(r);
  assert.equal(img.width, EDGE * 2 + 16 * 16);
  // Every source pixel is a flat 16x16 block: no smoothing.
  const top = EDGE + BAR_AND_GAP;
  const c = px(img, EDGE + 8 * 16 + 1, top + 8 * 16 + 1);
  for (const [dx, dy] of [[0, 0], [15, 0], [0, 15], [15, 15], [7, 7]]) assert.deepEqual(px(img, EDGE + 8 * 16 + dx, top + 8 * 16 + dy), c);
  assert.equal((await a.call('studio_preview_render', { assetId: ICON, zoom: 33 })).isError, true);
}));

test('preview_render: the grid tints the lines between pixels and leaves the pixels alone', () => withProject(async (p) => {
  const a = await setup(p);
  const plain = png(await a.call('studio_preview_render', { assetId: ICON, zoom: 8 }));
  const gridded = await a.call('studio_preview_render', { assetId: ICON, zoom: 8, grid: true });
  const img = png(gridded);
  assert.equal(gridded.structuredContent.layout.grid, true);
  const top = EDGE + BAR_AND_GAP;
  const x = EDGE + 8 * 8, y = top + 8 * 8; // the major line at sprite x 8, y 8
  assert.notDeepEqual(px(img, x, y + 3), px(plain, x, y + 3), 'the line is drawn');
  assert.deepEqual(px(img, x + 3, y + 3), px(plain, x + 3, y + 3), 'a pixel centre is untouched');
  // At zoom 2 there is no room for a grid; the text says so.
  assert.match(text(await a.call('studio_preview_render', { assetId: ICON, zoom: 2, grid: true })), /Grid skipped/);
}));

test('preview_render: region zoom keeps sprite coordinates on the rulers and the defects', () => withProject(async (p) => {
  const a = await setup(p);
  const noRuler = await a.call('studio_preview_render', { assetId: ICON, zoom: 8, region: { x: 4, y: 4, w: 6, h: 5 } });
  const small = png(noRuler);
  assert.equal(small.width, EDGE * 2 + 6 * 8);
  assert.equal(small.height, EDGE * 2 + 5 * 8 + BAR_AND_GAP);
  assert.match(text(noRuler), /Region x 4\.\.9, y 4\.\.8/);
  // Pixel (4, 4) is the outline's corner: it is the first pixel of the window.
  const full = png(await a.call('studio_preview_render', { assetId: ICON, zoom: 8 }));
  assert.deepEqual(px(small, EDGE + 2, EDGE + BAR_AND_GAP + 2), px(full, EDGE + 4 * 8 + 2, EDGE + BAR_AND_GAP + 4 * 8 + 2));

  const ruled = await a.call('studio_preview_render', { assetId: ICON, zoom: 8, region: { x: 4, y: 4, w: 6, h: 5 }, rulers: true });
  const img = png(ruled);
  assert.equal(ruled.structuredContent.layout.rulers, true);
  assert.deepEqual(ruled.structuredContent.layout.region, { x: 4, y: 4, w: 6, h: 5 });
  assert.ok(img.width > small.width && img.height > small.height, 'the rulers add margins');
  // The ruler colour appears in the margins, and only there.
  const RULER = [0xc8, 0xc4, 0xd8];
  const count = (x0, y0, x1, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (JSON.stringify(px(img, x, y)) === JSON.stringify(RULER)) n++; return n; };
  const left = EDGE + 4 * 1 + 3; // margin for one digit label plus gap... widths are checked loosely: the left band holds ruler ink
  assert.ok(count(EDGE, EDGE, left, img.height - EDGE) > 0, 'ruler ink in the left band');
  assert.ok(count(EDGE, EDGE + 4, img.width - EDGE, EDGE + 12) > 0, 'ruler ink in the top band');
  assert.equal(count(left + 1, EDGE + 14, img.width - EDGE, img.height - EDGE), 0, 'none over the sprite');
  // A region outside the frame is refused with the frame size.
  assert.match(text(await a.call('studio_preview_render', { assetId: ICON, region: { x: 10, y: 0, w: 10, h: 4 } })), /inside the 16x16 frame/);
}));

test('preview_render: maxSide lowers the zoom, says so, and refuses what cannot fit', () => withProject(async (p) => {
  const a = await setup(p);
  const r = await a.call('studio_preview_render', { assetId: ICON, zoom: 32, maxSide: 200 });
  const img = png(r);
  assert.ok(Math.max(img.width, img.height) <= 200);
  assert.deepEqual(r.structuredContent.capped, { maxSide: 200, requestedZoom: 32, zoom: r.structuredContent.layout.scale });
  assert.ok(r.structuredContent.layout.scale < 32 && r.structuredContent.layout.scale >= 8);
  assert.match(text(r), /SIZE CAP APPLIED: maxSide 200 lowered zoom from 32 to \d+/);
  const fine = await a.call('studio_preview_render', { assetId: ICON, zoom: 4, maxSide: 4096 });
  assert.equal(fine.structuredContent.capped, undefined);
  assert.doesNotMatch(text(fine), /SIZE CAP/);
  assert.match(text(await a.call('studio_preview_render', { assetId: ICON, maxSide: 64, rulers: true, zoom: 4, region: { x: 0, y: 0, w: 16, h: 16 } })), /SIZE CAP APPLIED|Even at zoom 1/);
  assert.match(text(await a.call('studio_preview_render', { assetId: ICON, maxSide: 20 })), /maximum|below minimum|must be/);
}));
