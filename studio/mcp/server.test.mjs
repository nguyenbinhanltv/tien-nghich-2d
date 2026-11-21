import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioClient } from './stdio_client.mjs';
import { McpServer } from './server.mjs';
import { ToolRegistry, ToolError, scopeAllows } from './registry.mjs';
import { validate, assertSupportedSchema } from './schema.mjs';
import { openProject } from './project.mjs';
import { META_CLIENT_INFO, META_VERSION } from './protocol.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '..', 'mcp.mjs');
const ROOT = resolve(HERE, '..', '..');
const INIT = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test-client', version: '1' } };
const MODERN = { [META_VERSION]: '2026-07-28', [META_CLIENT_INFO]: { name: 'modern-client', version: '1' } };

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

async function withClient(args, fn) {
  const c = new StdioClient(ENTRY, ['--project', ROOT, ...args]);
  try { return await fn(c); } finally { await c.close(); }
}
async function handshake(c) {
  const r = await c.request(1, 'initialize', INIT);
  c.notify('notifications/initialized');
  return r;
}

test('legacy handshake: initialize, list, call; stdout is protocol-only', async () => {
  await withClient([], async (c) => {
    const init = await handshake(c);
    assert.equal(init.result.protocolVersion, '2025-11-25');
    assert.equal(init.result.serverInfo.name, 'tien-nghich-2d-studio');
    assert.ok(init.result.capabilities.tools);

    const list = await c.request(2, 'tools/list', {});
    const [tool, ...rest] = list.result.tools;
    assert.equal(rest.length, 0);
    assert.equal(tool.name, 'studio_project_info');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(list.result.resultType, undefined, 'legacy results carry no resultType');

    const call = await c.request(3, 'tools/call', { name: 'studio_project_info', arguments: {} });
    const s = call.result.structuredContent;
    assert.notEqual(call.result.isError, true);
    assert.deepEqual(JSON.parse(call.result.content[0].text), s, 'text block mirrors structuredContent');

    // Palette: 40 ids with hex, equal to the source file.
    const pal = readJson('tools/generators/palette.json');
    assert.equal(s.palette.count, 40);
    assert.deepEqual(s.palette.colors.map((x) => [x.id, x.hex]), pal.colors.map((x) => [x.id, x.hex]));
    assert.deepEqual(s.palette.outline, { id: 'ink_01', hex: '#14101a' });
    // Counts agree with an independent read of the manifests.
    const base = readJson('assets/manifest.json');
    assert.equal(s.assetCounts.base.total, base.assets.length);
    assert.deepEqual(s.assetCounts.base.byCategory, base.summary.by_category);
    assert.equal(s.assetCounts.longtime.total, readJson('assets/manifest_longtime.json').assets.length);
    assert.equal(s.assetCounts.audio.idsByGroup['core.bgm'], readJson('assets/audio_manifest.json').core.bgm.length);
    // Rules, size classes and key templates are present.
    assert.equal(s.rules.alpha.values.join(), '0,255');
    assert.equal(s.rules.outline.widthPx, 1);
    assert.deepEqual(s.sizeClasses.longtimeProfiles.boss.nativePx, [64, 64]);
    assert.ok(s.frameKeys.some((k) => k.key === 'longtime/{id}/{clip}_{direction}_{n}'));
    assert.equal(s.connection.agent, 'test-client');
    assert.equal(s.connection.scope, 'read');

    const sub = await c.request(4, 'tools/call', { name: 'studio_project_info', arguments: { sections: ['palette'] } });
    assert.deepEqual(Object.keys(sub.result.structuredContent).sort(), ['connection', 'palette', 'project']);

    for (const line of c.stdoutLines) assert.equal(JSON.parse(line).jsonrpc, '2.0', `non-protocol stdout line: ${line}`);
    assert.match(c.stderr, /serving/, 'diagnostics go to stderr');
  });
});

test('legacy version negotiation', async () => {
  await withClient([], async (c) => {
    const old = await c.request(1, 'initialize', { ...INIT, protocolVersion: '2025-06-18' });
    assert.equal(old.result.protocolVersion, '2025-06-18');
    const unknown = await c.request(2, 'initialize', { ...INIT, protocolVersion: '1999-01-01' });
    assert.equal(unknown.result.protocolVersion, '2025-11-25', 'server answers with a version it supports');
  });
});

