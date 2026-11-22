// studio_frame_read and the text form of studio_frame_patch: a frame as rows of characters, read and written back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { decodePng } from '../forge/index.mjs';
import { bareFrame } from '../core/review.mjs';
import { PROVENANCE, clipFrames, connect, makeProject, makeFrame, writeFrame } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };
const withProject2 = async (fn) => { const p = makeProject({ git: false, extraDirs: ['assets/processed_longtime/lt_fx_core_breach'] }); try { return await fn(p); } finally { await p.cleanup(); } };
const ICON = 'lt_icon_realm_step'; // planned 16x16 icon: clip glyph, one frame
const FRAME = 'glyph_none_0';
const square = [{ op: 'fill', box: [4, 4, 12, 12], color: 'jade_03' }, { op: 'outline' }];
const draw = (a) => a.ok('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: FRAME, ops: square }] });
const rawIcon = (p) => join(p.root, 'assets/raw/longtime', ICON, 'frames/glyph_none_0.png');

test('frame_read: 16 rows for a 16x16 frame, a legend, the hash, and a stable character per palette id', () => withProject(async (p) => {
  const a = connect(p.root, { scope: 'read' });
  await draw(connect(p.root));
  const r = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  assert.equal(r.rows.length, 16);
  assert.ok(r.rows.every((row) => row.length === 16));
  assert.deepEqual(r.size, [16, 16]);
  assert.match(r.hash, /^[0-9a-f]{64}$/);
  assert.equal(r.rows[0], '.'.repeat(16), 'outside the shape is transparent');
  assert.equal(r.page.nextCursor, null);
  assert.equal(r.offPalette.pixels, 0);
  const ink = r.legend.find((l) => l.id === 'ink_01'), jade = r.legend.find((l) => l.id === 'jade_03');
  assert.ok(ink && jade && ink.char !== jade.char);
  assert.match(ink.hex, /^#[0-9a-f]{6}$/);
  assert.equal(r.rows[4][4], ink.char);
  assert.equal(r.rows[8][8], jade.char);
  // The same id is the same character in another frame of any asset, and the pixel counts add up.
  assert.equal(ink.pixels + jade.pixels, 64);
  const t = await a.call('studio_frame_read', { assetId: ICON, frame: FRAME });
  assert.match(text(t), new RegExp(`hash ${r.hash}`));
  assert.match(text(t), /legend: \. transparent; /);
  assert.equal(text(t).split('\n').filter((l) => /^ ?\d+  [^ ]/.test(l)).length, 16, 'one numbered line per pixel row');
  // A read-scope connection reads; the tool declares itself read-only.
  const listed = (await a.rpc('tools/list')).result.tools.find((x) => x.name === 'studio_frame_read');
  assert.equal(listed.annotations.readOnlyHint, true);
}));

test('frame_read: pages, regions and the absolute coordinates they keep', () => withProject(async (p) => {
  await draw(connect(p.root));
  const a = connect(p.root, { scope: 'read' });
  const whole = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  const p1 = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME, pageRows: 5 });
  assert.deepEqual([p1.rows.length, p1.page.nextCursor, p1.page.totalRows], [5, 5, 16]);
  const p2 = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME, pageRows: 5, cursor: 5 });
  const p4 = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME, pageRows: 5, cursor: 15 });
  assert.deepEqual([...p1.rows, ...p2.rows, ...(await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME, pageRows: 5, cursor: 10 })).rows, ...p4.rows], whole.rows);
  assert.equal(p4.page.nextCursor, null);
  assert.deepEqual(p1.legend, whole.legend, 'the legend describes the whole region, not the page');
  const win = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME, region: { x: 3, y: 3, w: 4, h: 3 } });
  assert.deepEqual(win.rows, whole.rows.slice(3, 6).map((row) => row.slice(3, 7)));
  assert.equal(win.page.firstY, 3);
  assert.deepEqual(win.region, { x: 3, y: 3, w: 4, h: 3 });
  assert.match(text(await a.call('studio_frame_read', { assetId: ICON, frame: FRAME, region: { x: 3, y: 3, w: 4, h: 3 } })), /region x 3\.\.6, y 3\.\.5/);
  // What it refuses.
  assert.match(text(await a.call('studio_frame_read', { assetId: ICON, frame: FRAME, region: { x: 14, y: 0, w: 4, h: 1 } })), /inside the 16x16 frame/);
  assert.match(text(await a.call('studio_frame_read', { assetId: ICON, frame: FRAME, cursor: 16 })), /past the last row/);
  assert.match(text(await a.call('studio_frame_read', { assetId: ICON, frame: 'glyph_none_9' })), /is not a raw frame of/);
  assert.match(text(await a.call('studio_frame_read', { assetId: 'lt_reed_crane', frame: 'idle_south_0' })), /no (processed|raw) frames/);
}));

