// The atlas this studio stages against the shipped atlases of this repository: read-only on the repo, everything written under a temp directory.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadPackSync } from '../pack.mjs';
import { decodeRgba, encodePixels } from '../png.mjs';
import { loadAssetIndex } from '../../mcp/asset-index.mjs';
import { REPO, HAVE_PYTHON } from '../../mcp/testkit.mjs';
import { PyFloat, pyDump, roundHalfEven } from '../atlas-formats.mjs';
import { atlasSets, chunksOf, packSet, setDir, shippedPages, usedArea } from '../atlas-sets.mjs';
import { compareDirs, compareFile, fingerprint, stagingFor } from '../atlas-proof.mjs';
import { stageAndProve, whatIf } from '../atlas-stage.mjs';

const pack = loadPackSync(REPO), index = await loadAssetIndex(pack, REPO);
const [coreSet, chunkSet] = ['core', 'longtime'].map(id => atlasSets(pack).find(s => s.id === id));
const temp = async t => { const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'atlas-proof-')); t.after(() => fs.rm(dir, {recursive: true, force: true})); return dir; };
const python = path.join(REPO, 'tools/.venvs/project/bin/python');

test('pyDump writes what Python json.dumps(indent=2) writes, including ".0" floats, sorted keys and empty containers', () => {
  assert.equal(pyDump({b: [1, 2], a: {x: new PyFloat(1), y: new PyFloat(0.5)}, e: [], o: {}, s: 'é"\n'}), '{\n  "b": [\n    1,\n    2\n  ],\n  "a": {\n    "x": 1.0,\n    "y": 0.5\n  },\n  "e": [],\n  "o": {},\n  "s": "é\\"\\n"\n}\n');
  assert.equal(pyDump({b: 1, a: 2}, {sortKeys: true}), '{\n  "a": 2,\n  "b": 1\n}\n');
  assert.equal(roundHalfEven(0.0078125, 6), 0.007812, 'ties go to the even digit, like Python round()');
  assert.equal(roundHalfEven(1 / 3, 6), 0.333333);
});

test('compareFile tells identical, equivalent and differing files apart and names the first difference', () => {
  const px = (w, h, rgba) => { const b = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) b.set(rgba, i * 4); return b; };
  const a = encodePixels(2, 2, px(2, 2, [1, 2, 3, 255]));
  assert.equal(compareFile('x.png', a, a).status, 'identical');
  const moved = px(2, 2, [1, 2, 3, 255]); moved.set([9, 9, 9, 255], 4 * 3);
  const d = compareFile('x.png', encodePixels(2, 2, moved), a);
  assert.deepEqual([d.status, d.reason, d.firstDifference.x, d.firstDifference.y], ['differs', 'pixels', 1, 1]);
  assert.equal(compareFile('x.png', encodePixels(3, 2, px(3, 2, [1, 2, 3, 255])), a).reason, 'size');
  const crlf = compareFile('x.json', Buffer.from('{\r\n"a": 1\r\n}'), Buffer.from('{\n"a": 1\n}'));
  assert.deepEqual([crlf.status, crlf.reason], ['equivalent', 'formatting']);
  const content = compareFile('x.json', Buffer.from('{"frames": {"k": {"frame": {"x": 1}}}}'), Buffer.from('{"frames": {"k": {"frame": {"x": 2}}}}'));
  assert.deepEqual([content.status, content.reason, content.firstDifference.path], ['differs', 'content', 'frames.k.frame.x']);
  const hash = compareFile('m.json', Buffer.from('{"pages": [{"png_sha256": "a", "w": 1}]}'), Buffer.from('{"pages": [{"png_sha256": "b", "w": 1}]}'));
  assert.deepEqual([hash.status, hash.reason], ['equivalent', 'png_hash']);
  assert.equal(compareFile('x.bin', Buffer.from('ab'), Buffer.from('ac')).firstDifference.offset, 1);
});