test('legacy ping works; ids of both types are echoed', async () => {
  await withClient([], async (c) => {
    await handshake(c);
    assert.deepEqual((await c.request('abc', 'ping', {})).result, {});
    assert.equal((await c.request(7, 'ping')).id, 7);
  });
});

test('modern stateless: discover, list, call, unsupported version', async () => {
  await withClient([], async (c) => {
    const d = await c.request('d', 'server/discover', { _meta: MODERN });
    assert.deepEqual(d.result.supportedVersions, ['2026-07-28']);
    assert.equal(d.result.resultType, 'complete');
    assert.equal(d.result._meta['io.modelcontextprotocol/serverInfo'].name, 'tien-nghich-2d-studio');
    assert.ok(d.result.capabilities.tools);

    const bare = await c.request('d2', 'server/discover'); // probe without _meta is allowed
    assert.ok(bare.result.supportedVersions);

    const l = await c.request('l', 'tools/list', { _meta: MODERN });
    assert.equal(l.result.resultType, 'complete');
    assert.equal(typeof l.result.ttlMs, 'number');
    assert.equal(l.result.cacheScope, 'private');
    const call = await c.request('c', 'tools/call', { name: 'studio_project_info', arguments: {}, _meta: MODERN });
    assert.equal(call.result.resultType, 'complete');
    assert.equal(call.result.structuredContent.connection.agent, 'modern-client');
    assert.equal(call.result.structuredContent.connection.protocolEra, 'modern');

    const bad = await c.request('u', 'tools/list', { _meta: { [META_VERSION]: '1900-01-01' } });
    assert.equal(bad.error.code, -32022);
    assert.deepEqual(bad.error.data, { supported: ['2026-07-28'], requested: '1900-01-01' });
    assert.equal((await c.request('p', 'ping', { _meta: MODERN })).error.code, -32601, 'ping was removed in 2026-07-28');
  });
});

test('requests with no protocol version are rejected until initialize', async () => {
  await withClient([], async (c) => {
    const r = await c.request(1, 'tools/list', {});
    assert.equal(r.error.code, -32602);
    assert.match(r.error.message, /initialize/);
    assert.deepEqual((await c.request(2, 'tools/list', { _meta: MODERN })).result.tools.length, 1, 'server still healthy');
  });
});

test('malformed input: JSON-RPC errors and survival', async () => {
  await withClient([], async (c) => {
    await handshake(c);
    c.writeRaw('{this is not json');
    c.writeRaw('[{"jsonrpc":"2.0","id":9,"method":"ping"}]'); // batch
    c.writeRaw('{"jsonrpc":"1.0","id":10,"method":"ping"}');
    c.writeRaw('{"jsonrpc":"2.0","id":11}'); // no method
    c.writeRaw('{"jsonrpc":"2.0","id":null,"method":"ping"}');
    c.writeRaw('{"jsonrpc":"2.0","id":1.5,"method":"ping"}');
    c.writeRaw('{"jsonrpc":"2.0","id":12,"method":"ping","params":[1]}');
    c.writeRaw(''); // blank line: ignored, not echoed
    c.notify('notifications/never-heard-of-it'); // unknown notification: no reply
    const unknown = await c.request(13, 'resources/list', {});
    assert.equal(unknown.error.code, -32601);
    const byId = (id) => c.stdoutLines.map((l) => JSON.parse(l)).filter((m) => m.id === id);
    const parsed = c.stdoutLines.map((l) => JSON.parse(l));
    assert.equal(parsed.filter((m) => m.error?.code === -32700).length, 1);
    assert.equal(parsed.filter((m) => m.id === null && m.error?.code === -32600).length, 3, 'batch, null id, fractional id');
    assert.equal(byId(10)[0].error.code, -32600);
    assert.equal(byId(11)[0].error.code, -32600);
    assert.equal(byId(12)[0].error.code, -32602);
    // initialize + parse error + batch + ids 10,11 + null id + fractional id + id 12 + id 13 = 9 lines; nothing for the blank line or notification.
    assert.equal(parsed.length, 9);
    assert.equal((await c.request(14, 'ping', {})).result !== undefined, true);
  });
});

