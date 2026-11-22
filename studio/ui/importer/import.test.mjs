import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { makeProject, makeFrame } from '../../mcp/testkit.mjs';
import { openWorkspace } from '../../core/workspace.mjs';
import { encodePixels } from '../../core/png.mjs';
import { bareFrame } from '../../core/review.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { cutGrid, selectCells } from './cut.mjs';
import { importSheet } from './import.mjs';
import { handleImport } from './route.mjs';

// A sheet of 32x32 frames laid out with an offset and spacing; `variant` changes the pixels.
function sheet({count = 4, variants = [0, 1, 2, 3], offset = [2, 3], spacing = [1, 1], damage = {}} = {}) {
  const w = offset[0] + count * 32 + (count - 1) * spacing[0], h = offset[1] + 32;
  const pixels = Buffer.alloc(w * h * 4);
  for (let i = 0; i < count; i++) {
    const frame = makeFrame(32, 32, {variant: variants[i], damage: damage[i] ?? []});
    for (let y = 0; y < 32; y++) frame.pixels.copy(pixels, ((offset[1] + y) * w + offset[0] + i * (32 + spacing[0])) * 4, y * 32 * 4, (y + 1) * 32 * 4);
  }
  return {png: encodePixels(w, h, pixels), w, h};
}
const CELL = {w: 32, h: 32, offsetX: 2, offsetY: 3, spacingX: 1, spacingY: 1};

async function withWs(fn) {
  const p = makeProject();
  const ws = openWorkspace(p.root, {indexer: loadAssetIndex});
  try { return await fn({p, ws, run: async options => importSheet({ws, snap: await ws.snapshot(), caller: {agent: 'studio-ui', session: 'sheet-importer'}}, options)}); }
  finally { ws.close(); await p.cleanup(); }
}
const opts = (s, extra = {}) => ({assetId: 'lt_seed_broker', sheetBase64: s.png.toString('base64'), cell: CELL, clip: 'idle', direction: 'south', mode: 'replace', ...extra});
const rawDir = p => path.join(p.root, 'assets/raw/longtime/lt_seed_broker/frames');

test('CHARACTERS-020: the grid cuts cells left to right, top to bottom, honouring offset and spacing', () => {
  const g = cutGrid({sheetW: 133, sheetH: 105, cellW: 32, cellH: 32, offsetX: 2, offsetY: 3, spacingX: 1, spacingY: 1});
  assert.deepEqual([g.cols, g.rows, g.cells.length], [4, 3, 12]);
  assert.deepEqual(g.cells[5], {index: 5, col: 1, row: 1, x: 35, y: 36});
  assert.deepEqual([g.leftoverX, g.leftoverY], [0, 105 - 3 - (3 * 32 + 2)]);
  assert.equal(selectCells(g, {skip: 2, count: 3}).map(c => c.index).join(), '2,3,4');
  assert.throws(() => cutGrid({sheetW: 10, sheetH: 10, cellW: 32, cellH: 32}), /does not fit/);
  assert.throws(() => cutGrid({sheetW: 100, sheetH: 100, cellW: 0, cellH: 8}), /at least 1/);
  assert.throws(() => cutGrid({sheetW: 100, sheetH: 100, cellW: 8, cellH: 8, spacingX: -1}), /spacing x/);
  assert.throws(() => cutGrid({sheetW: 4000, sheetH: 4000, cellW: 4, cellH: 4}), /limit/);
  assert.throws(() => selectCells(g, {skip: 1, count: 99}), /count must be/);
});