test('every shipped chunk is reproduced: page JSON and summary bytes (CRLF where the shipped file has it) are identical, page pixels are identical', async t => {
  const dir = await temp(t);
  const chunks = [];
  for (const chunk of chunksOf(chunkSet, index)) {
    const shipped = await shippedPages(REPO, pack, chunkSet, 'mobile', chunk);
    if (!shipped.pages.length) continue;
    const packed = await packSet(REPO, pack, index, chunkSet, {chunk});
    for (const [name, p] of Object.entries(packed.profiles)) {
      const staged = path.join(dir, name, chunk);
      await fs.mkdir(staged, {recursive: true});
      for (const f of p.files) await fs.writeFile(path.join(staged, f.name), f.data);
      const cmp = await compareDirs(staged, path.join(REPO, setDir(pack, chunkSet, name, chunk)));
      const real = cmp.files.filter(f => f.status === 'differs');
      assert.deepEqual(real, [], `${chunk}/${name}: ${JSON.stringify(real[0])}`);
      for (const f of cmp.files) {
        if (f.name.endsWith('.json') && f.name !== 'chunk-manifest.json') assert.equal(f.status, 'identical', `${chunk}/${name}/${f.name} must be byte-identical`);
        if (f.name.endsWith('.png')) assert.ok(['identical', 'equivalent'].includes(f.status));
      }
    }
    chunks.push(chunk);
  }
  assert.ok(chunks.length >= 7, `expected the seven shipped chunks, got ${chunks.join(', ')}`);
});

test('a chunk with frames but no shipped atlas shows every staged file as new, never as identical', async t => {
  const dir = await temp(t);
  const packed = await packSet(REPO, pack, index, chunkSet, {chunk: 'abode', only: ['mobile']});
  const staged = path.join(dir, 'x'); await fs.mkdir(staged);
  for (const f of packed.profiles.mobile.files) await fs.writeFile(path.join(staged, f.name), f.data);
  const cmp = await compareDirs(staged, path.join(dir, 'nothing-shipped'));
  assert.equal(cmp.verdict, 'differs');
  assert.ok(cmp.files.every(f => f.reason === 'extra_staged'));
});

test('staging the core atlas through the studio packer: page JSON identical, pixels identical, and pack_atlases.py --check accepts it', {skip: !HAVE_PYTHON}, async t => {
  const base = await temp(t);
  const before = await fingerprint(REPO, [...new Set(Object.values(pack.directories.atlases))]);
  const r = await stageAndProve({root: REPO, pack, index, set: coreSet, engine: 'studio', base, check: true});
  for (const [name, p] of Object.entries(r.profiles)) {
    assert.ok(['identical', 'equivalent'].includes(p.comparison.verdict), `${name}: ${JSON.stringify(p.comparison.first)}`);
    for (const f of p.comparison.files.filter(x => x.name.endsWith('.json'))) assert.equal(f.status, 'identical', `${name}/${f.name}`);
    if (name === 'web') assert.ok(p.comparison.files.some(f => f.name.endsWith('.webp') && f.status === 'not_produced'), 'the lossless WebP fallback is not written by this studio, and says so');
  }
  assert.equal(r.check.ran && r.check.ok, true, r.check.stderr);
  assert.match(r.check.stdout, /Validated \d+ frames on both profiles/);
  assert.deepEqual(r.extra.map(e => e.status), ['not_produced', 'not_produced']);
  assert.equal(r.shipped.unchanged, true);
  assert.equal(await fingerprint(REPO, [...new Set(Object.values(pack.directories.atlases))]), before, 'the shipped atlases did not change');
  // and the shipped atlases themselves still pass the project check, untouched
  execFileSync(python, ['-I', path.join(REPO, 'tools/scripts/pack_atlases.py'), '--check'], {cwd: base, stdio: 'pipe'});
});