test('tools/call protocol errors vs tool execution errors', async () => {
  await withClient([], async (c) => {
    await handshake(c);
    const unknown = await c.request(1, 'tools/call', { name: 'nope', arguments: {} });
    assert.equal(unknown.error.code, -32602);
    assert.match(unknown.error.message, /Unknown tool: nope/);
    assert.equal((await c.request(2, 'tools/call', {})).error.code, -32602, 'missing name');
    assert.equal((await c.request(3, 'tools/call', { name: 7 })).error.code, -32602);
    assert.equal((await c.request(4, 'tools/call', { name: 'studio_project_info', arguments: [] })).error.code, -32602);
    for (const args of [{ sections: ['bogus'] }, { extra: 1 }, { sections: 'palette' }]) {
      const r = await c.request(5, 'tools/call', { name: 'studio_project_info', arguments: args });
      assert.equal(r.error, undefined, 'bad arguments are an execution error, not a protocol error');
      assert.equal(r.result.isError, true);
      assert.match(r.result.content[0].text, /Invalid arguments/);
    }
  });
});

test('agent name: client-reported by default, --agent wins; audit log records calls', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'studio-mcp-'));
  const log = join(dir, 'audit.jsonl');
  try {
    await withClient(['--agent', 'codex', '--audit-log', log], async (c) => {
      await handshake(c);
      const r = await c.request(2, 'tools/call', { name: 'studio_project_info', arguments: { sections: [] } });
      assert.equal(r.result.structuredContent.connection.agent, 'codex');
      await c.request(3, 'tools/call', { name: 'studio_project_info', arguments: { bad: true } });
    });
    const recs = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(recs.length, 2);
    assert.deepEqual([recs[0].agent, recs[0].tool, recs[0].ok, recs[0].scope, recs[0].era], ['codex', 'studio_project_info', true, 'read', 'legacy']);
    assert.equal(recs[1].ok, false);
    assert.ok(recs[1].ts && typeof recs[1].ms === 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('startup failures are loud on stderr and silent on stdout', async () => {
  for (const args of [['--project', join(tmpdir(), 'definitely-not-here-studio')], ['--scope', 'root'], ['--bogus']]) {
    const c = new StdioClient(ENTRY, args);
    const { code } = await c.exited;
    assert.equal(code, 2);
    assert.equal(c.stdoutLines.length, 0);
    assert.match(c.stderr, /studio-mcp:/);
  }
});

test('the process exits 0 on stdin EOF after answering in-flight requests', async () => {
  const c = new StdioClient(ENTRY, ['--project', ROOT]);
  c.writeRaw({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INIT });
  c.writeRaw({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  c.proc.stdin.end();
  assert.equal((await c.exited).code, 0);
  assert.equal(c.stdoutLines.length, 2);
});

test('--self-test passes', async () => {
  const c = new StdioClient(ENTRY, ['--project', ROOT, '--self-test']);
  const { code } = await c.exited;
  assert.equal(code, 0, c.stderr);
  assert.match(c.stderr, /self-test PASSED/);
  assert.equal(c.stdoutLines.length, 0);
});

// ---- in-process: registry, scopes, schema, project seam ----------------------------------

const fakeProject = {};
const mkServer = (scope, registry) => new McpServer({ registry, project: fakeProject, scope, agent: 'unit' });
const call = (s, name, args) => s.handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, _meta: MODERN } });

test('registry: scopes gate listing and calling; handlers get ctx; ToolError is an execution error', async () => {
  const seen = [];
  const reg = new ToolRegistry()
    .register({ name: 'r', description: 'read tool', scope: 'read', inputSchema: { type: 'object' }, handler: (a, ctx) => { seen.push(ctx.caller.agent); return { ok: 1 }; } })
    .register({ name: 'a', description: 'author tool', scope: 'author', inputSchema: { type: 'object' }, handler: () => { throw new ToolError('nope, by design'); } })
    .register({ name: 'p', description: 'pack tool', scope: 'pack', inputSchema: { type: 'object', required: ['x'], properties: { x: { type: 'integer', minimum: 1 } } }, handler: ({ x }) => ({ x }) });
  const names = (scope) => reg.list(scope).map((t) => t.name);
  assert.deepEqual(names('read'), ['r']);
  assert.deepEqual(names('author'), ['a', 'r']);
  assert.deepEqual(names('pack'), ['a', 'p', 'r']);
  assert.ok(scopeAllows('pack', 'read') && !scopeAllows('read', 'author'));

  const read = mkServer('read', reg);
  assert.deepEqual((await call(read, 'r', {})).result.structuredContent, { ok: 1 });
  assert.deepEqual(seen, ['unit']);
  const denied = (await call(read, 'p', { x: 1 })).result;
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /needs scope "pack"/);
  const list = await read.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: MODERN } });
  assert.deepEqual(list.result.tools.map((t) => t.name), ['r'], 'tools above the scope are hidden');

  const author = mkServer('author', reg);
  const te = (await call(author, 'a', {})).result;
  assert.equal(te.isError, true);
  assert.equal(te.content[0].text, 'nope, by design');
  const packed = mkServer('pack', reg);
  assert.equal((await call(packed, 'p', { x: 0 })).result.isError, true);
  assert.deepEqual((await call(packed, 'p', { x: 2 })).result.structuredContent, { x: 2 });
});

