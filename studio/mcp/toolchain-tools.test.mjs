import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { HAVE_PYTHON, HAVE_SPRITEFX, REPO, connect, makeProject } from './testkit.mjs';

const text = (r) => r.content?.[0]?.text ?? '';
const ICON = 'lt_icon_realm_step'; // planned, 16x16, one clip "glyph" with one frame
const skipPy = HAVE_PYTHON ? false : 'the project Python environment is not available';
const skipFx = HAVE_SPRITEFX ? false : 'the SpriteFX environment is not available';
const withProject = async (fn, opts = {}) => { const p = makeProject({ git: false, toolchain: true, ...opts }); try { return await fn(p); } finally { await p.cleanup(); } };
const raw = (p, id = ICON) => join(p.root, 'assets/raw/longtime', id);

/** Register one more generator in a temp project's pack (only the temp copy changes). */
function register(p, id, script, source, extra = {}) {
  const file = join(p.root, 'studio.project.json');
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(join(p.root, 'tools/generators', script), source);
  pack.adapters.generators[id] = { script: `tools/generators/${script}`, args: ['--out', '{out}'], timeoutSec: 5, ...extra };
  fs.writeFileSync(file, JSON.stringify(pack, null, 2));
}
const PNG_WRITER = (body) => `import sys, struct, zlib, os, random\nout = sys.argv[sys.argv.index('--out') + 1]\nos.makedirs(out, exist_ok=True)\ndef png(path, w, h, px):\n    raw = b''.join(b'\\x00' + b''.join(bytes(px(x, y)) for x in range(w)) for y in range(h))\n    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d))\n    open(path, 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))\n${body}\n`;

test('generator_run: a registered generator, run twice, judged by the gates, nothing committed unless asked', { skip: skipPy }, () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const r = await a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', params: { shape: 'diamond', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 7 });
  assert.equal(r.isError, undefined, text(r));
  assert.deepEqual(r.content.map((c) => c.type), ['text', 'image']);
  const s = r.structuredContent;
  assert.equal(s.deterministic, true);
  assert.deepEqual(s.files.map((f) => f.name), ['glyph_none_0']);
  assert.deepEqual(s.defects, { errors: 0, warnings: 0 });
  assert.equal(s.seed, 7);
  assert.equal(s.params.size, 16);
  assert.match(s.scriptSha256, /^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(raw(p)), false, 'a trial run commits nothing');
  // The same arguments give the same bytes, run after run.
  assert.equal((await a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', params: { shape: 'diamond', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 7 })).structuredContent.files[0].sha256, s.files[0].sha256);
  assert.notEqual((await a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', params: { shape: 'diamond', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 8 })).structuredContent.files[0].sha256, s.files[0].sha256, 'the seed matters');

  const sub = await a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', params: { shape: 'diamond', size: 16, fill: 'jade_03', accent: 'bronze_04' }, seed: 7, submit: true });
  assert.equal(sub.isError, undefined, text(sub));
  assert.deepEqual(sub.structuredContent.submit.written, [`assets/raw/longtime/${ICON}/frames/glyph_none_0.png`]);
  const log = fs.readFileSync(join(raw(p), 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)[0];
  assert.equal(log.generator, 'tools/generators/studio_primitives.py');
  assert.equal(log.sourceHash, s.scriptSha256, 'provenance carries the hash of the generator script');
  assert.match(log.notes, /params \{"shape":"diamond","size":16.*seed 7; deterministic/);
  assert.equal(log.agent, 'codex');
  assert.equal((await a.ok('studio_qa_run', { assetId: ICON })).pass, true);
  assert.deepEqual((await a.ok('studio_review_list', { assetId: ICON, detail: 'full' })).byStatus, { pending: 1 });
}));

test('generator_run: only registered generators; parameters are validated; text never reaches a program', { skip: skipPy }, () => withProject(async (p) => {
  const a = connect(p.root);
  const marker = join(p.root, 'pwned');
  const run = (args) => a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', ...args }).then(text);
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: 'rm' }).then(text), /No generator "rm" is registered.*Registered: primitives/);
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: 'bash -c id' }).then(text), /Invalid arguments|No generator/);
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: '__proto__' }).then(text), /No generator/);
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', command: 'id' }).then(text), /unexpected property "command"/);
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', args: ['--out', '/tmp'] }).then(text), /unexpected property "args"/);
  assert.match(await run({ params: {} }), /parameter "shape" is required/);
  assert.match(await run({ params: { shape: 'cube' } }), /not allowed \(one of diamond/);
  assert.match(await run({ params: { shape: 'disc', size: 4 } }), /8 to 96/);
  assert.match(await run({ params: { shape: 'disc', frames: 40 } }), /1 to 12/);
  assert.match(await run({ params: { shape: 'disc', verbose: true } }), /unknown parameter "verbose"/);
  assert.match(await run({ params: { shape: 'disc', out: '/etc' } }), /unknown parameter "out"/, 'the output directory is not a parameter');
  assert.match(await run({ params: { shape: 'disc', palette: '/etc/passwd' } }), /unknown parameter "palette"/);
  assert.match(await run({ params: { shape: 'disc' }, seed: 2 ** 33 }), /Invalid arguments|seed must be/);
  for (const evil of [`jade_03; touch ${marker}`, `$(touch ${marker})`, '../../x', 'jade_03 --out /tmp', '--out=/tmp', 'a\nb']) {
    assert.match(await run({ params: { shape: 'disc', fill: evil } }), /not allowed/, evil);
    assert.match(await run({ params: { shape: 'disc', clip: evil } }), /not allowed/, evil);
  }
  assert.equal(fs.existsSync(marker), false, 'nothing was executed');
  assert.match(await run({ params: { shape: 'disc', fill: 'ghost_99', size: 16 } }), /generator primitives failed \(exit \d+\): .*not in the palette/s, 'a colour the palette lacks fails inside the generator, loudly');
  const read = connect(p.root, { scope: 'read' });
  assert.match(await read.call('studio_generator_run', { assetId: ICON, generator: 'primitives', params: { shape: 'disc' } }).then(text), /needs scope "author"/);
  assert.equal(fs.existsSync(raw(p)), false);
}));

