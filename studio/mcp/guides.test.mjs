import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { GUIDES, guideIds } from './guides.mjs';
import { buildRegistry } from './tools/index.mjs';
import { connect, makeProject } from './testkit.mjs';
import { McpServer } from './server.mjs';
import { openProject } from './project.mjs';

const registry = buildRegistry();
const tools = new Map(registry.list('pack').map((t) => [t.name, t]));
const text = (r) => r.content?.[0]?.text ?? '';
const withProject = async (fn) => { const p = makeProject({ git: false }); try { return await fn(p); } finally { await p.cleanup(); } };

test('every guide names only tools and parameters that exist, in steps and in gotcha text', () => {
  assert.deepEqual(guideIds, ['static-asset', 'animated-character', 'vfx', 'audio-cue', 'check-others-work', 'answer-review-comment']);
  for (const g of GUIDES) {
    assert.ok(g.steps.length >= 3 && g.gotchas.length >= 1, g.id);
    for (const s of g.steps) {
      const tool = tools.get(s.tool);
      assert.ok(tool, `${g.id}: tool ${s.tool} does not exist`);
      for (const param of s.params) assert.ok(Object.hasOwn(tool.inputSchema.properties, param), `${g.id}: ${s.tool} has no parameter "${param}"`);
      for (const mentioned of s.note.match(/studio_[a-z_]+/g) ?? []) assert.ok(tools.has(mentioned), `${g.id}: note names unknown tool ${mentioned}`);
    }
    for (const t of [g.when, g.title, ...g.gotchas].join(' ').match(/studio_[a-z_]+/g) ?? []) assert.ok(tools.has(t), `${g.id}: text names unknown tool ${t}`);
    // Parameter-looking mentions in notes (name=value) must be real parameters of the step's tool or of some tool.
    const all = new Set([...tools.values()].flatMap((t) => Object.keys(t.inputSchema.properties)));
    for (const s of g.steps) for (const m of s.note.matchAll(/\b([a-zA-Z]+)=(?:true|false|"|\w)/g)) assert.ok(all.has(m[1]) || m[1] === 'op', `${g.id}: note mentions parameter ${m[1]}, which no tool has`);
  }
});

test('the test itself catches a guide that names a missing tool or parameter', () => {
  const bad = { tool: 'studio_nope', params: ['x'] }, badParam = { tool: 'studio_qa_run', params: ['assetId', 'nonsense'] };
  assert.equal(tools.has(bad.tool), false);
  assert.equal(Object.hasOwn(tools.get(badParam.tool).inputSchema.properties, 'nonsense'), false);
});

test('studio_guide: lists the guides, returns one with the project rules from the pack, refuses an unknown task; read scope', () => withProject(async (p) => {
  const a = connect(p.root, { scope: 'read' });
  const list = await a.ok('studio_guide', {});
  assert.equal(list.guides.length, 6);
  assert.ok(list.rules.some((r) => /Outline: 1 px solid ink_01/.test(r)));
  const g = await a.ok('studio_guide', { task: 'animated-character' });
  assert.equal(g.steps[0].n, 1);
  assert.ok(g.steps.some((s) => s.tool === 'studio_rig_bake' && s.params.includes('poseClips')));
  assert.match(text(await a.call('studio_guide', { task: 'nope' })), /Invalid arguments|No guide/);
  const pack = JSON.parse(fs.readFileSync(join(REPO_ROOT(p), 'studio.project.json'), 'utf8'));
  assert.deepEqual(list.rules, pack.agentGuidance.rules, 'the rules come from the pack, verbatim');
}));
const REPO_ROOT = (p) => p.root;

test('initialize sends the project rules from the pack as MCP instructions (both protocol eras); a pack without them still works', () => withProject(async (p) => {
  const server = () => new McpServer({ registry, project: openProject(p.root), scope: 'read', agent: 'unit' });
  const legacy = await server().handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
  assert.match(legacy.result.instructions, /Project rules:\n- Perspective: 3\/4 top-down/);
  assert.match(legacy.result.instructions, /studio_guide/);
  const modern = await server().handleMessage({ jsonrpc: '2.0', id: 2, method: 'server/discover', params: {} });
  assert.match(modern.result.instructions, /Outline: 1 px solid ink_01/);
  const packFile = join(p.root, 'studio.project.json');
  const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
  delete pack.agentGuidance;
  fs.writeFileSync(packFile, JSON.stringify(pack));
  const bare = await server().handleMessage({ jsonrpc: '2.0', id: 3, method: 'server/discover', params: {} });
  assert.doesNotMatch(bare.result.instructions, /Project rules/);
}));
