import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPackSync, paramValueOk, validatePack } from '../pack.mjs';
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

// ---- hardening --------------------------------------------------------------------------------------

test('validatePack: a string pattern must be anchored at both ends, and is matched against the whole value', () => {
  const withPattern = pattern => issues(p => { gen(p).params.fill.pattern = pattern; delete gen(p).params.fill.default; });
  assert.match(withPattern('[a-z]+').join(), /pattern must be anchored at both ends/);
  assert.match(withPattern('^[a-z]+').join(), /anchored/);
  assert.match(withPattern('[a-z]+$').join(), /anchored/);
  assert.match(withPattern('^[a-z]+\\$').join(), /anchored/, 'an escaped $ is a literal dollar, not an anchor');
  assert.match(withPattern('^($').join(), /not a valid regular expression/);
  assert.deepEqual(withPattern('^[a-z]+$'), []);
  assert.deepEqual(withPattern('^[a-z]+\\\\$'), [], 'an escaped backslash followed by a real $ is anchored');
  // Even an alternation that is anchored only at its outer ends cannot let a part match: the whole value is tested.
  assert.equal(paramValueOk({type: 'string', pattern: '^a|b$'}, 'a-and-more'), false);
  assert.equal(paramValueOk({type: 'string', pattern: '^a|b$'}, 'a'), true);
  assert.equal(paramValueOk({type: 'string', pattern: '^[a-z]+$'}, 'abc\n'), false);
  assert.equal(paramValueOk({type: 'string', pattern: '^[a-z]+$'}, 'xx abc'), false);
});

test('resolveParams: a text value starting with "-" is refused whatever the pattern allows', () => {
  const spec = {params: {word: {type: 'string', pattern: '^[-a-z]+$'}}, args: ['--w', '{word}']};
  assert.deepEqual(resolveParams(spec, {word: 'a-b'}).values, {word: 'a-b'});
  for (const v of ['-x', '--out', '-', '--']) assert.throws(() => resolveParams(spec, {word: v}), /may not start with "-"/, v);
  assert.throws(() => resolveParams({params: {word: {type: 'string', enum: ['-x']}}}, {word: '-x'}), /may not start with "-"/, 'an enum member too');
  assert.throws(() => resolveParams({params: {word: {type: 'string', pattern: '^.+$', default: '-d'}}}, {}), /may not start with "-"/, 'and a default');
});

test('validatePack: a parameter placeholder follows its own flag token or is exactly --flag={name}', () => {
  const args = a => issues(p => { gen(p).args = a; });
  const base = ['--out', '{out}', '--shape', '{shape}', '--size', '{size}', '--fill', '{fill}', '--accent', '{accent}', '--clip', '{clip}', '--direction', '{direction}', '--frames', '{frames}', '--seed', '{seed}', '--palette', '{palette}'];
  assert.deepEqual(args(base), []);
  assert.deepEqual(args(base.map(a => (a === '{shape}' ? '{shape}' : a)).filter(a => a !== '--shape' && a !== '{shape}').concat('--shape={shape}')), [], '--flag={name} is fine');
  const without = (flag, ph) => base.filter(a => a !== flag && a !== ph);
  assert.match(args(['{shape}', ...without('--shape', '{shape}')]).join(), /args\[0\]: parameter \{shape\} must come right after its own flag/, 'first token');
  assert.match(args(['--out', '{out}', '{shape}', ...without('--shape', '{shape}').slice(2)]).join(), /parameter \{shape\} must come right after its own flag/, 'after a value, not a flag');
  assert.match(args([...without('--shape', '{shape}'), 'x{shape}']).join(), /must be a whole token after a flag, or exactly --flag=\{name\}/, 'glued to text');
  assert.match(args([...without('--shape', '{shape}'), '--shape={shape}x']).join(), /exactly --flag=/);
  assert.match(args([...without('--shape', '{shape}'), '-s{shape}']).join(), /exactly --flag=/);
  assert.match(args([...without('--shape', '{shape}'), '{shape}{size}']).join(), /exactly --flag=|whole token/);
  assert.match(args([...without('--shape', '{shape}'), '{size}']).join(), /parameter \{size\} must come right after/, 'its predecessor is a value, not a flag');
});

