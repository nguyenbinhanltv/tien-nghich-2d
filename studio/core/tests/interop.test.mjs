// Pure parts of the timeline lane: transforms, mirror, tile mode, zip, .ase and .pxo codecs, tags and links.
import test from 'node:test';
import assert from 'node:assert/strict';
import { transformImage, mirrorOps, tileImage, seamMismatch, checkTransform } from '../transform.mjs';
import { playOrder, checkLinks, flatTimeline, groupOf, linkGroups } from '../timeline.mjs';
import { readZip, writeZip } from '../interop/zip.mjs';
import { decodeAse, encodeAse } from '../interop/ase.mjs';
import { decodePxo, encodePxo } from '../interop/pxo.mjs';

const img = (w, h, dots = []) => { const pixels = Buffer.alloc(w * h * 4); for (const [x, y, c] of dots) pixels.set([...c, 255], (y * w + x) * 4); return {width: w, height: h, pixels}; };
const at = (i, x, y) => [...i.pixels.subarray((y * i.width + x) * 4, (y * i.width + x) * 4 + 4)];
const RED = [200, 0, 0], BLUE = [0, 0, 200];

test('MCP-040: transforms flip, rotate, shift and centre move pixels and report what leaves the frame', () => {
  const a = img(4, 4, [[0, 0, RED], [3, 0, BLUE]]);
  assert.deepEqual(at(transformImage(a, {kind: 'flip_h'}).image, 3, 0), [...RED, 255]);
  assert.deepEqual(at(transformImage(a, {kind: 'flip_v'}).image, 0, 3), [...RED, 255]);
  assert.deepEqual(at(transformImage(a, {kind: 'rotate90'}).image, 3, 0), [...RED, 255], 'a quarter turn clockwise');
  assert.deepEqual(at(transformImage(a, {kind: 'rotate270'}).image, 0, 3), [...RED, 255]);
  const twice = transformImage(transformImage(a, {kind: 'rotate90'}).image, {kind: 'rotate90'}).image;
  assert.deepEqual(twice.pixels, transformImage(a, {kind: 'rotate180'}).image.pixels);
  const shifted = transformImage(a, {kind: 'shift', dx: 1, dy: 0});
  assert.equal(shifted.lost, 1, 'the blue pixel left the frame');
  assert.deepEqual(at(shifted.image, 1, 0), [...RED, 255]);
  assert.equal(transformImage(a, {kind: 'shift', dx: 1, dy: 0, wrap: true}).lost, 0);
  assert.deepEqual(at(transformImage(a, {kind: 'shift', dx: 1, dy: 0, wrap: true}).image, 0, 0), [...BLUE, 255]);
  const c = transformImage(img(6, 6, [[0, 0, RED], [1, 1, RED]]), {kind: 'centre'});
  assert.deepEqual(c.moved, [2, 2]);
  assert.deepEqual(at(c.image, 2, 2), [...RED, 255]);
  assert.throws(() => transformImage(img(4, 2), {kind: 'rotate90'}), /square/);
  assert.throws(() => checkTransform({kind: 'warp'}), /kind must be/);
  assert.throws(() => checkTransform({kind: 'shift', dx: 1.5, dy: 0}), /integer/);
  const input = img(4, 4, [[1, 1, RED]]), copy = Buffer.from(input.pixels);
  transformImage(input, {kind: 'flip_h'});
  assert.deepEqual(input.pixels, copy, 'the input is untouched');
  assert.deepEqual(at(transformImage(a, {kind: 'flip_h'}).image, 1, 1), [0, 0, 0, 0], 'transparent stays RGB 0,0,0');
});

test('MCP-041: mirror drawing doubles point operations across the middle and refuses region operations', () => {
  const set = [{op: 'set', pixels: [[1, 2, 'a']]}];
  assert.deepEqual(mirrorOps(set, 'x', 8, 8)[0].pixels, [[1, 2, 'a'], [6, 2, 'a']]);
  assert.equal(mirrorOps(set, 'xy', 8, 8)[0].pixels.length, 4);
  assert.equal(mirrorOps([{op: 'fill', box: [0, 0, 2, 2], color: 'a'}], 'x', 8, 8).length, 2);
  assert.deepEqual(mirrorOps([{op: 'line', from: [0, 0], to: [2, 0], color: 'a'}], 'x', 8, 8)[1], {op: 'line', from: [7, 0], to: [5, 0], color: 'a'});
  assert.throws(() => mirrorOps([{op: 'outline'}], 'x', 8, 8), /cannot be used/);
  assert.throws(() => mirrorOps(set, 'z', 8, 8), /mirror must be/);
});

