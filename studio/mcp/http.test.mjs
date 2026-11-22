import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createMcpHttp } from './http.mjs';
import { TokenStore } from './tokens.mjs';
import { PROVENANCE, REPO, clipFrames, makeProject } from './testkit.mjs';
import { buildRegistry } from './tools/index.mjs';

const META = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'http-test', version: '1' } };
const text = (r) => r.result?.content?.[0]?.text ?? r.error?.message ?? '';

// A real HTTP server around the handler, on a free loopback port, over a throwaway project.
async function start({ git = false, policy } = {}) {
  const p = makeProject({ git });
  const mcp = createMcpHttp({ root: p.root, policy });
  const server = http.createServer((req, res) => mcp.handle(req, res, new URL(req.url, 'http://127.0.0.1'), server.address()));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const send = (opts) => new Promise((resolve, reject) => {
    const body = opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
    const headers = { Host: `127.0.0.1:${port}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers };
    for (const k of Object.keys(headers)) if (headers[k] === undefined) delete headers[k]; // undefined means: leave this header out
    const req = http.request({ host: '127.0.0.1', port, path: opts.path ?? '/mcp', method: opts.method ?? 'POST', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); let json; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, raw, json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
  let id = 0;
  // A modern call with the required headers; `token` adds the bearer header.
  const modern = (method, params = {}, { token, headers } = {}) => send({
    body: { jsonrpc: '2.0', id: ++id, method, params: { ...params, _meta: META } },
    headers: { Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method,
      ...(method === 'tools/call' ? { 'Mcp-Name': params.name } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } }).then((r) => r.json);
  const tool = (name, args, opts) => modern('tools/call', { name, arguments: args }, opts);
  return { p, mcp, server, port, send, modern, tool, close: async () => { await new Promise((r) => server.close(r)); mcp.close(); await p.cleanup(); } };
}
const withServer = async (fn, opts) => { const s = await start(opts); try { return await fn(s); } finally { await s.close(); } };
const issue = (s, agent, scope) => s.mcp.tokens.issue({ agent, scope }).token;

test('MCP-010: Host, Origin and fetch-site checks: the same loopback rule as the editor API', () => withServer(async (s) => {
  const ok = await s.send({ body: { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } }, headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover' } });
  assert.equal(ok.status, 200);
  const ping = (headers) => s.send({ body: { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } }, headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover', ...headers } });
  for (const headers of [{ Host: 'evil.example' }, { Host: `127.0.0.1:${s.port + 1}` }, { Host: '127.0.0.1' }, { Origin: 'http://evil.example' }, { Origin: `http://127.0.0.1:${s.port + 1}` },
    { 'Sec-Fetch-Site': 'cross-site' }]) {
    const r = await ping(headers);
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.equal(r.json.error.code, -32600);
    assert.equal(r.json.id, null);
  }
  assert.equal((await ping({ Origin: `http://127.0.0.1:${s.port}` })).status, 200, 'same origin is fine');
  assert.equal((await ping({ 'Sec-Fetch-Site': 'same-origin' })).status, 200);
  assert.equal((await s.send({ method: 'GET', path: '/mcp/activity', headers: { Host: 'evil.example' } })).status, 403, 'the activity feed is guarded too');
}));

test('the endpoint is POST only, JSON only, bounded and strict about its body', () => withServer(async (s) => {
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const r = await s.send({ method });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.allow, 'POST');
  }
  assert.equal((await s.send({ method: 'POST', raw: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const bad = await s.send({ raw: '{nope' });
  assert.deepEqual([bad.status, bad.json.error.code], [400, -32700]);
  const big = await s.send({ raw: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'x'.repeat(5 * 1024 * 1024) } }) });
  assert.equal(big.status, 413);
  const batch = await s.send({ raw: '[{"jsonrpc":"2.0","id":1,"method":"ping"}]' });
  assert.deepEqual([batch.status, batch.json.error.code], [400, -32600]);
  assert.equal((await s.send({ path: '/mcp/elsewhere', raw: '{}' })).status, 404);
  // A notification is accepted with no body.
  const note = await s.send({ body: { jsonrpc: '2.0', method: 'notifications/cancelled', params: {} } });
  assert.deepEqual([note.status, note.raw], [202, '']);
}));