test('generator_run: submit is refused for wrong sizes, wrong frames, unnamed output and non-deterministic generators', { skip: skipPy }, () => withProject(async (p) => {
  const a = connect(p.root);
  const prim = (params, extra = {}) => a.call('studio_generator_run', { assetId: ICON, generator: 'primitives', params: { shape: 'ring', fill: 'jade_03', ...params }, submit: true, ...extra });
  const wrongSize = await prim({ size: 24 });
  assert.equal(wrongSize.isError, true);
  assert.match(JSON.stringify(wrongSize.structuredContent.submit.frames), /canvas 24x24 does not match the icon profile \(16x16\)/);
  const tooMany = await prim({ size: 16, frames: 3 });
  assert.equal(tooMany.isError, true);
  assert.match(text(tooMany) + JSON.stringify(tooMany.structuredContent), /clip glyph has 1 frames; n must be 0 to 0|Invalid|n must be/);
  const wrongClip = await prim({ size: 16, clip: 'blink' });
  assert.match(text(wrongClip) + JSON.stringify(wrongClip.structuredContent), /no clip "blink"/);
  assert.equal(fs.existsSync(raw(p)), false, 'no refused submit wrote anything');

  register(p, 'flaky', 'flaky.py', PNG_WRITER("png(os.path.join(out, 'glyph_none_0.png'), 16, 16, lambda x, y: (random.randrange(256), 0, 0, 0))"));
  const flaky = await a.call('studio_generator_run', { assetId: ICON, generator: 'flaky', submit: true });
  assert.equal(flaky.structuredContent.deterministic, false);
  assert.equal(flaky.isError, true);
  assert.match(flaky.structuredContent.submit.message, /not deterministic/);

  register(p, 'misnamed', 'misnamed.py', PNG_WRITER("png(os.path.join(out, 'logo.png'), 16, 16, lambda x, y: (0, 0, 0, 0))"));
  const misnamed = await a.call('studio_generator_run', { assetId: ICON, generator: 'misnamed', submit: true });
  assert.equal(misnamed.structuredContent.unmapped[0].name, 'logo');
  assert.match(misnamed.structuredContent.submit.message, /not frames \(logo\)/);

  register(p, 'broken', 'broken.py', "import sys\nsys.stderr.write('kaboom detail')\nsys.exit(4)\n");
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: 'broken' }).then(text), /failed \(exit 4\): kaboom detail/);
  register(p, 'silent', 'silent.py', 'pass\n');
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: 'silent' }).then(text), /wrote no PNG frames/);
  register(p, 'hang', 'hang.py', 'import time\ntime.sleep(60)\n', { timeoutSec: 1 });
  assert.match(await a.call('studio_generator_run', { assetId: ICON, generator: 'hang' }).then(text), /did not finish in 1 s and was stopped/);
  assert.equal(fs.existsSync(raw(p)), false);
}));

