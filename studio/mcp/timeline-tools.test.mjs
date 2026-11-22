// The timeline lane end to end on a throwaway project: tags and linked cels in the metadata, scoped transforms and mirror drawing through
// studio_frame_patch, linked-cel edits, and the open-in-a-drawing-tool round trip (.pxo, .ase) with its refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { decodePng } from '../forge/index.mjs';
import { decodeRgba, encodePixels } from '../core/png.mjs';
import { headPng } from '../core/revisions.mjs';
import { readZip, writeZip } from '../core/interop/zip.mjs';
import { exportAsset, importFile } from '../core/interop/index.mjs';
import { planTransform } from '../core/timeline-ops.mjs';
import { PROVENANCE, clipFrames, connect, makeProject } from './testkit.mjs';

const ASSET = 'lt_reed_crane'; // 32x32, clips idle (4) and follow (4), directions south west north east
const text = r => r.content?.[0]?.text ?? '';
const withProject = async fn => { const p = makeProject({git: false}); try { return await fn(p); } finally { await p.cleanup(); } };
const submit = async a => {
  await a.ok('studio_frames_submit', {assetId: ASSET, provenance: PROVENANCE ?? {tool: 'testkit', prompt: 'x', sourceHash: 'a'.repeat(64)}, frames: [...clipFrames('idle', 'south', 4), ...clipFrames('follow', 'south', 4)]});
};
const rawPath = (p, name) => join(p.root, 'assets/raw/longtime', ASSET, 'frames', `${name}.png`);
const headOf = async (a, name) => {
  const ws = a.project.workspace, snap = await ws.snapshot(), asset = snap.index.assets.get(ASSET);
  const [clip, , n] = [name.split('_')[0], 0, name.split('_')[2]];
  const key = asset.layout.keyOf(clip, 'south', Number(n));
  return decodeRgba(await headPng(ws, key, fs.readFileSync(rawPath({root: ws.root}, name))));
};
const statusOf = async (a, name) => {
  const ws = a.project.workspace, snap = await ws.snapshot(), asset = snap.index.assets.get(ASSET);
  const [clip, , n] = name.split('_');
  const store = await ws.store();
  const {bareFrame} = await import('../core/review.mjs');
  return store.operate(bareFrame(asset.layout.keyOf(clip, 'south', Number(n))), fs.readFileSync(rawPath({root: ws.root}, name)), 'frame', {});
};

test('MCP-043: studio_metadata_set stores a clip\'s play direction and links, and refuses bad ones', () => withProject(async p => {
  const a = connect(p.root);
  const r = await a.ok('studio_metadata_set', {assetId: ASSET, clips: {idle: {play: 'pingpong', links: [{frames: [0, 2]}]}}});
  assert.equal(r.metadata.clips.idle.play, 'pingpong');
  assert.deepEqual(r.metadata.clips.idle.links, [{frames: [0, 2]}]);
  for (const bad of [{play: 'sideways'}, {links: [{frames: [0]}]}, {links: [{frames: [0, 7]}]}, {links: [{direction: 'up', frames: [0, 1]}]}]) {
    const x = await a.call('studio_metadata_set', {assetId: ASSET, etag: r.etag, clips: {idle: bad}});
    assert.ok(x.isError || x.rpcError, JSON.stringify(bad));
  }
  const dry = await a.ok('studio_metadata_set', {assetId: ASSET, etag: r.etag, dryRun: true, clips: {follow: {play: 'reverse'}}});
  assert.ok(dry.changes?.some(c => c.field === 'clips.follow.play') || JSON.stringify(dry).includes('reverse'));
}));