test('modern requests: headers must match the body', () => withServer(async (s) => {
  const base = (over = {}) => s.send({ body: { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'studio_project_info', arguments: {}, _meta: META } },
    headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': 'studio_project_info', ...over } });
  const good = await base();
  assert.equal(good.status, 200);
  assert.equal(good.json.id, 7);
  assert.equal(good.json.result.resultType, 'complete');
  assert.equal(good.json.result.structuredContent.connection.protocolEra, 'modern');
  for (const [over, why] of [[{ 'MCP-Protocol-Version': undefined }, /required/], [{ 'MCP-Protocol-Version': '2025-06-18' }, /does not match body/],
    [{ 'Mcp-Method': 'tools/list' }, /Mcp-Method/], [{ 'Mcp-Method': undefined }, /Mcp-Method/], [{ 'Mcp-Name': 'studio_diff' }, /Mcp-Name/], [{ 'Mcp-Name': undefined }, /Mcp-Name/]]) {
    const r = await base(over);
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.json.error.code, -32020);
    assert.match(r.json.error.message, why);
    assert.equal(r.json.id, 7);
  }
  assert.equal((await base({ 'Mcp-Name': `=?base64?${Buffer.from('studio_project_info').toString('base64')}?=` })).status, 200, 'a base64 Mcp-Name is decoded before comparing');
  const wrong = await s.send({ body: { jsonrpc: '2.0', id: 8, method: 'tools/list', params: { _meta: { ...META, 'io.modelcontextprotocol/protocolVersion': '1999-01-01' } } },
    headers: { 'MCP-Protocol-Version': '1999-01-01', 'Mcp-Method': 'tools/list' } });
  assert.equal(wrong.status, 400);
  assert.deepEqual(wrong.json.error.data, { supported: ['2026-07-28'], requested: '1999-01-01' });
  assert.equal(wrong.json.error.code, -32022);
  const unknown = await s.modern('resources/list', {});
  assert.equal(unknown.error.code, -32601);
  assert.equal((await s.send({ body: { jsonrpc: '2.0', id: 9, method: 'resources/list', params: { _meta: META } }, headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'resources/list' } })).status, 404);
}));

