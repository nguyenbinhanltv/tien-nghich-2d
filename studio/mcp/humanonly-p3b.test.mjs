// Part 2 of the human-only guarantees: the tools that sit on the forge and the toolchain still cannot approve, sign,
// publish into shipped atlases, delete, register a program or run an arbitrary command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join, relative } from 'node:path';
import { convertPrototypeRig } from '../forge/rig/tests/fixtures/convert-prototype-rig.mjs';
import { HAVE_PYTHON, HAVE_SPRITEFX, PROVENANCE, REPO, clipFrames, connect, makeProject } from './testkit.mjs';
import { openProject } from './project.mjs';
import { SCOPES } from './registry.mjs';

const text = (r) => r.content?.[0]?.text ?? r.rpcError?.message ?? '';
const json = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

// Every file under `root`, by relative path, with its hash (links are not followed).
function files(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name), rel = relative(root, abs);
      if (fs.lstatSync(abs).isSymbolicLink()) { out.set(rel, 'link'); continue; }
      if (e.isDirectory()) walk(abs); else out.set(rel, createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

for (const scope of SCOPES) {
  test(`[${scope}] more human-only tools that must not exist: promote, deliver, register, delete, run`, async () => {
    const p = makeProject({ git: false });
    try {
      const c = connect(p.root, { scope });
      for (const name of ['studio_pack_publish', 'studio_pack_deliver', 'studio_atlas_publish', 'studio_atlas_write', 'studio_promote', 'studio_frame_delete', 'studio_revision_delete',
        'studio_audio_sign', 'studio_audio_deliver', 'studio_audio_approve', 'studio_listening_sign', 'studio_generator_register', 'studio_generator_add', 'studio_adapter_register',
        'studio_pack_edit', 'studio_palette_set', 'studio_rules_set', 'studio_command_run', 'studio_script_run', 'studio_git_commit', 'studio_token_issue']) {
        const r = await c.call(name, { assetId: 'lt_seed_broker', command: 'id', status: 'approved' });
        assert.equal(r.rpcError?.code, -32602, name);
        assert.match(r.rpcError.message, /Unknown tool/, name);
      }
    } finally { await p.cleanup(); }
  });
}

test('MCP-008: after every new tool has been used, and abused, at the highest scope: no rule, manifest, palette, script, shipped atlas or processed frame changed; every status is pending', async () => {
  const p = makeProject({ git: false, toolchain: true, extraDirs: ['assets/processed/tilesets/ts_hengyue', 'assets/processed/vfx'] });
  try {
    fs.mkdirSync(join(p.root, 'work'), { recursive: true });
    const EXP = join(REPO, 'assets/experiments/forge_bakeoff/lt_ink_marten');
    fs.copyFileSync(join(EXP, 'turnaround.png'), join(p.root, 'work/turnaround.png'));
    const before = files(p.root);
    const project = openProject(p.root);
    const author = connect(project, { scope: 'pack', agent: 'codex' }), checker = connect(project, { scope: 'pack', agent: 'claude-code' });
    const ok = (name, args) => author.call(name, args);

    // The forge route, to the end.
    await ok('studio_template_get', { assetId: 'lt_reed_crane', write: true });
    await ok('studio_sheet_import', { assetId: 'lt_reed_crane', sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: fs.readFileSync(join(EXP, 'prompt.txt'), 'utf8'), tool: 'test' });
    await ok('studio_process', { assetId: 'lt_reed_crane', marks: [{ color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17 }] });
    const rig = convertPrototypeRig(json(join(EXP, 'rig.json')), { id: 'lt_reed_crane' });
    const library = json(join(REPO, 'studio/forge/rig/tests/fixtures/marten/bakeoff-motion.json'));
    await ok('studio_rig_bake', { assetId: 'lt_reed_crane', rig, library, qa: { weightTransfer: false }, submit: true });
    await ok('studio_frame_patch', { assetId: 'lt_reed_crane', edits: [{ frame: 'idle_south_0', ops: [{ op: 'outline' }] }] });
    await ok('studio_frame_patch', { assetId: 'lt_icon_realm_step', target: 'create', edits: [{ frame: 'glyph_none_0', ops: [{ op: 'fill', box: [4, 4, 12, 12], color: 'jade_03' }, { op: 'outline' }] }] });
    await ok('studio_scene_snapshot', { assetId: 'lt_reed_crane', background: { kind: 'tile', tileAsset: 'ts_hengyue' } });
    await ok('studio_pack', { chunk: 'abode' });
    // The toolchain, if this machine has it.
    if (HAVE_PYTHON) await ok('studio_generator_run', { assetId: 'lt_icon_realm_step', generator: 'primitives', params: { shape: 'ring', size: 16 }, submit: false });
    if (HAVE_SPRITEFX) {
      await ok('studio_asset_plan', { op: 'create', id: 'lt_fx_barrage', chunk: 'wards', brief: 'x', custom: { category: 'vfx', size: [32, 32], pivot: [16, 16], clips: { play: { frames: 12, frameMs: 33 } } } });
      await ok('studio_vfx_build', { assetId: 'lt_fx_barrage', spec: json(join(REPO, 'tools/generators/vfx_specs/hit_spark.json')), submit: true });
    }
    // Audio.
    const zap = json(join(REPO, 'studio/audio/examples/zap.patch.json'));
    await ok('studio_audio_render', { cueId: 'sfx_step', document: zap, keep: true });
    await checker.call('studio_qa_run', { assetId: 'sfx_step', independent: true });
    await ok('studio_review_request', { assetId: 'sfx_step', note: 'Please review.' });
    await ok('studio_audio_analyze', { file: 'assets/studio_audio/sfx_step/v1/render.wav' });

    // And everything hostile.
    const hostile = [
      ['studio_generator_run', { assetId: 'lt_icon_realm_step', generator: '../../bin/sh' }], ['studio_generator_run', { assetId: 'lt_icon_realm_step', generator: 'primitives', params: { shape: 'disc', fill: '$(touch pwned)' } }],
      ['studio_generator_run', { assetId: 'lt_icon_realm_step', generator: 'primitives', params: { shape: 'disc', out: '/tmp/x' } }], ['studio_generator_run', { assetId: 'lt_icon_realm_step', generator: 'primitives', command: 'rm -rf /' }],
      ['studio_vfx_build', { assetId: 'lt_fx_barrage', spec: { name: 'x', palette: '../../../etc/passwd', canvas: [32, 32] } }], ['studio_vfx_build', { assetId: 'lt_fx_barrage', spec: { ...json(join(REPO, 'tools/generators/vfx_specs/hit_spark.json')), include: '/etc/passwd' } }],
      ['studio_pack', { chunk: 'abode', output: 'assets/atlases' }], ['studio_pack', { chunk: '../../assets/atlases' }],
      ['studio_frame_patch', { assetId: 'lt_icon_realm_step', edits: [{ frame: 'glyph_none_0', ops: [{ op: 'outline' }], approve: true }] }], ['studio_frame_patch', { assetId: 'lt_kiln_keeper', edits: [{ frame: 'idle_south_0', ops: [{ op: 'outline' }] }] }],
      ['studio_sheet_import', { assetId: 'lt_kiln_keeper', sheet: { file: 'work/turnaround.png' }, layout: json(join(EXP, 'layout.forge.json')), prompt: 'x', tool: 'x' }], ['studio_sheet_import', { assetId: 'lt_reed_crane', sheet: { file: '../../../etc/passwd' }, layoutId: 'x', prompt: 'x', tool: 'x' }],
      ['studio_audio_render', { cueId: 'sfx_step', document: { ...zap, listeningSigned: true }, keep: true }], ['studio_audio_render', { cueId: 'sfx_step', document: zap, sign: true }],
      ['studio_audio_analyze', { file: '../../../../etc/passwd' }], ['studio_asset_plan', { op: 'delete', id: 'lt_fx_barrage' }],
      ['studio_review_reply', { key: 'audio/sfx_step/v1/waveform', text: 'approved!', status: 'approved' }], ['studio_template_get', { assetId: 'lt_reed_crane', write: true, output: '/etc/x' }],
    ];
    for (const [name, args] of hostile) { const r = await ok(name, args); assert.equal(r.isError, true, `${name} ${JSON.stringify(args).slice(0, 80)} must be refused: ${text(r).slice(0, 120)}`); }

    // 1. Nothing outside the studio's own places was created or changed.
    const after = files(p.root);
    const allowed = [/^assets\/raw\/longtime\//, /^assets\/studio_plans\.json$/, /^assets\/studio_audio\//, /^\.inspector-revisions\//];
    for (const [rel, hash] of after) {
      if (before.get(rel) === hash) continue;
      assert.ok(allowed.some((re) => re.test(rel)), `${rel} was ${before.has(rel) ? 'changed' : 'created'} outside the studio's own directories`);
    }
    for (const [rel] of before) assert.ok(after.has(rel), `${rel} was deleted`);
    // 2. The things only a human may edit are byte-identical: the pack, manifests, palette, scripts, shipped atlases and processed frames.
    for (const [rel, hash] of before) {
      if (/^(studio\.project\.json|assets\/manifest[^/]*\.json|assets\/audio_manifest\.json|tools\/generators\/|assets\/atlases|assets\/processed)/.test(rel)) assert.equal(after.get(rel), hash, `${rel} must be unchanged`);
    }
    assert.equal(fs.existsSync(join(p.root, 'pwned')), false);
    assert.equal(fs.existsSync(join(p.root, 'assets/audio')), false, 'delivered audio was never created or touched');
    // 3. Every review history the agent started is pending.
    const store = await project.workspace.store();
    const db = new (await import('node:sqlite')).DatabaseSync(join(p.root, '.inspector-revisions/editor.sqlite'), { readOnly: true });
    const rows = db.prepare('SELECT DISTINCT key FROM versions').all();
    assert.ok(rows.length >= 4, `histories exist (${rows.length})`);
    for (const { key } of rows) {
      const head = store.operate({ kind: 'studio', info: { key }, metadata: {} }, Buffer.alloc(0), 'frame', {});
      assert.equal(head.status, 'pending', key);
    }
    const decided = db.prepare("SELECT key, status FROM reviews WHERE status IS NOT NULL AND status != 'pending'").all();
    db.close();
    assert.deepEqual(decided, [], 'no review row carries any status but pending');
  } finally { await p.cleanup(); }
});

test('static: only four reviewed files can start a program, and none takes a program name from a caller', () => {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) { if (!['tests', 'eval', 'node_modules'].includes(e.name)) walk(abs, out); }
      else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs') && e.name !== 'testkit.mjs') out.push(abs);
    }
    return out;
  };
  const users = [];
  for (const f of [...walk(join(REPO, 'studio/mcp')), ...walk(join(REPO, 'studio/core')), join(REPO, 'studio/mcp.mjs'), join(REPO, 'studio/serve.mjs')]) {
    // Starting a program needs node:child_process; look for the import (words in help text do not count).
    if (/from\s+['"](node:)?child_process['"]|require\(\s*['"](node:)?child_process['"]|import\(\s*['"](node:)?child_process['"]/.test(fs.readFileSync(f, 'utf8'))) users.push(relative(REPO, f));
  }
  assert.deepEqual(users.sort(), [
    'studio/core/adapters.mjs',         // runs the programs the pack registers: argv from a registered template, scrubbed environment
    'studio/core/doctor.mjs',           // `studio doctor`: fixed probes (git, ffmpeg, python3 with --version), nothing from a caller, never from an agent tool
    'studio/mcp/stdio_client.mjs',      // the --self-test client: starts THIS server
    'studio/mcp/tools/diff.mjs',        // git, with fixed arguments, to read frames on main
  ]);
  const adapters = fs.readFileSync(join(REPO, 'studio/core/adapters.mjs'), 'utf8');
  assert.doesNotMatch(adapters, /shell\s*:\s*true|\bexec\(|execSync/, 'never a shell');
  const diff = fs.readFileSync(join(REPO, 'studio/mcp/tools/diff.mjs'), 'utf8');
  assert.match(diff, /const git = \(root, args, opts = \{\}\) => exec\('git', \['-C', root, \.\.\.args\]/, 'git is always run with the program name fixed');
  // The registry is data in the pack: no tool can add to it (the pack is only ever read).
  for (const f of walk(join(REPO, 'studio/mcp/tools')).concat(walk(join(REPO, 'studio/mcp/workflow')))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /studio\.project\.json|packFileName|writeFile[^\n]*pack\b/, `${relative(REPO, f)} must not write the project pack`);
  }
});