test('frame_read: a 96x96 boss frame is paged, not dumped', () => withProject(async (p) => {
  const BOSS = 'lt_hollow_astrolabe'; // boss_large: 96x96
  const a = connect(p.root);
  await a.ok('studio_frames_submit', { assetId: BOSS, provenance: { tool: 'testkit', prompt: 'x', sourceHash: 'a'.repeat(64) }, frames: [{ clip: 'idle', direction: 'south', n: 0, pngBase64: makeFrame(96, 96).png.toString('base64') }] });
  const r = await a.ok('studio_frame_read', { assetId: BOSS, frame: 'idle_south_0' });
  assert.deepEqual(r.size, [96, 96]);
  assert.equal(r.page.totalRows, 96);
  assert.equal(r.rows.length, 48, 'the default page is 48 rows');
  assert.equal(r.page.nextCursor, 48);
  const rest = await a.ok('studio_frame_read', { assetId: BOSS, frame: 'idle_south_0', cursor: r.page.nextCursor, pageRows: 128 });
  assert.equal(rest.rows.length, 48);
  assert.equal(rest.page.nextCursor, null);
  assert.equal(rest.page.firstY, 48);
  const t = text(await a.call('studio_frame_read', { assetId: BOSS, frame: 'idle_south_0' }));
  assert.ok(t.split('\n').length < 60, 'a page is at most about 48 rows plus a short header');
  assert.match(t, /more: cursor 48/);
}));