test('legacy clients: initialize mints a session id that every later request must carry', () => withServer(async (s) => {
  const init = await s.send({ body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old-client', version: '1' } } } });
  assert.equal(init.status, 200);
  assert.equal(init.json.result.protocolVersion, '2025-06-18');
  const sid = init.headers['mcp-session-id'];
  assert.match(sid, /^[0-9a-f]{32}$/);
  const withSid = (body) => s.send({ body, headers: { 'Mcp-Session-Id': sid, 'MCP-Protocol-Version': '2025-06-18' } });
  assert.equal((await withSid({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const list = await withSid({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.result.tools.map((t) => t.name), buildRegistry().list('read').map((t) => t.name).sort(), 'the same registry as stdio');
  assert.equal(list.json.result.resultType, undefined);
  const info = await withSid({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'studio_project_info', arguments: { sections: [] } } });
  assert.equal(info.json.result.structuredContent.connection.agent, 'old-client');
  assert.equal(info.json.result.structuredContent.connection.protocolEra, 'legacy');
  assert.deepEqual((await withSid({ jsonrpc: '2.0', id: 4, method: 'ping' })).json.result, {});

  const noSession = await s.send({ body: { jsonrpc: '2.0', id: 5, method: 'tools/list' } });
  assert.equal(noSession.json.error.code, -32602, 'no handshake and no session: the server explains both ways in');
  assert.match(noSession.json.error.message, /initialize/);
  const gone = await s.send({ body: { jsonrpc: '2.0', id: 6, method: 'tools/list' }, headers: { 'Mcp-Session-Id': 'f'.repeat(32) } });
  assert.equal(gone.status, 404);
}));

test('tokens give identity and scope; no token means read only; a bad token is refused', () => withServer(async (s) => {
  const anon = await s.tool('studio_project_info', {});
  assert.equal(anon.result.structuredContent.connection.scope, 'read');
  assert.equal(anon.result.structuredContent.connection.agent, 'http-test', 'unauthenticated: the self-reported name, for display only');
  assert.match(text(await s.tool('studio_asset_plan', { op: 'create', id: 'lt_x_one', profile: 'npc', chunk: 'abode', brief: 'b' })), /needs scope "author"/);

  const token = issue(s, 'codex', 'author');
  const plan = await s.tool('studio_asset_plan', { op: 'create', id: 'lt_http_monk', profile: 'npc', chunk: 'abode', brief: 'A monk reached over HTTP.' }, { token });
  assert.equal(plan.result.structuredContent.created, true);
  assert.equal(plan.result.structuredContent.entry.studio.createdBy.agent, 'codex', 'the token\'s agent, not the client\'s own claim');
  const info = await s.tool('studio_project_info', {}, { token });
  assert.deepEqual([info.result.structuredContent.connection.agent, info.result.structuredContent.connection.scope], ['codex', 'author']);

  const forged = await s.send({ body: { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } }, headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover', Authorization: 'Bearer studio_deadbeef.aaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
  assert.equal(forged.status, 401);
  for (const bad of ['Basic abc', 'Bearer', `Bearer ${token}x`, 'Bearer studio_zz.yy']) {
    const r = await s.send({ body: { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } }, headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover', Authorization: bad } });
    assert.equal(r.status, 401, bad);
  }
  assert.equal(s.mcp.tokens.revoke(s.mcp.tokens.list()[0].id), true);
  assert.equal((await s.send({ body: { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } }, headers: { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover', Authorization: `Bearer ${token}` } })).status, 401, 'a revoked token stops working at once');
}));

test('over HTTP the session is the token: another token may check, the same token may not', () => withServer(async (s) => {
  const author = issue(s, 'codex', 'author'), checker = issue(s, 'antigravity', 'author');
  await s.tool('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) }, { token: author });
  const self = await s.tool('studio_qa_run', { assetId: 'lt_seed_broker', independent: true }, { token: author });
  assert.equal(self.result.isError, true);
  assert.match(text(self), /different session/);
  const other = await s.tool('studio_qa_run', { assetId: 'lt_seed_broker', independent: true }, { token: checker });
  assert.equal(other.result.structuredContent.recorded.independent, true);
  const asked = await s.tool('studio_review_request', { assetId: 'lt_seed_broker', note: 'Over HTTP.' }, { token: author });
  assert.equal(asked.result.isError, undefined, text(asked));
  assert.equal(asked.result.structuredContent.asked, 4);
  assert.equal(asked.result.structuredContent.independentCheck.agent, 'antigravity');
  // An unauthenticated caller cannot impersonate either: it is a different, read-only session.
  const anon = await s.tool('studio_qa_run', { assetId: 'lt_seed_broker', independent: true });
  assert.match(text(anon), /needs scope "author"/);
}));

test('a legacy session is bound to the token that opened it', () => withServer(async (s) => {
  const a = issue(s, 'one', 'author'), b = issue(s, 'two', 'author');
  const init = await s.send({ body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }, headers: { Authorization: `Bearer ${a}` } });
  const sid = init.headers['mcp-session-id'];
  const call = (token) => s.send({ body: { jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers: { 'Mcp-Session-Id': sid, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  assert.equal((await call(a)).status, 200);
  assert.equal((await call(b)).status, 403, 'another token cannot ride this session');
  assert.equal((await call(null)).status, 403, 'neither can an anonymous caller');
  const info = await s.send({ body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'studio_project_info', arguments: { sections: [] } } }, headers: { 'Mcp-Session-Id': sid, Authorization: `Bearer ${a}` } });
  assert.equal(info.json.result.structuredContent.connection.agent, 'one');
}));

test('the activity feed shows who did what, without arguments or secrets', () => withServer(async (s) => {
  const token = issue(s, 'codex', 'author');
  await s.tool('studio_project_info', { sections: ['palette'] }, { token });
  await s.tool('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1) }, { token });
  await s.tool('studio_catalog_search', { limit: 0 }, { token });
  await s.tool('studio_asset_get', { assetId: 'lt_secret_name_zzz' }, { token });
  const feed = (await s.send({ method: 'GET', path: '/mcp/activity' })).json;
  assert.deepEqual(feed.events.map((e) => e.tool), ['studio_project_info', 'studio_frames_submit', 'studio_catalog_search', 'studio_asset_get']);
  assert.deepEqual(feed.events.map((e) => e.ok), [true, true, false, false]);
  assert.equal(feed.events.some((e) => 'reason' in e), false, 'no failure text in the feed');
  assert.equal(feed.events[0].agent, 'codex');
  assert.equal(feed.events[0].scope, 'author');
  assert.match(feed.events[0].session, /^h-[0-9a-f]{8}$/);
  const dump = JSON.stringify(feed);
  assert.doesNotMatch(dump, new RegExp(token.split('.')[1]), 'no token secret');
  assert.doesNotMatch(dump, /pngBase64|sourceHash|seed broker|lt_secret_name_zzz|Did you mean/, 'no arguments');
  const later = (await s.send({ method: 'GET', path: `/mcp/activity?since=${feed.events[1].seq}` })).json;
  assert.deepEqual(later.events.map((e) => e.tool), ['studio_catalog_search', 'studio_asset_get']);
  assert.equal(later.next, feed.next);
  assert.equal((await s.send({ method: 'POST', path: '/mcp/activity', raw: '{}' })).status, 405);
}));

test('the token store keeps only hashes, in a private file, and revokes cleanly', () => {
  const p = makeProject({ git: false });
  try {
    const dir = join(p.root, '.inspector-revisions');
    const store = new TokenStore(dir);
    const t = store.issue({ agent: 'codex', scope: 'author' });
    assert.match(t.token, /^studio_[0-9a-f]{8}\.[A-Za-z0-9_-]{32}$/);
    const file = join(dir, 'mcp-tokens.json');
    const raw = readFileSync(file, 'utf8');
    assert.doesNotMatch(raw, new RegExp(t.token.split('.')[1]), 'the secret is not stored');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(store.verify(t.token), { id: t.id, agent: 'codex', scope: 'author' });
    assert.equal(store.verify(t.token.slice(0, -1) + (t.token.endsWith('a') ? 'b' : 'a')), null);
    assert.equal(store.verify('studio_00000000.' + 'a'.repeat(32)), null);
    assert.equal(store.verify(undefined), null);
    assert.deepEqual(store.list().map((x) => Object.keys(x).sort()), [['agent', 'created', 'id', 'scope']]);
    assert.throws(() => store.issue({ agent: '', scope: 'read' }), /agent name/);
    assert.throws(() => store.issue({ agent: 'x', scope: 'root' }), /scope must be/);
    assert.equal(store.revoke(t.id), true);
    assert.equal(store.revoke(t.id), false);
    assert.equal(store.verify(t.token), null);
  } finally { p.cleanup(); }
});

test('the CLI issues, lists and revokes tokens without serving', () => {
  const p = makeProject({ git: false });
  try {
    const run = (...args) => execFileSync(process.execPath, [join(REPO, 'studio/mcp.mjs'), '--project', p.root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const out = run('--issue-token', '--agent', 'codex', '--scope', 'author');
    const token = /(studio_[0-9a-f]{8}\.[A-Za-z0-9_-]+)/.exec(out)[1];
    assert.match(out, /shown once/);
    const list = JSON.parse(run('--list-tokens'));
    assert.deepEqual([list[0].agent, list[0].scope], ['codex', 'author']);
    assert.doesNotMatch(JSON.stringify(list), new RegExp(token.split('.')[1]));
    assert.equal(existsSync(join(p.root, '.inspector-revisions/mcp-tokens.json')), true);
    assert.throws(() => run('--issue-token', '--scope', 'read'), /needs --agent/);
    assert.match(run('--revoke-token', list[0].id), /revoked/);
    assert.deepEqual(JSON.parse(run('--list-tokens')), []);
  } finally { p.cleanup(); }
});

test('studio/serve.mjs mounts /mcp next to the editor API, and its checks apply', async () => {
  const { createPreviewServer } = await import('../serve.mjs');
  const server = createPreviewServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const get = (path, opts = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { Host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(opts.body);
  });
  try {
    assert.equal((await get('/mcp')).status, 405);
    assert.equal((await get('/mcp', { headers: { Host: 'evil.example' } })).status, 403);
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: META } });
    const r = await get('/mcp', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'server/discover' } });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.text).result.supportedVersions, ['2026-07-28']);
    assert.equal((await get('/studio/')).status, 200, 'the rest of the server is unchanged');
    assert.equal((await get('/api/editor/frames')).status === 200 || (await get('/api/editor/frames')).status === 500, true, 'the editor route is still routed');
  } finally { await new Promise((r) => server.close(r)); }
});

test('GET /mcp/jobs: views of the jobs, newest first, capped, with no results or payloads; same checks as /mcp', () => withServer(async (s) => {
  const token = issue(s, 'codex', 'author');
  const jobs = () => s.send({ method: 'GET', path: '/mcp/jobs' });
  assert.deepEqual((await jobs()).json, { jobs: [] }, 'empty before any job');

  // Two real background jobs through the tool, then one that fails.
  await s.tool('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 4) }, { token });
  const a = (await s.tool('studio_qa_run', { assetId: 'lt_seed_broker', background: true }, { token })).result.structuredContent.jobId;
  const b = (await s.tool('studio_preview_render', { assetId: 'lt_seed_broker', background: true }, { token })).result.structuredContent.jobId;
  await s.mcp.jobs.wait(a, 10000); await s.mcp.jobs.wait(b, 10000);
  const bad = s.mcp.jobs.submit({ name: 'diff', owner: { agent: 'codex', session: 'abcd1234' }, meta: { assetId: 'lt_nothing' }, run: async () => { throw new Error('it broke: /secret/path'); } });
  await s.mcp.jobs.wait(bad.id, 5000);

  const r = await jobs();
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /application\/json/);
  assert.deepEqual(r.json.jobs.map((j) => [j.id, j.tool, j.state]), [[bad.id, 'diff', 'failed'], [b, 'preview_render', 'succeeded'], [a, 'qa_run', 'succeeded']], 'newest first');
  const [failed, preview] = r.json.jobs;
  assert.deepEqual(Object.keys(preview).sort(), ['agent', 'assetId', 'createdAt', 'durationMs', 'endedAt', 'id', 'session', 'startedAt', 'state', 'tool']);
  assert.deepEqual([preview.agent, preview.assetId], ['codex', 'lt_seed_broker']);
  assert.match(preview.session, /^h-[0-9a-f]{8}$|^[0-9a-f]{8}$|^h-/);
  assert.ok(Number.isInteger(preview.durationMs) && preview.durationMs >= 0);
  assert.ok(Date.parse(preview.createdAt) <= Date.parse(preview.startedAt) && Date.parse(preview.startedAt) <= Date.parse(preview.endedAt));
  assert.deepEqual([failed.error, failed.assetId, failed.session], ['it broke: /secret/path', 'lt_nothing', 'abcd1234'], 'a failure carries its message and nothing else');
  assert.equal('error' in preview, false);
  const dump = JSON.stringify(r.json);
  assert.doesNotMatch(dump, /"result"|"log"|"content"|"structuredContent"|pngBase64|image\/png|sourceHash|seed broker/, 'views only: no payloads');
  assert.doesNotMatch(dump, new RegExp(token.split('.')[1]), 'no token secret');

  assert.equal((await s.send({ method: 'GET', path: '/mcp/jobs?limit=2' })).json.jobs.length, 2);
  assert.equal((await s.send({ method: 'GET', path: '/mcp/jobs?limit=0' })).json.jobs.length, 3, 'a bad limit falls back to the default');
  assert.equal((await s.send({ method: 'GET', path: '/mcp/jobs?limit=abc' })).json.jobs.length, 3);
  for (let i = 0; i < 205; i++) s.mcp.jobs.submit({ name: 'x', owner: {}, run: async () => 1 });
  assert.ok((await s.send({ method: 'GET', path: '/mcp/jobs?limit=100000' })).json.jobs.length <= 200, 'capped at 200');
  assert.equal((await jobs()).json.jobs.length, 50, 'default cap 50');

  // Same loopback, Host and Origin rules, and GET only.
  assert.equal((await s.send({ method: 'GET', path: '/mcp/jobs', headers: { Host: 'evil.example' } })).status, 403);
  assert.equal((await s.send({ method: 'GET', path: '/mcp/jobs', headers: { Origin: 'http://evil.example' } })).status, 403);
  assert.equal((await s.send({ method: 'GET', path: '/mcp/jobs', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await s.send({ method, path: '/mcp/jobs', raw: '{}' })).status, 405, method);
}));
