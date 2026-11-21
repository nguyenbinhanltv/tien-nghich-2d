// The JS pixel gate must agree with tools/scripts/validate_palette.py on real frames and samples.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadPack, parsePalette } from '../pack.mjs';
import { checkPng, checkPixels, gateOptions } from '../gates.mjs';
import { decodeRgba, encodePixels, normalizePng } from '../png.mjs';
import { root } from './helpers.mjs';

const python = path.join(root, 'tools/.venvs/project/bin/python');
const havePython = fs.existsSync(python);
const skip = havePython ? false : 'tools/.venvs/project python is not available';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) walk(path.join(dir, e.name), out);
    else if (e.name.endsWith('.png')) out.push(path.join(dir, e.name));
  }
  return out;
}

// Parse validate_palette.py output into [{file, pass, errors, warnings}].
function runPython(files, extra = []) {
  let stdout;
  try { stdout = execFileSync(python, ['-I', path.join(root, 'tools/scripts/validate_palette.py'), ...extra, ...files], {encoding: 'utf8'}); }
  catch (error) { stdout = error.stdout; }
  const results = [];
  for (const line of stdout.split('\n')) {
    if (/^(PASS|FAIL) /.test(line)) results.push({file: line.slice(5), pass: line.startsWith('PASS'), errors: [], warnings: []});
    else if (line.startsWith('   error: ')) results.at(-1).errors.push(line.slice(10));
    else if (line.startsWith('   warn:  ')) results.at(-1).warnings.push(line.slice(10));
  }
  return results;
}

async function setup() {
  const pack = await loadPack(root);
  const palette = parsePalette(JSON.parse(fs.readFileSync(path.join(root, pack.palette.file), 'utf8')));
  return {pack, palette};
}

function compare(files, opts, extra) {
  const expected = runPython(files, extra);
  assert.equal(expected.length, files.length);
  files.forEach((file, i) => {
    const got = checkPng(fs.readFileSync(file), opts);
    assert.deepEqual({errors: got.errors, warnings: got.warnings}, {errors: expected[i].errors, warnings: expected[i].warnings}, file);
    assert.equal(got.errors.length === 0, expected[i].pass, file);
  });
}

test('JS gate agrees with validate_palette.py on real frames', {skip}, async () => {
  const {pack, palette} = await setup();
  // Processed frames mostly pass; raw frames and the QA fixtures exercise failures too.
  const all = [...walk(path.join(root, 'assets/processed')), ...walk(path.join(root, 'assets/raw'))];
  const files = all.filter((_, i) => i % 29 === 0).slice(0, 150);
  assert.ok(files.length >= 50);
  compare(files, gateOptions(pack, palette), []);
  compare(files, gateOptions(pack, palette, {outlineOptional: true}), ['--outline-optional']);
  compare(files, {...gateOptions(pack, palette), borderIsEdge: true}, ['--border-is-edge']);
  compare(files, gateOptions(pack, palette, {sizeClass: 'character'}), ['--class', 'character']);
});

test('JS gate agrees with validate_palette.py on the make_sample_png.py samples', {skip}, async t => {
  const {pack, palette} = await setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-gates-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  execFileSync(python, ['-I', path.join(root, 'tools/scripts/make_sample_png.py'), dir]);
  const files = ['good.png', 'bad_color.png', 'bad_outline.png'].map(f => path.join(dir, f));
  compare(files, gateOptions(pack, palette), []);
  compare(files, gateOptions(pack, palette, {sizeClass: 'character'}), ['--class', 'character']);
  compare(files, gateOptions(pack, palette, {sizeClass: 'tile'}), ['--class', 'tile']);
  const [good, color, outline] = files.map(f => checkPng(fs.readFileSync(f), gateOptions(pack, palette)));
  assert.deepEqual(good.errors, []);
  assert.match(color.errors[0], /off-palette color #123456/);
  assert.match(outline.errors.join('\n'), /edge pixel\(s\) are not outline #14101a/);
});

test('JS gate flags soft alpha, empty images and unreadable files', async () => {
  const {pack, palette} = await setup();
  const opts = gateOptions(pack, palette);
  const px = Buffer.alloc(4 * 4 * 4);
  assert.deepEqual(checkPixels({width: 4, height: 4, pixels: px}, opts).errors, ['no opaque pixels / no silhouette edge found']);
  px.set([0x14, 0x10, 0x1a, 128], 0);
  assert.match(checkPixels({width: 4, height: 4, pixels: px}, opts).errors.join(), /1 semi-transparent pixel/);
  assert.match(checkPng(Buffer.from('nope'), opts).errors[0], /^cannot read/);
});

test('decodeRgba refuses truncated and oversized images instead of allocating', () => {
  const real = encodePixels(2, 2, Buffer.alloc(16));
  assert.throws(() => decodeRgba(real.subarray(0, real.length - 22)), /truncated|compressed|scanline/);
  const huge = Buffer.from(real);
  huge.writeUInt32BE(100000, 16);
  huge.writeUInt32BE(100000, 20);
  assert.throws(() => decodeRgba(huge), /out of bounds/);
});

test('normalizePng keeps rejecting off-palette pixels and re-encodes canonically', async () => {
  const {palette} = await setup();
  const px = Buffer.alloc(4 * 4);
  px.set([0x14, 0x10, 0x1a, 255], 0);
  const ok = encodePixels(2, 2, px);
  assert.ok(normalizePng(ok, 2, 2, palette.colors).equals(ok));
  px.set([1, 2, 3, 255], 4);
  assert.throws(() => normalizePng(encodePixels(2, 2, px), 2, 2, palette.colors), {code: 'invalid_png'});
});
