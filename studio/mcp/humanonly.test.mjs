// What an agent can NEVER do, proven at every scope. The plan's list of human-only actions:
// approve or reject a revision, sign an audio listening sheet, publish, delete, edit project rules,
// run arbitrary shell. None of them may exist as a tool, be reachable through an argument of a tool
// that does exist, or be written by any code path an agent can reach.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bareFrame } from '../core/review.mjs';
import { PROVENANCE, REPO, clipFrames, connect, makeFrame, makeProject } from './testkit.mjs';
import { openProject } from './project.mjs';
import { buildRegistry } from './tools/index.mjs';
import { SCOPES } from './registry.mjs';

const text = (r) => r.content?.[0]?.text ?? r.rpcError?.message ?? '';
const FORBIDDEN_NAME = /approve|reject|sign|publish|delete|remove|promote|shell|exec|decision|decide|merge|overwrite|rig_?palette|palette_?edit|project_?edit/i;
const FORBIDDEN_PROP = /^(approve|approved|reject|decision|decide|publish|delete|remove|sign|signed|overwrite|force|shell|command|cmd|exec|session|agent)$/i;
// The one read-only filter that happens to be called status (a derived delivery state, not a review status).
const ALLOWED_PROPS = new Set(['studio_catalog_search.status']);

const props = (schema, path = '') => {
  const out = [];
  for (const [k, v] of Object.entries(schema?.properties ?? {})) out.push([path + k, k], ...props(v, `${path}${k}.`));
  if (schema?.items) out.push(...props(schema.items, path));
  if (schema?.additionalProperties && typeof schema.additionalProperties === 'object') out.push(...props(schema.additionalProperties, path));
  return out;
};

for (const scope of SCOPES) {
  test(`[${scope}] no tool is named for, or takes an argument that could, approve, reject, sign, publish, delete or run a command`, () => {
    const tools = buildRegistry().list(scope);
    assert.ok(tools.length >= 5);
    for (const t of tools) {
      assert.doesNotMatch(t.name, FORBIDDEN_NAME, `tool name ${t.name}`);
      assert.equal(t.inputSchema.additionalProperties, false, `${t.name} must reject unknown arguments`);
      for (const [path, name] of props(t.inputSchema)) {
        if (ALLOWED_PROPS.has(`${t.name}.${path}`)) continue;
        assert.doesNotMatch(name, FORBIDDEN_PROP, `${t.name} has a property "${path}"`);
        assert.notEqual(name, 'status', `${t.name}.${path}: no tool takes a review status`);
      }
    }
  });

  test(`[${scope}] the human-only tools do not exist: unknown tool, whatever the arguments`, async () => {
    const p = makeProject({ git: false });
    try {
      const c = connect(p.root, { scope });
      for (const name of ['studio_review_approve', 'studio_review_reject', 'studio_review_decide', 'studio_review_set_status', 'studio_asset_delete',
        'studio_asset_publish', 'studio_publish', 'studio_audio_sign', 'studio_audio_listening_sign', 'studio_palette_edit', 'studio_project_edit',
        'studio_rules_set', 'studio_shell', 'studio_exec', 'studio_run_command', 'studio_asset_remove', 'studio_revision_restore']) {
        const r = await c.call(name, { assetId: 'lt_seed_broker', status: 'approved', key: 'x' });
        assert.equal(r.rpcError?.code, -32602, name);
        assert.match(r.rpcError.message, /Unknown tool/, name);
      }
    } finally { await p.cleanup(); }
  });

  test(`[${scope}] every tool rejects approve/status/decision/publish/delete/session arguments`, async () => {
    const p = makeProject({ git: false });
    try {
      const c = connect(p.root, { scope });
      for (const t of buildRegistry().list('pack')) {
        const visible = buildRegistry().list(scope).some((v) => v.name === t.name);
        const r = await c.call(t.name, { assetId: 'lt_seed_broker', jobId: 'job-0000000000', key: 'x', text: 'x', note: 'x', approve: true, approved: true, status: 'approved',
          decision: 'approved', publish: true, delete: true, sign: true, session: 's-forged', agent: 'someone-else' });
        const msg = text(r);
        if (visible) {
          assert.equal(r.isError, true, t.name);
          assert.match(msg, /unexpected property "(approve|approved|decision|publish|delete|sign|session|agent)"/, `${t.name}: ${msg.slice(0, 200)}`);
        } else {
          assert.equal(r.isError, true, `${t.name} must not run at scope ${scope}`);
          assert.match(msg, /needs scope/);
        }
      }
    } finally { await p.cleanup(); }
  });
}