test('generator_run: a missing toolchain is a plain message, not a crash', () => withProject(async (p) => {
  fs.rmSync(join(p.root, 'tools/.venvs'), { recursive: true, force: true });
  const r = await connect(p.root).call('studio_generator_run', { assetId: ICON, generator: 'primitives', params: { shape: 'disc', size: 16 } });
  assert.equal(r.isError, true);
  assert.match(text(r), /The Python interpreter is registered as tools\/\.venvs\/project\/bin\/python, which does not exist on this machine/);
}));

// ---- custom plans ------------------------------------------------------------------------------
const FX = 'lt_fx_test_spark';
const spec = () => JSON.parse(fs.readFileSync(join(REPO, 'tools/generators/vfx_specs/hit_spark.json'), 'utf8')); // 12 ticks, 32x32
const planFx = (a, over = {}, id = FX) => a.call('studio_asset_plan', { op: 'create', id, chunk: 'wards', brief: 'A test spark.',
  custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { play: { frames: 12, frameMs: 33 } }, ...over } });

test('asset_plan custom: an inline spec for what fits no profile, validated', () => withProject(async (p) => {
  const a = connect(p.root);
  const ok = await planFx(a);
  assert.equal(ok.isError, undefined, text(ok));
  const got = await a.ok('studio_asset_get', { assetId: FX, sections: ['spec'] });
  assert.deepEqual([got.spec.profile, got.spec.category, got.spec.size, got.spec.pivot, got.spec.directions], ['custom', 'vfx', [32, 32], [16, 16], ['none']]);
  assert.deepEqual(got.spec.clips, { play: { frames: 12, frameMs: 33 } });
  assert.equal(got.spec.expectedFrames, 12);
  assert.equal(got.plan.entry.custom.category, 'vfx');
  assert.equal('profile' in got.plan.entry, false);
  const bad = (over, why) => planFx(connect(p.root), over, 'lt_fx_test_bad').then((r) => assert.match(text(r), why));
  await bad({ category: 'dragon' }, /custom\.category "dragon" is not known/);
  await bad({ size: [2, 32] }, /below minimum 4|custom\.size must be/);
  await bad({ pivot: [32, 0] }, /custom\.pivot must be \[x, y\] inside/);
  await bad({ clips: {} }, /1 to 8 clips|custom\.clips/);
  await bad({ clips: { Play: { frames: 4, frameMs: 40 } } }, /lower_snake_case/);
  await bad({ directions: ['up'] }, /Invalid arguments|must be one of/);
  assert.match(text(await a.call('studio_asset_plan', { op: 'create', id: 'lt_both_one', chunk: 'wards', brief: 'x', profile: 'npc', custom: { category: 'vfx', size: [8, 8], pivot: [1, 1], clips: { a: { frames: 1, frameMs: 1 } } } })), /exactly one of profile .* or custom/);
  assert.match(text(await a.call('studio_asset_plan', { op: 'create', id: 'lt_neither_one', chunk: 'wards', brief: 'x' })), /exactly one of profile/);
}));