test('MCP-042: tile mode repeats the frame and counts seam mismatches', () => {
  const t = tileImage(img(2, 2, [[0, 0, RED]]), 3, 2);
  assert.deepEqual([t.width, t.height], [6, 4]);
  assert.deepEqual(at(t, 4, 2), [...RED, 255]);
  assert.deepEqual(seamMismatch(img(2, 2, [[0, 0, RED], [1, 0, RED], [0, 1, RED], [1, 1, RED]])), {horizontal: 0, vertical: 0});
  assert.deepEqual(seamMismatch(img(4, 4, [[0, 1, RED]])), {horizontal: 1, vertical: 0});
});

test('MCP-043: a clip is a tag; play order, link groups and the flat timeline follow the asset', () => {
  assert.deepEqual(playOrder(4, 'forward'), [0, 1, 2, 3]);
  assert.deepEqual(playOrder(4, 'reverse'), [3, 2, 1, 0]);
  assert.deepEqual(playOrder(4, 'pingpong'), [0, 1, 2, 3, 2, 1]);
  const asset = {clips: {idle: {frames: 3, frameMs: 100}, walk: {frames: 2, frameMs: [80, 120]}}};
  const meta = {clips: {idle: {play: 'pingpong', links: [{frames: [0, 2]}]}}};
  const flat = flatTimeline(asset, meta, 'south');
  assert.deepEqual(flat.tags, [{name: 'idle', from: 0, to: 2, play: 'pingpong'}, {name: 'walk', from: 3, to: 4, play: 'forward'}]);
  assert.deepEqual(flat.frames.map(f => [f.durationMs, f.linkTo]), [[100, null], [100, null], [100, 0], [80, null], [120, null]]);
  assert.deepEqual(groupOf(linkGroups(meta.clips.idle, 'south'), 2), [0, 2]);
  assert.deepEqual(groupOf([], 1), [1]);
  const ctx = {frames: 4, directions: ['south', 'west'], clip: 'idle'};
  checkLinks([{frames: [0, 1]}], ctx);
  assert.throws(() => checkLinks([{frames: [0]}], ctx), /2 or more/);
  assert.throws(() => checkLinks([{frames: [0, 9]}], ctx), /from 0 to 3/);
  assert.throws(() => checkLinks([{frames: [0, 1]}, {direction: 'south', frames: [1, 2]}], ctx), /two groups/);
  assert.throws(() => checkLinks([{direction: 'up', frames: [0, 1]}], ctx), /direction/);
});

test('MCP-044: the zip reader reads what the writer wrote and refuses unsafe archives', () => {
  const zip = writeZip([{name: 'a.txt', data: Buffer.from('hello hello hello hello')}, {name: 'dir/b.bin', data: Buffer.alloc(50, 7), store: true}]);
  assert.deepEqual(writeZip([{name: 'a.txt', data: Buffer.from('hello hello hello hello')}, {name: 'dir/b.bin', data: Buffer.alloc(50, 7), store: true}]), zip, 'deterministic');
  const files = readZip(zip);
  assert.equal(files.get('a.txt').toString(), 'hello hello hello hello');
  assert.equal(files.get('dir/b.bin').length, 50);
  assert.throws(() => readZip(Buffer.from('not a zip at all, really not a zip')), /ZIP/);
  assert.throws(() => readZip(writeZip([{name: '../evil', data: Buffer.from('x')}])), /unsafe/);
  const stored = writeZip([{name: 'x', data: Buffer.from('abcdef'), store: true}]);
  stored[stored.indexOf(Buffer.from('abcdef'))] ^= 1;
  assert.throws(() => readZip(stored), /checksum/);
});

const doc = () => {
  const frames = [0, 1, 2].map(i => img(4, 4, [[i, i, RED], [3, 3, BLUE]]));
  return {width: 4, height: 4, mode: 'rgba', palette: [RED, BLUE],
    frames: frames.map((f, i) => ({pixels: i === 2 ? frames[0].pixels : f.pixels, durationMs: 100 + i * 20, linkTo: i === 2 ? 0 : null})),
    tags: [{name: 'idle', from: 0, to: 1, play: 'pingpong'}, {name: 'walk', from: 2, to: 2, play: 'reverse'}]};
};