test('read scope cannot reach any tool that writes', async () => {
  const p = makeProject({ git: false });
  try {
    const c = connect(p.root, { scope: 'read' });
    const writers = buildRegistry().list('pack').filter((t) => t.scope !== 'read').map((t) => t.name);
    assert.deepEqual(writers.sort(), ['studio_asset_plan', 'studio_frames_submit', 'studio_metadata_set', 'studio_review_reply', 'studio_review_request']);
    const listed = (await c.rpc('tools/list')).result.tools.map((t) => t.name);
    for (const w of writers) {
      assert.equal(listed.includes(w), false, `${w} is hidden`);
      const r = await c.call(w, {});
      assert.match(text(r), /needs scope "author"/);
    }
    // And a read connection leaves the project exactly as it found it.
    await c.call('studio_qa_run', { assetId: 'lt_kiln_keeper' });
    await c.call('studio_preview_render', { assetId: 'lt_kiln_keeper' });
    await c.call('studio_diff', { assetId: 'lt_kiln_keeper' });
    await c.call('studio_review_list', { assetId: 'lt_kiln_keeper' });
    assert.equal(statSync(p.root).isDirectory() && readdirSync(join(p.root, 'assets')).includes('studio_plans.json'), false);
  } finally { await p.cleanup(); }
});

test('after a full agent loop at the highest scope, nothing is approved, rejected or reopened', async () => {
  const p = makeProject({ git: false });
  try {
    const project = openProject(p.root);
    const author = connect(project, { scope: 'pack', agent: 'codex' });
    const checker = connect(project, { scope: 'pack', agent: 'claude-code' });
    await author.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) });
    await checker.ok('studio_qa_run', { assetId: 'lt_seed_broker', independent: true });
    await author.ok('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please review.' });
    await author.ok('studio_metadata_set', { assetId: 'lt_seed_broker', pivot: [16, 29] });
    const store = await project.workspace.store();
    const png = (n) => makeFrame(32, 32, { variant: n }).png;
    const status = (n) => store.operate(bareFrame(`longtime/lt_seed_broker/idle_south_${n}`), png(n), 'frame', {}).status;
    assert.deepEqual([0, 1, 2, 3].map(status), ['pending', 'pending', 'pending', 'pending']);

    // A human decides; the agent then does everything it can think of.
    store.operate(bareFrame('longtime/lt_seed_broker/idle_south_0'), png(0), 'review', { revision: 0, status: 'approved' });
    store.operate(bareFrame('longtime/lt_seed_broker/idle_south_1'), png(1), 'review', { revision: 0, status: 'changes_requested', text: 'Redo.' });
    const attempts = [
      author.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4, 32, 32, 20) }), // different pixels
      author.call('studio_review_request', { assetId: 'lt_seed_broker', note: 'Please approve it now.' }),
      author.call('studio_review_reply', { key: 'longtime/lt_seed_broker/idle_south_0', text: 'Thanks, it is approved.' }),
      author.call('studio_review_reply', { key: 'longtime/lt_seed_broker/idle_south_1', replyTo: 1, text: 'Fixed.', resolves: true }),
      author.call('studio_asset_plan', { op: 'edit', id: 'lt_seed_broker', etag: 'x', brief: 'y' }),
    ];
    await Promise.all(attempts);
    assert.deepEqual([0, 1, 2, 3].map(status), ['approved', 'changes_requested', 'pending', 'pending'], 'every status is exactly what the human left');
  } finally { await p.cleanup(); }
});