// ---- vfx_build ---------------------------------------------------------------------------------
test('vfx_build: a SpriteFX spec becomes frames, audited twice, judged by the gates, committed on request', { skip: skipFx }, () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  await planFx(a);
  const r = await a.call('studio_vfx_build', { assetId: FX, spec: spec() });
  assert.equal(r.isError, undefined, text(r));
  assert.deepEqual(r.content.map((c) => c.type), ['text', 'image']);
  const s = r.structuredContent;
  assert.equal(s.audit.faults, 0);
  assert.match(s.audit.output, /build: 0 faults/);
  assert.equal(s.deterministic, true);
  assert.equal(s.frameTable.count, 12);
  assert.deepEqual(s.frameTable.size, [32, 32]);
  assert.equal(s.frameTable.fps, 30);
  assert.equal(s.frameTable.durationsMs.length, 12);
  assert.deepEqual(s.defects, { errors: 0, warnings: 0 });
  assert.equal(s.clip, 'play');
  assert.equal(fs.existsSync(join(raw(p, FX), 'frames')), false, 'building commits nothing');

  const sub = await a.call('studio_vfx_build', { assetId: FX, spec: spec(), submit: true });
  assert.equal(sub.isError, undefined, text(sub));
  assert.equal(sub.structuredContent.submit.written.length, 12);
  const log = fs.readFileSync(join(raw(p, FX), 'studio-submissions.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)[0];
  assert.match(log.tool, /SpriteFX via the project toolchain/);
  assert.equal(JSON.parse(log.prompt).name, 'hit_spark', 'provenance keeps the spec');
  assert.equal(log.sourceHash.length, 64);
  assert.match(log.notes, /faults 0; digest [0-9a-f]+; sheet [0-9a-f]{64}; two builds identical/);
  assert.equal((await a.ok('studio_qa_run', { assetId: FX })).pass, true);
}));

test('vfx_build: what it refuses before and after running', { skip: skipFx }, () => withProject(async (p) => {
  const a = connect(p.root);
  await planFx(a);
  const build = (mutate, extra = {}) => { const s = spec(); mutate(s); return a.call('studio_vfx_build', { assetId: FX, spec: s, ...extra }); };
  assert.match(text(await build((s) => { s.palette = 'default'; })), /spec\.palette must be a registered project palette: tien_nghich_40/);
  assert.match(text(await build((s) => { s.palette = '../../etc/passwd'; })), /spec\.palette must be a registered/);
  assert.match(text(await build((s) => { s.name = 'Bad Name'; })), /spec\.name is required/);
  assert.match(text(await build((s) => { s.canvas = [16, 16]; })), /spec\.canvas must be \[32, 32\]/);
  assert.match(text(await build((s) => { s.layers[0].note = '/etc/passwd'; })), /looks like a file path/);
  assert.match(text(await build((s) => { s.layers[0].note = '../x'; })), /looks like a file path/);
  assert.match(text(await build((s) => { s.layers[0].note = '~/x'; })), /looks like a file path/);
  assert.match(text(await a.call('studio_vfx_build', { assetId: FX, spec: spec(), command: 'id' })), /unexpected property "command"/);
  assert.match(text(await a.call('studio_vfx_build', { assetId: FX, spec: spec(), clip: 'nope' })), /has clips play/);
  assert.match(text(await build((s) => { s.palette = 'tien_nghich_40'; s.layers = [{ id: 'x', kind: 'nonsense' }]; })), /SpriteFX reported .*(fault|failure)/);
  assert.equal(fs.existsSync(join(raw(p, FX), 'frames')), false);

  // A clip with the wrong frame count: the build is judged, but it cannot be committed.
  const b = connect(p.root);
  await b.call('studio_asset_plan', { op: 'create', id: 'lt_fx_test_short', chunk: 'wards', brief: 'Short.', custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { play: { frames: 8, frameMs: 33 } } } });
  const short = await b.call('studio_vfx_build', { assetId: 'lt_fx_test_short', spec: spec(), submit: true });
  assert.equal(short.isError, true);
  assert.match(JSON.stringify(short.structuredContent.problems), /rendered 12 frames but clip play has 8/);
  assert.match(short.structuredContent.submit.message, /Nothing was committed/);
  assert.equal(fs.existsSync(join(raw(p, 'lt_fx_test_short'), 'frames')), false);
  const read = connect(p.root, { scope: 'read' });
  assert.match(text(await read.call('studio_vfx_build', { assetId: FX, spec: spec() })), /needs scope "author"/);
}));

test('vfx_build: a missing SpriteFX environment is a plain message', () => withProject(async (p) => {
  const a = connect(p.root);
  await planFx(a);
  fs.rmSync(join(p.root, 'tools/.venvs'), { recursive: true, force: true });
  const r = await a.call('studio_vfx_build', { assetId: FX, spec: spec() });
  assert.equal(r.isError, true);
  assert.match(text(r), /The SpriteFX interpreter is registered as tools\/\.venvs\/spritefx\/bin\/python, which does not exist/);
}));