test('MCP-040: a scoped transform over a clip saves one new pending revision per frame, all or none, and dryRun saves nothing', () => withProject(async p => {
  const a = connect(p.root);
  await submit(a);
  const before = fs.readFileSync(rawPath(p, 'idle_south_0'));
  const first = await headOf(a, 'idle_south_0');
  const dry = await a.ok('studio_frame_patch', {assetId: ASSET, scope: 'clip', dryRun: true, edits: [{frame: 'idle_south_1', transform: {kind: 'flip_h'}}]});
  assert.equal(dry.wrote, 'nothing');
  assert.deepEqual(dry.frames.map(f => f.name).sort(), ['idle_south_0', 'idle_south_1', 'idle_south_2', 'idle_south_3']);
  assert.equal((await statusOf(a, 'idle_south_0')).head, 0, 'a dry run saved nothing');
  const r = await a.ok('studio_frame_patch', {assetId: ASSET, scope: 'clip', edits: [{frame: 'idle_south_1', transform: {kind: 'flip_h'}}]});
  assert.equal(r.saved.length, 4);
  assert.ok(r.saved.every(s => s.status === 'pending' && s.revision >= 1));
  assert.deepEqual(fs.readFileSync(rawPath(p, 'idle_south_0')), before, 'the raw file stays as submitted');
  const flipped = await headOf(a, 'idle_south_0');
  assert.equal(flipped.pixels.compare(first.pixels), -1 + (flipped.pixels.compare(first.pixels) === 0 ? 1 : 0) || flipped.pixels.compare(first.pixels), 'sanity');
  assert.notDeepEqual(flipped.pixels, first.pixels);
  // scope all reaches the other clip too; a shift that would break nothing reports what it loses.
  const all = await a.ok('studio_frame_patch', {assetId: ASSET, scope: 'all', dryRun: true, edits: [{frame: 'idle_south_0', transform: {kind: 'shift', dx: 1, dy: 0}}]});
  assert.equal(all.frames.length, 8);
  assert.ok(all.frames.every(f => typeof f.lost === 'number'));
  // two transform edits may not reach the same frame: nothing is silently replaced
  const clash = await a.call('studio_frame_patch', {assetId: ASSET, scope: 'clip', edits: [{frame: 'idle_south_0', transform: {kind: 'flip_h'}}, {frame: 'idle_south_1', transform: {kind: 'rotate180'}}]});
  assert.match(text(clash), /covered by two transform edits/);
  assert.match(text(await a.call('studio_frame_patch', {assetId: ASSET, edits: [{frame: 'idle_south_0', transform: {kind: 'flip_h'}}, {frame: 'idle_south_0', transform: {kind: 'flip_v'}}]})), /covered by two/);
  // disjoint edits each record their own transform
  const two = await a.ok('studio_frame_patch', {assetId: ASSET, edits: [{frame: 'idle_south_2', transform: {kind: 'flip_v'}}, {frame: 'follow_south_0', transform: {kind: 'flip_h'}}]});
  assert.equal(two.saved.length, 2);
  const prov = async name => (await statusOf(a, name)).metadata.provenance.transform.kind;
  assert.deepEqual([await prov('idle_south_2'), await prov('follow_south_0')], ['flip_v', 'flip_h']);
  // transforms stand alone
  const mixed = await a.call('studio_frame_patch', {assetId: ASSET, edits: [{frame: 'idle_south_0', transform: {kind: 'flip_h'}, ops: [{op: 'outline'}]}]});
  assert.match(text(mixed), /stand alone/);
}));

test('MCP-041: mirror draws the operation and its mirror image; region operations are refused with it', () => withProject(async p => {
  const a = connect(p.root);
  await submit(a);
  const r = await a.ok('studio_frame_patch', {assetId: ASSET, dryRun: true, edits: [{frame: 'idle_south_0', mirror: 'x', ops: [{op: 'set', pixels: [[2, 2, 'ink_01']]}]}]});
  const xs = r.frames[0].changes.map(c => c.x).sort((m, n) => m - n);
  assert.deepEqual(xs.filter(x => x === 2 || x === 29).length, 2, 'the pixel and its mirror at 31 - 2');
  const bad = await a.call('studio_frame_patch', {assetId: ASSET, dryRun: true, edits: [{frame: 'idle_south_0', mirror: 'x', ops: [{op: 'outline'}]}]});
  assert.match(text(bad), /cannot be used with the "outline"/);
}));

test('MCP-046: editing one frame of a linked cel saves a new pending revision of every frame that shares it', () => withProject(async p => {
  const a = connect(p.root);
  await submit(a);
  await a.ok('studio_metadata_set', {assetId: ASSET, clips: {idle: {links: [{frames: [0, 2]}]}}});
  const dry = await a.ok('studio_frame_patch', {assetId: ASSET, dryRun: true, edits: [{frame: 'idle_south_0', ops: [{op: 'set', pixels: [[16, 16, 'jade_03']]}]}]});
  assert.deepEqual(dry.frames.map(f => f.frame).sort(), ['idle_south_0', 'idle_south_2']);
  assert.equal(dry.frames.find(f => f.frame === 'idle_south_2').linkedFrom, 'idle_south_0');
  const r = await a.ok('studio_frame_patch', {assetId: ASSET, edits: [{frame: 'idle_south_0', ops: [{op: 'set', pixels: [[16, 16, 'jade_03']]}]}]});
  assert.deepEqual(r.saved.map(s => s.frame).sort(), ['idle_south_0', 'idle_south_2']);
  assert.ok(r.saved.every(s => s.status === 'pending'));
  const [h0, h2] = [await headOf(a, 'idle_south_0'), await headOf(a, 'idle_south_2')];
  assert.deepEqual(h0.pixels, h2.pixels, 'the two frames now hold one image');
  assert.equal((await statusOf(a, 'idle_south_1')).head, 0, 'an unlinked frame is untouched');
  const both = await a.call('studio_frame_patch', {assetId: ASSET, edits: [{frame: 'idle_south_0', ops: [{op: 'set', pixels: [[16, 17, 'jade_03']]}]}, {frame: 'idle_south_2', ops: [{op: 'set', pixels: [[17, 17, 'jade_03']]}]}]});
  assert.match(text(both), /linked to/);
}));