test('CHARACTERS-021: a dry run says what would happen and writes nothing; the import writes raw frames with provenance', () => withWs(async ({p, ws, run}) => {
  const s = sheet();
  const dry = await run(opts(s));
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.frames.map(f => [f.name, f.action]), [['idle_south_0', 'new'], ['idle_south_1', 'new'], ['idle_south_2', 'new'], ['idle_south_3', 'new']]);
  assert.equal(fs.existsSync(rawDir(p)), false, 'a dry run writes nothing');
  const done = await run(opts(s, {dryRun: false}));
  assert.equal(done.written, true);
  assert.deepEqual(fs.readdirSync(rawDir(p)).filter(f => f.endsWith('.png')).sort(), ['idle_south_0.png', 'idle_south_1.png', 'idle_south_2.png', 'idle_south_3.png']);
  const log = fs.readFileSync(path.join(p.root, 'assets/raw/longtime/lt_seed_broker/studio-submissions.jsonl'), 'utf8');
  assert.match(log, /studio spritesheet importer/);
  assert.match(log, new RegExp(done.sheet.sha256));
  // the same sheet again: nothing differs
  const again = await run(opts(s, {dryRun: false}));
  assert.deepEqual(again.frames.map(f => f.action), ['unchanged', 'unchanged', 'unchanged', 'unchanged']);
}));

test('CHARACTERS-022: replacing frames that exist saves new PENDING revisions and never touches the file', () => withWs(async ({p, ws, run}) => {
  await run(opts(sheet(), {dryRun: false}));
  const before = fs.readFileSync(path.join(rawDir(p), 'idle_south_1.png'));
  const changed = sheet({variants: [0, 7, 2, 3]});
  const r = await run(opts(changed, {dryRun: false}));
  assert.deepEqual(r.frames.map(f => f.action), ['unchanged', 'revision', 'unchanged', 'unchanged']);
  assert.equal(r.frames[1].status, 'pending');
  assert.ok(r.frames[1].revision >= 1);
  assert.deepEqual(fs.readFileSync(path.join(rawDir(p), 'idle_south_1.png')), before, 'the raw frame stays as submitted');
  const store = await ws.store();
  assert.notEqual(store.operate(bareFrame('longtime/lt_seed_broker/idle_south_1'), null, 'frame', {}).status, 'approved');
}));

test('CHARACTERS-023: append starts after the last frame; a clip that would overflow is refused with the reason', () => withWs(async ({p, run}) => {
  const two = sheet({count: 2, variants: [0, 1]});
  await run(opts(two, {dryRun: false}));
  const more = await run(opts(sheet({count: 2, variants: [4, 5]}), {mode: 'append', dryRun: false}));
  assert.deepEqual(more.frames.map(f => f.name), ['idle_south_2', 'idle_south_3']);
  assert.equal(fs.readdirSync(rawDir(p)).filter(f => f.endsWith('.png')).length, 4);
  const over = await run(opts(sheet({count: 1, variants: [6]}), {mode: 'append', dryRun: false}));
  assert.equal(over.ok, false);
  assert.match(over.refused[0].message, /idle has 4 frames/);
  const skipped = await run(opts(sheet(), {skip: 1, count: 2}));
  assert.deepEqual(skipped.frames.map(f => [f.name, f.cell.index]), [['idle_south_0', 1], ['idle_south_1', 2]]);
}));

test('CHARACTERS-024: a wrong cell size or an off-palette cell is refused with the reason, writes nothing and offers the pixelise step', () => withWs(async ({p, run}) => {
  const wrongSize = await run(opts(sheet(), {cell: {...CELL, w: 16, h: 16}, dryRun: false}));
  assert.equal(wrongSize.ok, false);
  assert.match(wrongSize.refused[0].message, /cell is 16x16 but lt_seed_broker .* is 32x32/);
  assert.match(wrongSize.offer.pixelise, /studio_sheet_import/);
  const bad = await run(opts(sheet({damage: {1: [{x: 10, y: 12, kind: 'color'}, {x: 11, y: 12, kind: 'alpha'}]}}), {dryRun: false}));
  assert.equal(bad.ok, false);
  assert.equal(bad.written, false);
  assert.equal(bad.frames[1].action, 'refused');
  assert.deepEqual(bad.frames[1].reasons.map(r => r.code).sort(), ['off_palette', 'partial_alpha']);
  assert.deepEqual(bad.frames[1].defects.filter(d => d.code === 'off_palette').map(d => [d.x, d.y]), [[10, 12]]);
  assert.match(bad.refused[0].message, /nothing was written/);
  assert.ok(bad.offer);
  assert.equal(fs.existsSync(rawDir(p)), false, 'one bad cell writes nothing, not even the good ones');
  const unknownClip = await run(opts(sheet(), {clip: 'fly'})).catch(e => e);
  assert.match(unknownClip.message, /no clip "fly"/);
  const notPng = await run({...opts(sheet()), sheetBase64: Buffer.from('not a png').toString('base64')}).catch(e => e);
  assert.match(notPng.message, /not a readable 8-bit PNG/);
}));