test('frame_read: off-palette and half-transparent pixels get their own marker and are counted', () => withProject(async (p) => {
  const a = connect(p.root);
  // A raw file with two off-palette pixels and one half-transparent pixel (never submitted, so no history hides it).
  writeFrame(p.root, 'assets/raw/longtime/' + ICON + '/frames/glyph_none_0.png', makeFrame(16, 16, { damage: [{ x: 8, y: 8, kind: 'color' }, { x: 9, y: 8, kind: 'color' }, { x: 7, y: 8, kind: 'alpha' }] }));
  const r = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  assert.equal(r.rows[8][8], '?');
  assert.equal(r.rows[8][9], '?');
  assert.equal(r.rows[8][7], '~');
  assert.deepEqual(r.offPalette, { pixels: 2, colors: [{ hex: '#010203', pixels: 2 }] });
  assert.equal(r.partialAlpha, 1);
  assert.match(text(await a.call('studio_frame_read', { assetId: ICON, frame: FRAME })), /\? OFF PALETTE: 2 pixel\(s\): #010203 x2/);
  assert.equal(r.legend.every((l) => /^[a-zA-Z0-9]$/.test(l.char)), true, 'markers are never legend characters');
}));

test('frame_patch rows: edit what you read; only changed pixels are stored, as a new pending revision', () => withProject(async (p) => {
  const a = connect(p.root);
  await draw(a);
  const read = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  const rawBefore = fs.readFileSync(rawIcon(p));
  const rows = read.rows.map((row, y) => (y === 7 ? row.slice(0, 7) + 'b' + row.slice(8) : row));
  const legend = { ...Object.fromEntries(read.legend.map((l) => [l.char, l.id])), b: 'bronze_04' };
  const done = await a.ok('studio_frame_patch', { assetId: ICON, edits: [{ frame: FRAME, rows, legend, hash: read.hash }] });
  assert.equal(done.target, 'revision');
  assert.deepEqual(done.saved.map((s) => [s.revision, s.changed, s.status]), [[1, true, 'pending']]);
  assert.deepEqual(fs.readFileSync(rawIcon(p)), rawBefore, 'raw stays');
  const diff = await a.ok('studio_diff', { assetId: ICON });
  assert.equal(diff.frames[0].changedPixels, 1);
  assert.deepEqual(diff.frames[0].box, { x: 7, y: 7, w: 1, h: 1 });
  // The frame's hash moved, and the new read shows the pixel.
  const after = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  assert.notEqual(after.hash, read.hash);
  assert.equal(after.rows[7][7], after.legend.find((l) => l.id === 'bronze_04').char);
}));

test('frame_patch rows: a stale hash, a missing hash, unknown characters and colours outside the palette are refused', () => withProject(async (p) => {
  const a = connect(p.root);
  await draw(a);
  const read = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  const legend = Object.fromEntries(read.legend.map((l) => [l.char, l.id]));
  const rows = read.rows.slice();
  const edit = (extra) => a.call('studio_frame_patch', { assetId: ICON, edits: [Object.fromEntries(Object.entries({ frame: FRAME, rows, legend, hash: read.hash, ...extra }).filter(([, v]) => v !== undefined))] }).then(text);
  const withPixel = (ch) => rows.map((row, y) => (y === 7 ? row.slice(0, 7) + ch + row.slice(8) : row));

  assert.match(await edit({ rows: withPixel('Z'), legend: { ...legend, Z: 'bronze_04' }, hash: undefined }), /need the hash from studio_frame_read/);
  assert.match(await edit({ rows: withPixel('Z'), hash: 'f'.repeat(64) }), /changed since you read it/);
  assert.match(await edit({ rows: withPixel('Z') }), /uses "Z", which the legend does not define/);
  assert.match(await edit({ rows: withPixel('Z'), legend: { ...legend, Z: 'not_in_palette' } }), /not a colour of the project palette/);
  assert.match(await edit({ rows: withPixel('?') }), /marks a colour outside the palette, but that pixel is not one/);
  assert.match(await edit({ rows: withPixel('b'), legend: { ...legend, '.': 'ink_01' } }), /legend key "\." must be one character other than/);
  assert.match(await edit({ rows: [...rows.slice(0, 3), 'abc'] }), /same width/);
  assert.match(await edit({ rows: ['a'], at: [16, 0] }), /inside the 16x16 frame/);
  assert.match(await edit({ ops: [{ op: 'outline' }] }), /rows \(text form\) or ops, not both/);
  assert.match(await edit({}), /identical to the frame, so there is nothing to change/);
  // A stale hash after someone else's change: the frame changed, the agent's copy did not.
  await a.ok('studio_frame_patch', { assetId: ICON, edits: [{ frame: FRAME, ops: [{ op: 'set', pixels: [[7, 7, 'bronze_04']] }] }] });
  assert.match(await edit({ rows: withPixel('a'), legend: { ...legend, a: 'bronze_04' } }), /changed since you read it/);
  // Nothing above saved anything.
  assert.equal((await a.ok('studio_diff', { assetId: ICON })).frames[0].revision, 1);
}));

test('frame_patch rows: breaking the outline is still refused by the gates; ops and rows keep working side by side', () => withProject(async (p) => {
  const a = connect(p.root);
  await draw(a);
  const read = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  const legend = { ...Object.fromEntries(read.legend.map((l) => [l.char, l.id])), j: 'jade_03' };
  const rows = read.rows.map((row, y) => (y === 7 ? 'j' + row.slice(1) : row));
  rows[7] = rows[7].slice(0, 4) + 'j' + rows[7].slice(5);
  const bad = await a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: FRAME, rows, legend, hash: read.hash }] });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /breaks the pixel gates, so nothing was saved/);
}));

test('frame_patch rows target create: the whole frame from characters, no hash; target bake without pixels is refused', () => withProject(async (p) => {
  const a = connect(p.root);
  const rows = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x >= 4 && x < 12 && y >= 4 && y < 12 ? 'j' : '.')).join(''));
  const make = (extra = {}) => a.call('studio_frame_patch', { assetId: ICON, target: 'create', edits: [{ frame: FRAME, rows, legend: { j: 'jade_03' }, ...extra }] });
  assert.match(text(await make({ hash: 'a'.repeat(64) })), /does not exist yet, so there is no hash/);
  // The shape has no outline yet: the gates say so and nothing is written.
  const bad = await make();
  assert.equal(bad.isError, true);
  assert.match(JSON.stringify(bad.structuredContent.frames[0].defects), /outline_gap/);
  assert.equal(fs.existsSync(rawIcon(p)), false);
  assert.match(text(await a.call('studio_frame_patch', { assetId: ICON, target: 'bake', edits: [{ frame: FRAME, rows, legend: { j: 'jade_03' } }] })), /no pixels to read/);
}));

test('frame_read: a delivered palette-variant VFX (clips null, breach_base_0) reads; unknown names do not crash', () => withProject2(async (p) => {
  const a = connect(p.root, { scope: 'read' });
  const r = await a.ok('studio_frame_read', { assetId: 'lt_fx_core_breach', frame: 'breach_base_0' });
  assert.equal(r.page.totalRows, r.size[1]);
  assert.equal(r.stage, 'processed');
  const bad = await a.call('studio_frame_read', { assetId: 'lt_fx_core_breach', frame: 'breach_none_0' });
  assert.equal(bad.isError, true);
  assert.match(text(bad), /is not a processed frame of lt_fx_core_breach\. It has \d+: breach_base_0/);
}));