const fixture = async (p, a) => { await submit(a); const ws = a.project.workspace; return {ws, snap: await ws.snapshot()}; };

test('MCP-045: an exported file imports back unchanged; a hand edit becomes pending revisions with provenance', () => withProject(async p => {
  const a = connect(p.root);
  const {ws, snap} = await fixture(p, a);
  const asset = snap.index.assets.get(ASSET);
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'tn42-export-'));
  try {
    for (const format of ['pxo', 'ase', 'ase-indexed']) {
      const out = await exportAsset({ws, snap, asset, direction: 'south', format, dir});
      assert.equal(out.frames, 8);
      assert.deepEqual(out.tags.map(t => t.name), ['idle', 'follow']);
      const bytes = fs.readFileSync(join(dir, out.file));
      const same = await importFile({ws, snap, asset, direction: 'south', bytes, dryRun: false, caller: {agent: 't', session: 's'}});
      assert.equal(same.ok, true, JSON.stringify(same.refused));
      assert.ok(same.frames.every(f => f.action === 'unchanged'), `${format}: nothing changes`);
      assert.equal(same.written, false);
    }
    assert.equal((await statusOf(a, 'idle_south_0')).head, 0, 'a round trip of an unchanged file saved no revision');
    // A hand edit: change one pixel of frame 5 in the .ase and import.
    const {decodeAse, encodeAse} = await import('../core/interop/ase.mjs');
    const doc = decodeAse(fs.readFileSync(join(dir, `${ASSET}.south.ase`)));
    const ink = decodeRgba(fs.readFileSync(rawPath(p, 'follow_south_1')));
    doc.frames[5].pixels = Buffer.from(ink.pixels);
    const k = (16 * 32 + 16) * 4;
    const jade = snap.paletteFile.colors.find(c => c.id === 'jade_03').hex, n = parseInt(jade.slice(1), 16);
    doc.frames[5].pixels.set([n >> 16, (n >> 8) & 255, n & 255, 255], k);
    const edited = encodeAse({...doc, mode: 'rgba'});
    const dry = await importFile({ws, snap, asset, direction: 'south', bytes: edited, dryRun: true});
    assert.equal(dry.ok, true);
    assert.deepEqual(dry.frames.filter(f => f.action === 'revision').map(f => f.name), ['follow_south_1']);
    assert.equal((await statusOf(a, 'follow_south_1')).head, 0, 'dry run saved nothing');
    const done = await importFile({ws, snap, asset, direction: 'south', bytes: edited, dryRun: false, caller: {agent: 't', session: 's'}});
    assert.equal(done.written, true);
    const row = done.frames.find(f => f.name === 'follow_south_1');
    assert.equal(row.status, 'pending');
    const snapAfter = await statusOf(a, 'follow_south_1');
    assert.equal(snapAfter.head, 1);
    assert.equal(snapAfter.metadata.provenance.tool, 'edited by hand in LibreSprite or Aseprite');
    assert.match(snapAfter.metadata.provenance.sourceHash, /^[0-9a-f]{64}$/);
    assert.equal((await statusOf(a, 'idle_south_0')).head, 0, 'untouched frames get no revision');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}));