// ---- pack (staging) ----------------------------------------------------------------------------
import crypto from 'node:crypto';
import { openProject } from './project.mjs';
import { PROVENANCE, clipFrames } from './testkit.mjs';
import { encodePixels } from '../core/png.mjs';

const dirHash = (dir) => {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) e.isDirectory() ? walk(join(d, e.name)) : h.update(e.name + crypto.createHash('sha256').update(fs.readFileSync(join(d, e.name))).digest('hex')); };
  walk(dir);
  return h.digest('hex');
};
const solid = (w, h, rgb) => { const px = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i++) px.set([...rgb, 255], i * 4); return encodePixels(w, h, px).toString('base64'); };

test('pack: a chunk is packed into staging atlases, checked against its budget, deterministically; shipped atlases are untouched', () => withProject(async (p) => {
  const a = connect(p.root, { agent: 'codex' });
  const shipped = dirHash(join(p.root, 'assets/atlases_longtime'));
  const r = await a.ok('studio_pack', { chunk: 'abode' });
  assert.equal(r.pass, true);
  assert.match(r.staging, /^\.inspector-revisions\/staging\/abode$/);
  assert.deepEqual(Object.keys(r.assets), ['lt_kiln_keeper']);
  assert.equal(r.assets.lt_kiln_keeper.stage, 'processed');
  assert.equal(r.mobile.frames, 32);
  assert.equal(r.mobile.budget.pages.ceiling, 1, 'the abode chunk may use one mobile page');
  assert.equal(r.mobile.budget.pass, true);
  assert.equal(r.mobile.profile.extrude, 1);
  assert.equal(r.web.profile.limit, 2048);
  for (const f of r.mobile.files) assert.ok(fs.existsSync(join(p.root, r.staging, 'mobile', f.name)));
  const page = JSON.parse(fs.readFileSync(join(p.root, r.staging, 'mobile/atlas-0.json'), 'utf8'));
  assert.ok(page.frames['longtime/lt_kiln_keeper/idle_south_0'], 'frames carry the project keys');
  assert.deepEqual(page.frames['longtime/lt_kiln_keeper/idle_south_0'].pivotPx, [16, 29]);
  assert.equal(dirHash(join(p.root, 'assets/atlases_longtime')), shipped, 'the shipped atlases are byte-identical afterwards');
  assert.equal(r.shippedAtlases.unchanged, true);
  assert.deepEqual(r.shippedAtlases.directories.sort(), ['assets/atlases', 'assets/atlases_longtime']);
  const again = await a.ok('studio_pack', { chunk: 'abode', platform: 'mobile' });
  assert.deepEqual(again.mobile.files, r.mobile.files, 'same frames, same bytes');
  assert.equal(again.web, undefined);
}));