test('frame_patch rows: a revision saved between validation and save is never overwritten', () => withProject(async (p) => {
  const a = connect(p.root);
  await draw(a);
  const read = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  const legend = { ...Object.fromEntries(read.legend.map((l) => [l.char, l.id])), b: 'bronze_04' };
  const rows = read.rows.map((row, y) => (y === 7 ? row.slice(0, 7) + 'b' + row.slice(8) : row));
  // Another session saves a revision after the hash was checked, before the save phase starts (the first store() taken by the save step).
  const ws = a.project.workspace;
  const realStore = ws.store.bind(ws);
  let injected = false;
  ws.store = async () => {
    const store = await realStore();
    if (!injected && new Error().stack.includes('saveRevisions')) {
      injected = true;
      const key = `longtime/${ICON}/glyph_none_0`;
      const base = fs.readFileSync(rawIcon(p));
      const head = store.operate(bareFrame(key), base, 'frame', {});
      store.operate(bareFrame(key), base, 'save', { baseRevision: head.head, png: makeFrame(16, 16, { variant: 9 }).png });
    }
    return store;
  };
  const r = await a.call('studio_frame_patch', { assetId: ICON, edits: [{ frame: FRAME, rows, legend, hash: read.hash }] });
  ws.store = realStore;
  assert.equal(injected, true);
  assert.equal(r.isError, true);
  assert.match(text(r), /changed since you read it \(another save landed after revision 0\); NOTHING was saved/);
  const after = await a.ok('studio_frame_read', { assetId: ICON, frame: FRAME });
  assert.notEqual(after.hash, read.hash, 'the other revision is what is stored');
  assert.equal((await a.ok('studio_diff', { assetId: ICON })).frames[0].revision, 1, 'only the other session\'s revision exists');
}));

test('frame_patch rows: a conflict on the second of two frames saves neither, and says so', () => withProject(async (p) => {
  const a = connect(p.root);
  const BROKER = 'lt_seed_broker';
  await a.ok('studio_frames_submit', { assetId: BROKER, provenance: PROVENANCE, frames: clipFrames('idle', 'south', 2) });
  const edit = async (n) => {
    const read = await a.ok('studio_frame_read', { assetId: BROKER, frame: `idle_south_${n}` });
    const legend = { ...Object.fromEntries(read.legend.map((l) => [l.char, l.id])), b: 'bronze_04' };
    const rows = read.rows.map((row, i) => (i === 14 ? row.slice(0, 16) + 'b' + row.slice(17) : row)); // an interior pixel of the body
    return { frame: `idle_south_${n}`, rows, legend, hash: read.hash };
  };
  const edits = [await edit(0), await edit(1)];
  // Frame 1's head advances after its hash was validated, before the save phase begins (the first store() taken by the save step).
  const ws = a.project.workspace;
  const realStore = ws.store.bind(ws);
  let injected = false;
  ws.store = async () => {
    const store = await realStore();
    if (!injected && new Error().stack.includes('saveRevisions')) {
      injected = true;
      const key = `longtime/${BROKER}/idle_south_1`;
      const base = makeFrame(32, 32, { variant: 1 }).png;
      const head = store.operate(bareFrame(key), base, 'frame', {});
      store.operate(bareFrame(key), base, 'save', { baseRevision: head.head, png: makeFrame(32, 32, { variant: 7 }).png });
    }
    return store;
  };
  const r = await a.call('studio_frame_patch', { assetId: BROKER, edits });
  ws.store = realStore;
  assert.equal(injected, true, text(r));
  assert.equal(r.isError, true);
  assert.match(text(r), /idle_south_1 changed since you read it .* NOTHING was saved, not even the other frames/);
  const diff = await a.ok('studio_diff', { assetId: BROKER });
  assert.equal(diff.frames.find((f) => f.frame === 'idle_south_0').status, 'single_revision', 'frame 0 was not saved');
  assert.equal(diff.frames.find((f) => f.frame === 'idle_south_1').revision, 1, 'only the other session\'s revision on frame 1');
  // Retrying with fresh reads works.
  const again = await a.ok('studio_frame_patch', { assetId: BROKER, edits: [await edit(0), await edit(1)] });
  assert.deepEqual(again.saved.map((x) => x.revision), [1, 2]);
}));