// A tool that approves would have to call the store's 'review' action with a status, or save/restore a
// revision. List every such call in the code an agent can reach, and require each to be one of the
// reviewed, harmless ones. Adding a new one fails this test on purpose: extend the allowlist only
// after deciding it cannot approve, reject or reopen.
function sources(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    // eval/ is the evaluation harness: it plays the human (approves, comments) to build a scene. The next test
    // proves nothing the server runs can reach it.
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'eval') sources(full, out); }
    else if (e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs') && e.name !== 'store.mjs' && e.name !== 'testkit.mjs') out.push(full);
  }
  return out;
}

test('static: the only code that writes to the revision store is reviewed and cannot set a decision', () => {
  const files = [...sources(join(REPO, 'studio/mcp')), ...sources(join(REPO, 'studio/core'))];
  const calls = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\.operate\([^;]*?'(review|save|restore)'[^;]*;/gs)) calls.push({ file: f.slice(REPO.length + 1), action: m[1], code: m[0].replace(/\s+/g, ' ') });
  }
  const expected = [
    { file: 'studio/core/review.mjs', action: 'review', must: /\{revision: snap\.revision, text\}\)/ },            // request: text only
    { file: 'studio/core/review.mjs', action: 'review', must: /\{revision: rev, text: body\}\)/ },                 // reply: text only
    { file: 'studio/core/submissions.mjs', action: 'review', must: /\{revision: 0, status: 'pending'\}\)/ },      // new lineage starts pending
  ];
  assert.equal(calls.length, expected.length, `unexpected store writes:\n${calls.map((c) => `${c.file}: ${c.code}`).join('\n')}`);
  for (const want of expected) {
    const hit = calls.find((c) => c.file === want.file && c.action === want.action && want.must.test(c.code));
    assert.ok(hit, `missing reviewed call in ${want.file}: ${want.must}`);
  }
  for (const c of calls) assert.doesNotMatch(c.code, /approved|changes_requested|rejected/, `${c.file} writes a decision`);
  // And nothing outside tests names the decisions as a value it could write.
  for (const f of files) {
    const src = readFileSync(f, 'utf8').split('\n');
    src.forEach((line, i) => {
      if (/status\s*[:=]\s*['"](approved|changes_requested|rejected)['"]/.test(line)) assert.fail(`${f.slice(REPO.length + 1)}:${i + 1} sets a review decision: ${line.trim()}`);
    });
  }
});

test('static: no server code imports the evaluation harness or the test kit (the code that plays a human)', () => {
  const files = [...sources(join(REPO, 'studio/mcp')), ...sources(join(REPO, 'studio/core')), join(REPO, 'studio/mcp.mjs'), join(REPO, 'studio/serve.mjs')];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /from\s+'[^']*(\/eval\/|testkit)[^']*'/, `${f.slice(REPO.length + 1)} imports test or evaluation code`);
    assert.doesNotMatch(src, /import\(\s*'[^']*(\/eval\/|testkit)[^']*'\s*\)/, `${f.slice(REPO.length + 1)} dynamically imports test or evaluation code`);
  }
});

test('sessions are assigned by the server and cannot be chosen, claimed or forged', async () => {
  const p = makeProject({ git: false });
  try {
    const project = openProject(p.root);
    const a = connect(project, { agent: 'codex' }), b = connect(project, { agent: 'codex' });
    assert.notEqual(a.session, b.session);
    assert.match(a.session, /^s-[0-9a-f]{12}$/);
    // A client that puts another session's id in its self-reported name gets neither that session nor its name.
    const r = await a.rpc('tools/call', { name: 'studio_project_info', arguments: {}, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: b.session, version: '1' } } });
    assert.equal(r.result.structuredContent.connection.agent, 'codex', 'the operator-asserted agent name wins over clientInfo');
    const sub = await a.call('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, session: b.session, frames: clipFrames('idle', 'south', 1) });
    assert.match(text(sub), /unexpected property "session"/);
    const ok = await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1) });
    assert.equal(ok.provenance.session, a.session);
    // So b, a different session, may check what a authored, and a may not.
    assert.equal((await b.ok('studio_qa_run', { assetId: 'lt_seed_broker', independent: true })).recorded.independent, true);
    assert.match(text(await a.call('studio_qa_run', { assetId: 'lt_seed_broker', independent: true })), /different session/);
  } finally { await p.cleanup(); }
});