test('an argument value with spaces, quotes, ;, $( ) or a newline is exactly one argv token, or refused', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'argv-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const script = path.join(dir, 'argv.mjs');
  fs.writeFileSync(script, 'console.log(JSON.stringify(process.argv.slice(2)))');
  const nasty = ['a b', 'say "hi"', "it's", 'x; touch pwned', '$(touch pwned)', '`touch pwned`', 'line1\nline2', 'a|b&c>d', '*', '~'];
  const spec = {params: {text: {type: 'string', pattern: '^[^]+$'}}, args: ['--text', '{text}', '--t={text}']};
  for (const value of nasty) {
    const {values} = resolveParams(spec, {text: value});
    const argv = expandArgs(spec.args, values);
    const r = await runProgram({file: process.execPath, argv: [script, ...argv], cwd: dir});
    assert.deepEqual(JSON.parse(r.stdout), ['--text', value, `--t=${value}`], JSON.stringify(value));
  }
  assert.equal(fs.existsSync(path.join(dir, 'pwned')), false, 'no shell ever saw a value');
  // Through the real generator's patterns the same strings are refused outright.
  for (const value of nasty) assert.throws(() => resolveParams(gen(pack()), {shape: 'disc', clip: value}), /not allowed/, JSON.stringify(value));
});

test('a timeout kills the whole process group, not just the direct child (POSIX)', { skip: process.platform === 'win32' && 'POSIX process groups' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgroup-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const pidFile = path.join(dir, 'sleeper.pid');
  // The program starts a sleeper that would outlive it for a minute, then waits.
  const code = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setTimeout(()=>{},60000)`;
  const r = await runProgram({file: process.execPath, argv: ['-e', code], cwd: dir, timeoutMs: 700});
  assert.equal(r.timedOut, true);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(pid > 0);
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && alive(); i++) await new Promise(res => setTimeout(res, 50));
  if (alive()) { process.kill(pid, 'SIGKILL'); assert.fail('the sleeper started by the program survived the timeout'); }
});

test('output over the cap also stops the program and what it started', { skip: process.platform === 'win32' && 'POSIX process groups' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgroup2-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const pidFile = path.join(dir, 'sleeper.pid');
  const code = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));process.stdout.write('x'.repeat(200000));setTimeout(()=>{},60000)`;
  const r = await runProgram({file: process.execPath, argv: ['-e', code], cwd: dir, maxOutput: 1000, timeoutMs: 20000});
  assert.equal(r.truncated, true);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && alive(); i++) await new Promise(res => setTimeout(res, 50));
  if (alive()) { process.kill(pid, 'SIGKILL'); assert.fail('the sleeper survived the output cap'); }
});

test('validatePack: the figures block (readability guides) is checked, and the real one is valid', () => {
  assert.deepEqual(validatePack(realPack()), []);
  const f = mutate => issues(p => { mutate(p.figures.humanoid); });
  assert.match(f(g => { g.profiles = []; }).join(), /figures\.humanoid\.profiles: needs at least 1 item/);
  assert.match(f(g => { g.headToBody = { min: 0.6, max: 0.4, target: 0.5 }; }).join(), /headToBody: needs 0 < min < max <= 1 and a target between them/);
  assert.match(f(g => { g.headToBody.target = 0.9; }).join(), /headToBody/);
  assert.match(f(g => { g.minLimbWidthPx = 0; }).join(), /minLimbWidthPx: must be >= 1/);
  assert.match(f(g => { g.accentMinPixels = 2.5; }).join(), /accentMinPixels: expected integer/);
  assert.match(f(g => { g.guide.bodyWidth = 0.2; }).join(), /two legs and their gap are wider than the body/);
  assert.match(f(g => { g.guide.headWidth = 1.5; }).join(), /guide\.headWidth: must be a number above 0 and at most 1/);
  assert.match(issues(p => { p.figures.Bad = clone(p.figures.humanoid); }).join(), /name must be lowercase/);
  assert.deepEqual(issues(p => { delete p.figures; }), [], 'the block is optional');
});