test('pack: submitted raw frames count toward the chunk, and a chunk over budget says so', () => withProject(async (p) => {
  const a = connect(p.root);
  // A big effect in the abode chunk (one mobile page of 1024x1024): 20 frames of 256x256 cannot fit.
  await a.ok('studio_asset_plan', { op: 'create', id: 'lt_fx_big_sheet', chunk: 'abode', brief: 'A deliberately large effect.', custom: { category: 'vfx', size: [256, 256], pivot: [128, 128], clips: { play: { frames: 20, frameMs: 50 } } } });
  const frames = Array.from({ length: 20 }, (_, n) => ({ clip: 'play', direction: 'none', n, pngBase64: solid(256, 256, n % 2 ? [15, 61, 58] : [23, 89, 75]) }));
  const sub = await a.call('studio_frames_submit', { assetId: 'lt_fx_big_sheet', provenance: PROVENANCE, frames });
  assert.equal(sub.isError, undefined, text(sub));
  const r = await a.ok('studio_pack', { chunk: 'abode', platform: 'mobile' });
  assert.equal(r.assets.lt_fx_big_sheet.stage, 'raw');
  assert.equal(r.assets.lt_kiln_keeper.stage, 'processed');
  assert.equal(r.pass, false);
  assert.equal(r.mobile.budget.pass, false);
  assert.ok(r.mobile.pages > 1);
  assert.match(r.mobile.budget.problems.join(), /page\(s\) exceed the chunk's ceiling of 1/);
  assert.equal(r.mobile.budget.bytes.ceiling, 1024 * 1024 * 4);
  // The same assets in a chunk with room are fine.
  assert.match(text(await a.call('studio_pack', { chunk: 'mist_archive' })), /has no frames yet/);
}));

test('pack: refuses what it should', () => withProject(async (p) => {
  const a = connect(p.root);
  assert.match(text(await a.call('studio_pack', { chunk: 'nowhere' })), /No chunk "nowhere". Chunks: abode, forms/);
  assert.match(text(await a.call('studio_pack', { chunk: 'trial' })), /has no frames yet/);
  assert.match(text(await a.call('studio_pack', { chunk: 'abode', destination: 'assets/atlases' })), /unexpected property "destination"/, 'there is no way to name an output place');
  assert.match(text(await a.call('studio_pack', { chunk: 'abode', output: '../x' })), /unexpected property "output"/);
  const read = connect(p.root, { scope: 'read' });
  assert.match(text(await read.call('studio_pack', { chunk: 'abode' })), /needs scope "author"/);
  // A staging area that would fall inside a shipped atlas directory is refused before anything is written.
  const inside = openProject(p.root, { libraryDir: join(p.root, 'assets/atlases_longtime/library') });
  const before = dirHash(join(p.root, 'assets/atlases_longtime'));
  assert.match(text(await connect(inside).call('studio_pack', { chunk: 'abode' })), /lies inside a shipped atlas directory \(assets\/atlases_longtime\); refusing/);
  assert.equal(dirHash(join(p.root, 'assets/atlases_longtime')), before);
  assert.equal(fs.existsSync(join(p.root, 'assets/atlases_longtime/library')), false);
}));

// ---- scene_snapshot ----------------------------------------------------------------------------
import { decodeRgba } from '../core/png.mjs';
const sceneProject = (fn) => withProject(fn, { toolchain: false, extraDirs: ['assets/processed/tilesets/ts_hengyue', 'assets/processed/vfx'] });
const rgbaAt = (img, x, y) => [...img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const readPng = (r) => decodeRgba(Buffer.from(r.content[1].data, 'base64'));

test('scene_snapshot: the subject stands on its pivot, on a real floor tile; checker and flat backgrounds', () => sceneProject(async (p) => {
  const a = connect(p.root, { scope: 'read' });
  const r = await a.call('studio_scene_snapshot', { assetId: 'lt_kiln_keeper', background: { kind: 'tile', tileAsset: 'ts_hengyue' }, scale: 4 });
  assert.equal(r.isError, undefined, text(r));
  assert.deepEqual(r.content.map((c) => c.type), ['text', 'image']);
  const s = r.structuredContent, img = readPng(r);
  assert.deepEqual([img.width, img.height], [s.scene.width, s.scene.height]);
  assert.deepEqual(s.scene.size, [96, 80], 'room for a 32px figure: three wide, two and a half high');
  assert.equal(s.background.kind, 'tile');
  assert.equal(s.background.tileSize[0], 16);
  assert.deepEqual(s.ground, [48, 64]);
  assert.deepEqual([s.stage, s.clip, s.direction, s.frames], ['processed', 'idle', 'south', ['idle_south_0']]);

  // The tile repeats from the top left; the figure's pivot pixel sits on the ground point.
  const tile = decodeRgba(fs.readFileSync(join(p.root, 'assets/processed/tilesets/ts_hengyue', `${s.background.frame}.png`)));
  for (const [x, y] of [[0, 0], [3, 5], [16, 0], [33, 17], [95, 79]]) assert.deepEqual(rgbaAt(img, x * 4, y * 4).slice(0, 3), rgbaAt(tile, x % 16, y % 16).slice(0, 3), `tile pixel ${x},${y}`);
  const frame = decodeRgba(fs.readFileSync(join(p.root, 'assets/processed_longtime/lt_kiln_keeper/idle_south_0.png')));
  const [px, py] = s.pivot, [gx, gy] = s.ground;
  let checked = 0;
  for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
    if (frame.pixels[(y * frame.width + x) * 4 + 3] !== 255) continue;
    assert.deepEqual(rgbaAt(img, (gx - px + x) * 4 + 1, (gy - py + y) * 4 + 2), rgbaAt(frame, x, y), `sprite pixel ${x},${y}`);
    checked++;
  }
  assert.ok(checked > 50, 'a real figure was compared');

  const flat = readPng(await a.call('studio_scene_snapshot', { assetId: 'lt_kiln_keeper', background: { kind: 'flat', color: 'jade_02' }, scale: 1 }));
  assert.deepEqual(rgbaAt(flat, 0, 0), [23, 89, 75, 255], 'jade_02 is #17594b');
  const checker = readPng(await a.call('studio_scene_snapshot', { assetId: 'lt_kiln_keeper', scale: 1 }));
  assert.notDeepEqual(rgbaAt(checker, 0, 0), rgbaAt(checker, 4, 0), 'two checker colours');
}));

test('scene_snapshot: a VFX at the feet, the centre or the head; a strip of every frame', () => sceneProject(async (p) => {
  const a = connect(p.root, { scope: 'read' });
  const at = async (anchor) => (await a.call('studio_scene_snapshot', { assetId: 'lt_kiln_keeper', vfx: { assetId: 'hit_spark', anchor }, scale: 1, showAnchor: true })).structuredContent;
  const feet = await at('feet'), center = await at('center'), head = await at('head');
  assert.deepEqual(feet.vfx.at, feet.ground, 'feet: the effect pivot is the subject pivot');
  assert.ok(center.vfx.at[1] < feet.vfx.at[1] && head.vfx.at[1] < center.vfx.at[1], 'centre is above the feet, head above the centre');
  assert.equal(head.vfx.frame, 'hit_spark_6', 'the middle frame of 12 by default');
  const offset = await at({ x: 5, y: -7 });
  assert.deepEqual(offset.vfx.at, [feet.ground[0] + 5, feet.ground[1] - 7]);
  const marked = readPng(await a.call('studio_scene_snapshot', { assetId: 'lt_kiln_keeper', vfx: { assetId: 'hit_spark', anchor: 'head' }, scale: 1, showAnchor: true }));
  assert.deepEqual(rgbaAt(marked, ...head.vfx.at), [255, 0, 255, 255], 'the anchor is marked');

  const strip = await a.call('studio_scene_snapshot', { assetId: 'lt_kiln_keeper', mode: 'strip', clip: 'idle', direction: 'east', scale: 2 });
  assert.equal(strip.structuredContent.frames.length, 4);
  assert.equal(strip.structuredContent.scene.cells, 4);
  assert.equal(strip.structuredContent.scene.width, 96 * 4 * 2);
  assert.equal(readPng(strip).width, 96 * 4 * 2);
}));

test('scene_snapshot: plain errors, and it writes nothing', () => sceneProject(async (p) => {
  const a = connect(p.root, { scope: 'read' });
  const err = async (args, why) => assert.match(text(await a.call('studio_scene_snapshot', { assetId: 'lt_kiln_keeper', ...args })), why);
  await err({ background: { kind: 'flat', color: 'nope_99' } }, /not a palette colour id/);
  await err({ background: { kind: 'tile' } }, /tile needs tileAsset/);
  await err({ background: { kind: 'tile', tileAsset: 'lt_nothing' } }, /No tile asset/);
  await err({ background: { kind: 'tile', tileAsset: 'ts_hengyue', tileFrame: 'nope' } }, /no frame "nope"/);
  await err({ vfx: { assetId: 'lt_nothing' } }, /No effect asset/);
  await err({ vfx: { assetId: 'hit_spark', frame: 99 } }, /has 12 frames; there is no frame 99/);
  await err({ mode: 'strip', vfx: { assetId: 'hit_spark' } }, /vfx works with mode "still"/);
  await err({ clip: 'dance' }, /no processed frames for clip "dance"/);
  await err({ frame: 9 }, /there is no frame 9/);
  await err({ size: [256, 256], scale: 8, mode: 'strip', direction: 'east' }, /the picture would be 8192x2048; use a smaller scale or size/);
  assert.match(text(await a.call('studio_scene_snapshot', { assetId: 'lt_seed_broker' })), /no processed frames to show/);
  assert.match(text(await a.call('studio_scene_snapshot', { assetId: 'bgm_hengyue' })), /an audio cue, not a frame asset/);
  assert.equal(fs.existsSync(join(p.root, '.inspector-revisions')), false, 'a read-scope snapshot creates nothing');
}));