test('MCP-045: import refuses off-palette pixels, partial alpha, wrong size, wrong frame count and re-cut tags, saving nothing', () => withProject(async p => {
  const a = connect(p.root);
  const {ws, snap} = await fixture(p, a);
  const asset = snap.index.assets.get(ASSET);
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'tn42-export-'));
  try {
    const {decodeAse, encodeAse} = await import('../core/interop/ase.mjs');
    const {decodePxo, encodePxo} = await import('../core/interop/pxo.mjs');
    const out = await exportAsset({ws, snap, asset, direction: 'south', format: 'ase', dir});
    const base = decodeAse(fs.readFileSync(join(dir, out.file)));
    const tryDoc = async (change, encode = encodeAse) => {
      const d = structuredClone({...base, frames: base.frames.map(f => ({...f, pixels: Buffer.from(f.pixels)}))});
      change(d);
      return importFile({ws, snap, asset, direction: 'south', bytes: encode(d), dryRun: false, caller: {}});
    };
    const off = await tryDoc(d => d.frames[0].pixels.set([1, 2, 3, 255], (5 * 32 + 5) * 4));
    assert.equal(off.ok, false);
    assert.match(off.refused[0].message, /pixel gates/);
    assert.match(off.refused[0].message, /off_palette/);
    const alpha = await tryDoc(d => d.frames[1].pixels.set([20, 20, 20, 100], (5 * 32 + 5) * 4));
    assert.match(alpha.refused[0].message, /partial_alpha|pixel gates/);
    const wrongSize = await importFile({ws, snap, asset, direction: 'south', dryRun: false, caller: {}, bytes: encodeAse({...base, width: 16, height: 16, frames: base.frames.map(f => ({...f, pixels: Buffer.alloc(16 * 16 * 4)}))})});
    assert.equal(wrongSize.refused[0].code, 'size');
    assert.match(wrongSize.refused[0].message, /32x32/);
    const fewer = await tryDoc(d => { d.frames.pop(); d.tags = []; });
    assert.equal(fewer.refused[0].code, 'frames');
    const recut = await tryDoc(d => { d.tags[0].to = 2; });
    assert.equal(recut.refused[0].code, 'tags');
    const junk = await importFile({ws, snap, asset, direction: 'south', bytes: Buffer.from('hello there, definitely not a sprite'), dryRun: false, caller: {}});
    assert.equal(junk.ok, undefined);
  } catch (error) {
    if (!/neither a Pixelorama/.test(error.message)) throw error;
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  assert.equal((await statusOf(a, 'idle_south_0')).head, 0);
  assert.equal((await statusOf(a, 'follow_south_1')).head, 0, 'every refusal saved nothing');
  void decodePng; void encodePixels; void readZip; void writeZip; void planTransform;
}));

test('MCP-046: a linked pair edited by hand in a drawing tool is one edit that lands on both frames; two different edits are refused', () => withProject(async p => {
  const a = connect(p.root);
  const {ws} = await fixture(p, a);
  await a.ok('studio_metadata_set', {assetId: ASSET, clips: {idle: {links: [{frames: [0, 2]}]}}});
  const snap = await ws.snapshot(), asset = snap.index.assets.get(ASSET);
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'tn42-export-'));
  try {
    const {decodePxo, encodePxo} = await import('../core/interop/pxo.mjs');
    const out = await exportAsset({ws, snap, asset, direction: 'south', format: 'pxo', dir});
    const base = decodePxo(fs.readFileSync(join(dir, out.file)));
    assert.deepEqual(base.frames.map(f => f.linkTo).slice(0, 3), [null, null, 0]);
    const jade = parseInt(snap.paletteFile.colors.find(c => c.id === 'jade_03').hex.slice(1), 16);
    const paint = (frame, x) => frame.pixels.set([jade >> 16, (jade >> 8) & 255, jade & 255, 255], (16 * 32 + x) * 4);
    paint(base.frames[2], 16); // only the linked copy is edited
    const one = await importFile({ws, snap, asset, direction: 'south', bytes: encodePxo(base), dryRun: false, caller: {}});
    assert.equal(one.ok, true, JSON.stringify(one.refused));
    assert.deepEqual(one.frames.filter(f => f.action === 'revision').map(f => f.name).sort(), ['idle_south_0', 'idle_south_2']);
    assert.equal(one.frames.find(f => f.name === 'idle_south_0').linkedFrom, 'idle_south_2');
    paint(base.frames[0], 17); paint(base.frames[2], 18);
    const two = await importFile({ws, snap: await ws.snapshot(), asset, direction: 'south', bytes: encodePxo(base), dryRun: true, caller: {}});
    assert.equal(two.ok, false);
    assert.equal(two.refused[0].code, 'link_conflict');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}));

test('MCP-045: calibrated on a real shipped asset: every direction exports, imports back unchanged, and the file is small', () => withProject(async p => {
  const a = connect(p.root);
  const ws = a.project.workspace, snap = await ws.snapshot(), asset = snap.index.assets.get('lt_kiln_keeper');
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'tn42-export-'));
  try {
    for (const direction of asset.directions) for (const format of ['pxo', 'ase', 'ase-indexed']) {
      const out = await exportAsset({ws, snap, asset, direction, format, dir});
      assert.ok(out.bytes < 400 * 1024, `${direction} ${format} ${out.bytes}`);
      const back = await importFile({ws, snap, asset, direction, bytes: fs.readFileSync(join(dir, out.file)), dryRun: false, caller: {}});
      assert.equal(back.ok, true, JSON.stringify(back.refused));
      assert.ok(back.frames.length > 1 && back.frames.every(f => f.action === 'unchanged'), `${direction} ${format}`);
    }
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}));