test('validatePack: a number that can be negative may not be a separate token ("-5" reads as an option); --flag={name} is fine', () => {
  const args = (mutate, a) => issues(p => { mutate(gen(p)); gen(p).args = a ?? gen(p).args; });
  const swap = (from, to) => gen(pack()).args.map(a => (a === from ? to : a));
  assert.match(args(g => { delete g.params.size.minimum; }).join(), /parameter \{size\} can be negative .*--name=\{size\}/, 'no minimum at all');
  assert.match(args(g => { g.params.size.minimum = -4; g.params.size.maximum = 96; delete g.params.size.default; }).join(), /can be negative/);
  assert.deepEqual(args(g => { g.params.size.minimum = 0; }), [], 'a minimum of 0 or more is fine');
  const embedded = gen(pack()).args.flatMap((a, i, all) => (all[i - 1] === '--size' ? [] : a === '--size' ? ['--size={size}'] : [a]));
  assert.deepEqual(args(g => { delete g.params.size.minimum; }, embedded), [], 'embedded as --size={size} a negative value cannot be read as a separate option');
  assert.deepEqual(args(() => {}), [], 'the real registration still passes');
});

test('runProgram: what the leader leaves running is stopped when the leader exits, and the call does not wait for it', { skip: process.platform === 'win32' && 'POSIX process groups' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const pidFile = path.join(dir, 'sleeper.pid');
  // The grandchild inherits our output pipes and would keep them open for a minute; the leader exits at once.
  const code = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:['ignore','inherit','inherit']});c.unref();require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));`;
  const r = await runProgram({file: process.execPath, argv: ['-e', code], cwd: dir, timeoutMs: 20000});
  assert.equal(r.timedOut, false);
  assert.equal(r.code, 0);
  assert.ok(r.ms < 10000, `returned in ${r.ms} ms, not after the sleeper's minute`);
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 40 && alive(); i++) await new Promise(res => setTimeout(res, 50));
  if (alive()) { process.kill(pid, 'SIGKILL'); assert.fail('the leftover grandchild survived the leader'); }
});

test('runProgram: programs still running when the server is stopped are stopped with it (SIGTERM)', { skip: process.platform === 'win32' && 'POSIX process groups' }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  const pidFile = path.join(dir, 'prog.pid');
  const host = path.join(dir, 'host.mjs');
  const adaptersUrl = new URL('../adapters.mjs', import.meta.url).href;
  const program = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(() => {}, 60000)`;
  fs.writeFileSync(host, `import {runProgram} from ${JSON.stringify(adaptersUrl)};
    runProgram({file: process.execPath, argv: ['-e', ${JSON.stringify(program)}], cwd: ${JSON.stringify(dir)}, timeoutMs: 60000});
    setTimeout(() => {}, 60000);`);
  const {spawn} = await import('node:child_process');
  const server = spawn(process.execPath, [host], {stdio: 'ignore'});
  for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise(res => setTimeout(res, 50));
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  assert.ok(pid > 0);
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(), true, 'the program is running');
  const exited = new Promise(res => server.on('exit', (code, signal) => res(signal)));
  server.kill('SIGTERM');
  assert.equal(await exited, 'SIGTERM', 'the server still dies of the signal');
  for (let i = 0; i < 60 && alive(); i++) await new Promise(res => setTimeout(res, 50));
  if (alive()) { process.kill(pid, 'SIGKILL'); assert.fail('the program outlived the server'); }
});