test('a damaged staged page is reported with its first differing pixel, and the project check rejects it', {skip: !HAVE_PYTHON}, async t => {
  const base = await temp(t);
  const r = await stageAndProve({root: REPO, pack, index, set: coreSet, engine: 'studio', base});
  const mobile = path.join(r.dir, r.profiles.mobile.dir);
  const png = decodeRgba(await fs.readFile(path.join(mobile, 'atlas-0.png')));
  const frame = Object.values(JSON.parse(await fs.readFile(path.join(mobile, 'atlas-0.json'), 'utf8')).frames)[0].frame;
  const at = (frame.y * png.width + frame.x) * 4;
  png.pixels[at] ^= 0xff; png.pixels[at + 3] = 255;
  await fs.writeFile(path.join(mobile, 'atlas-0.png'), encodePixels(png.width, png.height, png.pixels));
  const cmp = await compareDirs(mobile, path.join(REPO, setDir(pack, coreSet, 'mobile')), {producedBy: n => /^atlas-\d/.test(n)});
  const bad = cmp.files.find(f => f.status === 'differs');
  assert.equal(cmp.verdict, 'differs');
  assert.deepEqual([bad.name, bad.reason, bad.firstDifference.x, bad.firstDifference.y], ['atlas-0.png', 'pixels', frame.x, frame.y]);
  const merged = path.join(base, 'merged');
  await fs.cp(path.join(REPO, pack.directories.atlases.core), merged, {recursive: true});
  await fs.copyFile(path.join(mobile, 'atlas-0.png'), path.join(merged, 'mobile/atlas-0.png'));
  assert.throws(() => execFileSync(python, ['-I', path.join(REPO, 'tools/scripts/pack_atlases.py'), '--check', '--output', merged], {stdio: 'pipe'}), /Atlas error|status 1/);
});

test('the authority (the project packer through the registered adapter) stages byte-identical atlases', {skip: !HAVE_PYTHON}, async t => {
  const base = await temp(t);
  for (const [set, chunk] of [[chunkSet, 'abode'], [coreSet, undefined]]) {
    const r = await stageAndProve({root: REPO, pack, index, set, chunk, engine: 'authority', base});
    assert.equal(r.authority.ok, true);
    for (const [name, p] of Object.entries(r.profiles)) assert.deepEqual([name, p.comparison.verdict, p.comparison.counts.differs, p.comparison.counts.equivalent], [name, 'identical', 0, 0], `${set.id} ${name}`);
    assert.ok(r.extra.every(e => e.status === 'identical'));
  }
});

test('staging never lands in a shipped directory, and what packing staged assets would change is computed without drawing pages', async t => {
  const base = await temp(t);
  await assert.rejects(stagingFor(REPO, pack, path.join(REPO, pack.directories.atlases.core), 'x'), e => e.code === 'staging_in_shipped');
  await assert.rejects(stagingFor(REPO, pack, REPO, 'assets'), e => e.code === 'staging_in_shipped', 'a directory that contains a shipped one is refused too');
  await assert.rejects(stageAndProve({root: REPO, pack, index, set: chunkSet, chunk: 'nope', base}), e => e.code === 'unknown_chunk');
  await assert.rejects(stageAndProve({root: REPO, pack, index, set: chunkSet, chunk: '../x', base}), e => e.code === 'unknown_chunk');
  const w = await whatIf(REPO, pack, index, chunkSet, 'abode');
  assert.equal(w.frames.before, 110);
  assert.equal(w.profiles.mobile.before.pages, 1);
  assert.deepEqual(w.staged, []);
});

test('used area counts what frames and their borders reserve of a page', () => {
  const page = {width: 64, height: 64, frames: [{w: 10, h: 10}, {w: 20, h: 10}]};
  const a = usedArea(page, {padding: 2, extrude: 1});
  assert.deepEqual([a.area, a.frames, a.reserved, a.unused], [4096, 300, 16 * 16 + 26 * 16, 4096 - 256 - 416]);
  assert.ok(Math.abs(a.unusedRatio - (4096 - 672) / 4096) < 1e-9);
});