test('MCP-045: an .ase round trip returns the same frames byte for byte, in RGBA and indexed, with tags, durations and linked cels', () => {
  const d = doc();
  for (const mode of ['rgba', 'indexed']) {
    const bytes = encodeAse({...d, mode});
    assert.deepEqual(encodeAse({...d, mode}), bytes, 'deterministic');
    const back = decodeAse(bytes);
    assert.equal(back.mode, mode);
    d.frames.forEach((f, i) => assert.deepEqual(back.frames[i].pixels, f.pixels, `${mode} frame ${i}`));
    assert.deepEqual(back.frames.map(f => f.durationMs), [100, 120, 140]);
    assert.deepEqual(back.frames.map(f => f.linkTo), [null, null, 0]);
    assert.deepEqual(back.tags, d.tags);
    assert.deepEqual(encodeAse({...back, mode, palette: d.palette}), bytes, `${mode}: decode then encode is the same file`);
  }
  assert.throws(() => encodeAse({...d, mode: 'indexed', palette: [RED]}), /not in the palette/);
  assert.throws(() => decodeAse(Buffer.alloc(200)), /not an Aseprite/);
});

test('MCP-045: the .ase header and chunks follow the published layout', () => {
  const b = encodeAse(doc());
  assert.equal(b.readUInt32LE(0), b.length);
  assert.equal(b.readUInt16LE(4), 0xa5e0);
  assert.equal(b.readUInt16LE(6), 3);
  assert.deepEqual([b.readUInt16LE(8), b.readUInt16LE(10), b.readUInt16LE(12)], [4, 4, 32]);
  assert.equal(b.readUInt16LE(128 + 4), 0xf1fa, 'first frame magic');
  assert.equal(b.readUInt16LE(128 + 8), 100, 'first frame duration');
  assert.equal(b.readUInt16LE(128 + 16 + 4), 0x2004, 'the first chunk is the layer');
});

test('MCP-045: .ase import refuses what a clip cannot hold, with the reason', () => {
  const bytes = encodeAse(doc());
  const pong = Buffer.from(bytes);
  // Turn the first tag's direction into 3 (ping-pong reverse): find the tag chunk.
  let p = 128 + 16, found = false;
  while (p < bytes.length && !found) { const size = bytes.readUInt32LE(p), type = bytes.readUInt16LE(p + 4); if (type === 0x2018) { pong[p + 6 + 10 + 4] = 3; found = true; } p += size; }
  assert.ok(found);
  assert.throws(() => decodeAse(pong), /ping-pong reverse/);
});

test('MCP-045: .ase import bounds cels: one cel larger than the limit, or many that add up, are refused before they unpack', () => {
  const d = doc(), good = encodeAse(d);
  // Rewrite the first cel to declare 4096x4096 (its compressed data stays tiny): refused by size, not unpacked.
  const huge = Buffer.from(good);
  let p = 128 + 16, done = false;
  while (!done) { const size = huge.readUInt32LE(p); if (huge.readUInt16LE(p + 4) === 0x2005) { huge.writeUInt16LE(4096, p + 6 + 16); huge.writeUInt16LE(4096, p + 6 + 18); done = true; } p += size; }
  assert.throws(() => decodeAse(huge), /cel; the limit is/);
  // Many cels each within the per-cel limit, but a total over the cap.
  const big = {width: 1024, height: 1024, mode: 'rgba', palette: [], tags: [], frames: Array.from({length: 40}, () => ({pixels: Buffer.alloc(1024 * 1024 * 4), durationMs: 100, linkTo: null}))};
  assert.throws(() => decodeAse(encodeAse(big)), /(too large|in all)/);
});

test('MCP-045: a .pxo round trip returns the same frames byte for byte, with tags, durations and links', () => {
  const d = doc();
  const bytes = encodePxo(d);
  assert.deepEqual(encodePxo(d), bytes, 'deterministic');
  const files = readZip(bytes);
  const data = JSON.parse(files.get('data.json'));
  assert.equal(data.pxo_version, 8);
  assert.deepEqual([data.size_x, data.size_y], [4, 4]);
  assert.deepEqual(data.tags.map(t => [t.from, t.to]), [[1, 2], [3, 3]], 'tags are 1-based and inclusive');
  assert.ok(files.has('image_data/frames/1/layer_1') && files.has('image_data/frames/3/layer_1'), 'cel files are 1-based');
  assert.equal(files.get('image_data/frames/1/layer_1').length, 64, 'raw RGBA, not PNG');
  const back = decodePxo(bytes);
  d.frames.forEach((f, i) => assert.deepEqual(back.frames[i].pixels, f.pixels, `frame ${i}`));
  assert.deepEqual(back.frames.map(f => [f.durationMs, f.linkTo]), [[100, null], [120, null], [140, 0]]);
  assert.deepEqual(back.tags, d.tags);
  assert.throws(() => decodePxo(writeZip([{name: 'x', data: Buffer.from('1')}])), /data\.json/);
  const wrong = readZip(bytes); wrong.set('image_data/frames/2/layer_1', Buffer.alloc(10));
  assert.throws(() => decodePxo(writeZip([...wrong].map(([name, data]) => ({name, data})))), /bytes of pixels/);
});