test('CHARACTERS-025: a shipped asset changes only through revisions: processed frames are never written, new frames are refused', () => withWs(async ({p, ws, run}) => {
  const dir = path.join(p.root, 'assets/processed_longtime/lt_kiln_keeper');
  const snapshot = () => Object.fromEntries(fs.readdirSync(dir).map(f => [f, fs.readFileSync(path.join(dir, f)).toString('base64')]));
  const before = snapshot();
  const s = sheet({variants: [9, 10, 11, 12]});
  const r = await run(opts(s, {assetId: 'lt_kiln_keeper', dryRun: false}));
  assert.equal(r.ok, true);
  assert.ok(r.frames.every(f => f.action === 'revision' && f.status === 'pending'), JSON.stringify(r.frames.map(f => f.action)));
  assert.deepEqual(snapshot(), before, 'the shipped directory is untouched');
  const none = await run(opts(sheet({count: 1, variants: [1]}), {assetId: 'lt_kiln_keeper', clip: 'interact', direction: 'south', dryRun: false}));
  assert.equal(none.ok, true, 'interact frames exist too, so this is a revision');
}));

test('CHARACTERS-026: the import route needs a JSON POST, refuses unknown fields and assets the tab does not own, and defaults to a dry run', async () => {
  const p = makeProject();
  try {
    const call = async (body, {method = 'POST', type = 'application/json', allow = () => true} = {}) => {
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {method, headers: {'content-type': type}});
      let out;
      try { await handleImport(req, {writeHead() {}, end(t) { out = JSON.parse(t); }}, {root: p.root, allow}); } catch (error) { return {code: error.code}; }
      return out;
    };
    const s = sheet();
    assert.equal((await call(opts(s), {method: 'PUT'})).code, 'method_not_allowed');
    assert.equal((await call(opts(s), {type: 'text/plain'})).code, 'unsupported_media_type');
    assert.equal((await call({...opts(s), approve: true})).code, 'invalid_input');
    assert.equal((await call(opts(s), {allow: () => false})).code, 'wrong_tab');
    const r = await call(opts(s));
    assert.equal(r.dryRun, true, 'dryRun is on unless the page says otherwise');
    assert.equal(fs.existsSync(rawDir(p)), false);
  } finally { await p.cleanup(); }
});

test('CHARACTERS-027 OBJECTS-002: the Characters tab mounts the importer for characters only; the Objects tab for everything else', async () => {
  const characters = await import('../tabs/characters/server.mjs');
  const objects = await import('../tabs/objects/server.mjs');
  const p = makeProject();
  try {
    const post = async (mod, tab, body) => {
      const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {method: 'POST', headers: {'content-type': 'application/json'}});
      let out;
      try { await mod.handle(req, {writeHead() {}, end(t) { out = JSON.parse(t); }}, new URL(`http://127.0.0.1/api/tabs/${tab}/import`), {root: p.root, prefix: `/api/tabs/${tab}/`}); } catch (error) { return {code: error.code}; }
      return out;
    };
    const s = sheet();
    const mine = await post(characters, 'characters', opts(s));
    assert.equal(mine.ok, true, JSON.stringify(mine));
    assert.equal(mine.dryRun, true);
    assert.equal((await post(objects, 'objects', opts(s))).code, 'wrong_tab', 'a character is not imported from the Objects tab');
    assert.equal((await post(characters, 'characters', opts(s, {assetId: 'nothing_here'}))).code, 'unknown_asset');
    assert.equal(fs.existsSync(rawDir(p)), false);
  } finally { await p.cleanup(); }
});