test('registry rejects bad definitions', () => {
  const ok = { name: 't', description: 'd', scope: 'read', inputSchema: { type: 'object' }, handler() {} };
  const reg = new ToolRegistry().register(ok);
  assert.throws(() => reg.register(ok), /duplicate/);
  assert.throws(() => new ToolRegistry().register({ ...ok, name: 'bad name' }), /bad tool name/);
  assert.throws(() => new ToolRegistry().register({ ...ok, scope: 'root' }), /scope/);
  assert.throws(() => new ToolRegistry().register({ ...ok, inputSchema: { type: 'string' } }), /object schema/);
  assert.throws(() => new ToolRegistry().register({ ...ok, inputSchema: { type: 'object', properties: { a: { $ref: '#/x' } } } }), /\$ref/);
});

test('a throwing handler becomes a generic execution error and does not leak internals', async () => {
  const reg = new ToolRegistry().register({ name: 'boom', description: 'd', scope: 'read', inputSchema: { type: 'object' }, handler() { throw new Error('secret path /etc/x'); } });
  const r = (await call(mkServer('read', reg), 'boom', {})).result;
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.content[0].text, /secret/);
});

test('schema validator subset', () => {
  const s = { type: 'object', required: ['n'], additionalProperties: false, properties: {
    n: { type: 'integer', minimum: 0, maximum: 5 }, s: { type: 'string', pattern: '^a+$', maxLength: 3 },
    l: { type: 'array', items: { enum: ['x', 'y'] }, maxItems: 2 }, u: { anyOf: [{ type: 'null' }, { type: 'boolean' }] } } };
  assert.deepEqual(validate({ n: 1, s: 'aa', l: ['x'], u: null }, s), []);
  assert.equal(validate({}, s).length, 1);
  assert.equal(validate({ n: 1.5 }, s).length, 1);
  assert.equal(validate({ n: 9 }, s).length, 1);
  assert.equal(validate({ n: 1, s: 'bbbb' }, s).length, 2);
  assert.equal(validate({ n: 1, l: ['z', 'x', 'y'] }, s).length, 2);
  assert.equal(validate({ n: 1, u: 3 }, s).length, 1);
  assert.equal(validate({ n: 1, zzz: 1 }, s).length, 1);
  assert.throws(() => assertSupportedSchema({ type: 'object', properties: { a: { not: {} } } }), /not/);
});

test('schema validator ignores inherited Object.prototype members', () => {
  const closed = { type: 'object', properties: {}, additionalProperties: false };
  for (const key of ['toString', 'constructor', 'hasOwnProperty', 'valueOf']) {
    const errs = validate(JSON.parse(`{"${key}": 1}`), closed);
    assert.deepEqual(errs, [`$: unexpected property "${key}"`]);
  }
  assert.equal(validate({}, { type: 'object', required: ['toString'] }).length, 1, 'inherited toString does not satisfy required');
  assert.equal(validate({ toString: 'x' }, { type: 'object', required: ['toString'], properties: { toString: { type: 'integer' } } }).length, 1, 'own toString is validated against its schema');
  assert.deepEqual(validate(JSON.parse('{"__proto__": 1}'), closed), ['$: unexpected property "__proto__"']);
});

test('project module: opens the repo and rejects a bad root', () => {
  const p = openProject(ROOT);
  assert.equal(p.source, 'legacy-files');
  assert.equal(p.palette().count, 40);
  assert.throws(() => openProject(join(tmpdir(), 'nope-studio-xyz')), /not a directory/);
  assert.throws(() => openProject(HERE), /missing assets\/manifest\.json/);
});
