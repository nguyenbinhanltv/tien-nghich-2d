import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPackSync, validatePack } from '../pack.mjs';
import { expandArgs, generatorOf, resolveParams, runProgram, tail, toolchainPath } from '../adapters.mjs';
import { clone, realPack, root } from './helpers.mjs';

const pack = () => loadPackSync(root, undefined, {verifyFiles: false});
const issues = mutate => { const p = clone(realPack()); mutate(p); return validatePack(p); };
const gen = p => p.adapters.generators.primitives;

test('the real pack registers a generator and the SpriteFX adapter, and validates', () => {
  const p = pack();
  assert.deepEqual(Object.keys(p.adapters.generators), ['primitives']);
  assert.deepEqual(Object.keys(p.adapters.vfx.palettes), ['tien_nghich_40']);
  assert.deepEqual(validatePack(realPack()), []);
});

test('validatePack: a registry that could pass free text or an unknown name to a program is refused', () => {
  assert.match(issues(p => { gen(p).args.push('{nope}'); }).join(), /unknown placeholder \{nope\}/);
  assert.match(issues(p => { gen(p).args = gen(p).args.filter(a => a !== '{out}'); }).join(), /must pass \{out\}/);
  assert.match(issues(p => { delete gen(p).seed; }).join(), /\{seed\} used but the generator declares no seed/);
  assert.match(issues(p => { gen(p).params.note = {type: 'string'}; }).join(), /needs an "enum" or a "pattern"/);
  assert.match(issues(p => { gen(p).params.size.minimum = 99; }).join(), /minimum exceeds maximum/);
  assert.match(issues(p => { gen(p).params.size.default = 1000; }).join(), /default 1000 does not satisfy/);
  assert.match(issues(p => { gen(p).params.out = {type: 'integer'}; }).join(), /not be one of out, palette, seed/);
  assert.match(issues(p => { p.adapters.generators.Bad_Id = clone(gen(p)); }).join(), /id must match/);
  assert.match(issues(p => { gen(p).script = '/usr/bin/python3'; }).join(), /relative path inside the project/);
  assert.match(issues(p => { gen(p).script = '../outside.py'; }).join(), /relative path inside the project/);
  assert.match(issues(p => { p.adapters.vfx.clone = '/opt/spritefx'; }).join(), /adapters\.vfx\.clone/);
  assert.match(issues(p => { p.adapters.vfx.palettes['Bad Name'] = 'x.json'; }).join(), /palettes\.Bad Name/);
  assert.match(issues(p => { gen(p).extra = 1; }).join(), /extra/);
});

test('generatorOf: only registered generators exist, and the error says which', () => {
  assert.equal(generatorOf(pack(), 'primitives').script, 'tools/generators/studio_primitives.py');
  assert.throws(() => generatorOf(pack(), 'rm'), /No generator "rm".*Registered: primitives/);
  assert.throws(() => generatorOf(pack(), 'constructor'), /No generator "constructor"/);
  assert.throws(() => generatorOf(pack(), '__proto__'), /No generator/);
});

test('resolveParams: defaults, ranges, enums, patterns, unknown names and the seed', () => {
  const spec = gen(pack());
  const ok = resolveParams(spec, {shape: 'ring', size: 24});
  assert.deepEqual(ok, {values: {shape: 'ring', size: 24, fill: 'jade_04', accent: 'bronze_04', clip: 'glyph', direction: 'none', frames: 1}, seed: 1});
  assert.equal(resolveParams(spec, {shape: 'disc'}, 42).seed, 42);
  const bad = (input, seed) => () => resolveParams(spec, input, seed);
  assert.throws(bad({}), /parameter "shape" is required \(one of diamond/);
  assert.throws(bad({shape: 'cube'}), /not allowed \(one of diamond/);
  assert.throws(bad({shape: 'disc', size: 7}), /8 to 96/);
  assert.throws(bad({shape: 'disc', size: 16.5}), /not allowed/);
  assert.throws(bad({shape: 'disc', size: '16'}), /not allowed/);
  assert.throws(bad({shape: 'disc', frames: 13}), /1 to 12/);
  assert.throws(bad({shape: 'disc', extra: 1}), /unknown parameter "extra"/);
  assert.throws(bad({shape: 'disc', __proto__x: 1}), /unknown parameter/);
  for (const evil of ['jade_04; rm -rf /', '$(id)', '../../etc/passwd', 'a b', '--out=/tmp', 'jade_04\n--seed', '`x`', '']) {
    assert.throws(bad({shape: 'disc', fill: evil}), /not allowed/, JSON.stringify(evil));
    assert.throws(bad({shape: 'disc', clip: evil}), /not allowed/, JSON.stringify(evil));
  }
  assert.throws(bad({shape: 'disc'}, -1), /seed must be an integer from 0 to 4294967295/);
  assert.throws(bad({shape: 'disc'}, 2 ** 32), /seed must be/);
  assert.throws(bad({shape: 'disc'}, 1.5), /seed must be/);
  assert.throws(() => resolveParams({params: {}}, {}, 5), /takes no seed/);
});

test('expandArgs: every placeholder is one argv token; a value cannot become another argument', () => {
  const argv = expandArgs(['--a', '{x}', '--b={y}', 'plain'], {x: 'two words', y: '"quoted"; $(id)'});
  assert.deepEqual(argv, ['--a', 'two words', '--b="quoted"; $(id)', 'plain']);
  assert.throws(() => expandArgs(['{missing}'], {}), /has no value/);
  assert.deepEqual(expandArgs(['{k}'], {k: '__proto__'}), ['__proto__']);
  assert.throws(() => expandArgs(['{toString}'], {}), /has no value/, 'inherited names are not values');
});

test('toolchainPath: a missing program is a clear error naming the toolchain', () => {
  assert.match(toolchainPath(root, 'studio/audio/index.mjs', 'x'), /studio\/audio\/index\.mjs$/);
  assert.throws(() => toolchainPath(root, 'tools/.venvs/nowhere/bin/python', 'The SpriteFX interpreter'), /SpriteFX interpreter is registered as tools\/\.venvs\/nowhere\/bin\/python, which does not exist/);
});

test('runProgram: cwd, a scrubbed environment, exit codes, a timeout and an output cap', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapters-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  process.env.STUDIO_TEST_SECRET = 'hunter2';
  t.after(() => { delete process.env.STUDIO_TEST_SECRET; });
  const node = (code, extra = {}) => runProgram({file: process.execPath, argv: ['-e', code], cwd: dir, ...extra});

  const env = await node('console.log(JSON.stringify({cwd: process.cwd(), env: Object.keys(process.env).sort()}))');
  const seen = JSON.parse(env.stdout);
  assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(dir));
  assert.ok(!seen.env.includes('STUDIO_TEST_SECRET') && !seen.env.includes('HOME') && !seen.env.includes('USER'), seen.env.join());
  assert.equal(env.code, 0);

  const fail = await node('console.error("boom"); process.exit(3)');
  assert.deepEqual([fail.code, fail.stderr.trim()], [3, 'boom']);

  const slow = await node('setTimeout(() => {}, 5000)', {timeoutMs: 200});
  assert.equal(slow.timedOut, true);
  assert.ok(slow.ms < 3000);

  const loud = await node('process.stdout.write("x".repeat(100000))', {maxOutput: 1000});
  assert.equal(loud.truncated, true);

  const missing = await runProgram({file: path.join(dir, 'nope'), argv: [], cwd: dir});
  assert.match(missing.spawnError, /ENOENT/);
  assert.equal(tail('a'.repeat(5000), 10).length, 13);
  assert.equal(tail('short'), 'short');
});
