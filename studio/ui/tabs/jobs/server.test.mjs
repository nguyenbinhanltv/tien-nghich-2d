import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createMcpHttp } from '../../../mcp/http.mjs';
import { makeProject } from '../../../mcp/testkit.mjs';
import { revisionStore } from '../../../core/store.mjs';
import { openStudioDb } from '../../../core/studio-db.mjs';
import { bareFrame, agentTag } from '../../../core/review.mjs';
import { encodePixels } from '../../../core/png.mjs';
import { handle, shapeJob } from './server.mjs';

const META = {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {name: 'jobs-test', version: '1'}};

async function start({exposeJobs}) {
  const project = makeProject();
  const lib = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'jobs-lib-'));
  const mcp = createMcpHttp({root: project.root, libraryDir: lib});
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (exposeJobs && url.pathname === '/mcp/jobs') { res.writeHead(200, {'Content-Type': 'application/json'}); return res.end(JSON.stringify({jobs: mcp.jobs.list()})); }
    mcp.handle(req, res, url, server.address());
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const callTool = name => fetch(`http://127.0.0.1:${address.port}/mcp`, {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': 'tools/call', 'Mcp-Name': name},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: {}, _meta: META}})}).then(r => r.json());
  const feed = async (since = 0, ctx = {}) => {
    let status = 200, out;
    try { await handle({method: 'GET'}, {writeHead(s) { status = s; }, end(t) { out = JSON.parse(t); }}, new URL(`http://127.0.0.1/api/tabs/jobs/feed?since=${since}`), {root: project.root, address, prefix: '/api/tabs/jobs/', libraryDir: lib, ...ctx}); }
    catch (error) { return {status: error.status, error: error.code}; }
    return {status, body: out};
  };
  return {project, lib, mcp, address, callTool, feed, close: async () => { server.close(); mcp.close?.(); await project.cleanup(); }};
}

test('the feed shows tool calls with agent, session, outcome, and jobs with state, owner and duration', async () => {
  const t = await start({exposeJobs: true});
  try {
    await t.callTool('studio_project_info');
    const ok = t.mcp.jobs.submit({name: 'qa_run', owner: {agent: 'codex', session: '3fa9c120'}, run: async ({log}) => { log('checking 12 frames'); return {pass: true}; }});
    const bad = t.mcp.jobs.submit({name: 'diff', owner: {agent: 'antigravity', session: '77d01e5b'}, run: async () => { throw new Error('boom'); }});
    await Promise.all([t.mcp.jobs.wait(ok.id, 5000), t.mcp.jobs.wait(bad.id, 5000)]);
    const {status, body} = await t.feed();
    assert.equal(status, 200);
    assert.equal(body.jobs.available, true);
    const byId = Object.fromEntries(body.jobs.items.map(j => [j.id, j]));
    assert.deepEqual([byId[ok.id].status, byId[ok.id].name, byId[ok.id].owner, byId[ok.id].log], ['succeeded', 'qa_run', {agent: 'codex', session: '3fa9c120'}, [byId[ok.id].log[0]]]);
    assert.match(byId[ok.id].log[0], /checking 12 frames$/);
    assert.equal(typeof byId[ok.id].wallMs, 'number');
    assert.equal(byId[bad.id].status, 'failed');
    assert.equal(byId[bad.id].error.message, 'boom');
    assert.ok(!('result' in byId[ok.id]));
    const call = body.activity.events.find(e => e.tool === 'studio_project_info');
    assert.equal(call.ok, true);
    assert.equal(typeof call.ms, 'number');
    // incremental: nothing new since the cursor
    assert.deepEqual((await t.feed(body.activity.next)).body.activity.events, []);
    // a cursor from before a restart is ahead of the server: the client sees next go backwards
    assert.ok((await t.feed(9999)).body.activity.next < 9999);
  } finally { await t.close(); }
});

test('without a /mcp/jobs route the feed still works and says the jobs are unavailable', async () => {
  const t = await start({exposeJobs: false});
  try {
    await t.callTool('studio_project_info');
    const {body} = await t.feed();
    assert.deepEqual([body.jobs.available, body.jobs.status, body.jobs.items], [false, 404, []]);
    assert.ok(body.activity.events.length >= 1);
  } finally { await t.close(); }
});

test('sessions link to review items and checked assets by agent and session', async () => {
  const t = await start({exposeJobs: true});
  try {
    const store = revisionStore(t.project.root, '.inspector-revisions', t.lib);
    const px = Buffer.alloc(64); for (let i = 0; i < 16; i++) px.set([5, 0, 0, 255], i * 4);
    store.operate(bareFrame('longtime/lt_kiln_keeper/idle_south_0', {assetId: 'lt_kiln_keeper'}), encodePixels(4, 4, px), 'review', {revision: 0, text: agentTag({agent: 'codex', session: '3fa9c120ffff'}) + ' REVIEW REQUEST rq-1: look'});
    store.close();
    const db = openStudioDb(t.lib);
    db.recordCheck({asset: 'lt_kiln_keeper', stage: 'raw', content: 'c', session: '3fa9c120ffffffff', agent: 'codex', independent: false, pass: true, errors: 0, warnings: 0});
    db.close();
    t.mcp.jobs.submit({name: 'qa_run', owner: {agent: 'codex', session: '3fa9c120'}, run: async () => ({})});
    await new Promise(r => setTimeout(r, 50));
    const {body} = await t.feed();
    const link = body.links['codex|3fa9c120'];
    assert.deepEqual(link.reviews.map(r => [r.key, r.assetId, r.revision]), [['longtime/lt_kiln_keeper/idle_south_0', 'lt_kiln_keeper', 0]]);
    assert.equal(link.assets[0].id, 'lt_kiln_keeper');
    assert.equal(link.assets[0].via, 'checked');
  } finally { await t.close(); }
});

test('refuses writes, unknown routes, non-loopback listeners; reports an unreachable feed', async () => {
  const t = await start({exposeJobs: true});
  try {
    const run = async (method, name, address = t.address) => {
      try { await handle({method}, {writeHead() {}, end() {}}, new URL('http://127.0.0.1/api/tabs/jobs/' + name), {root: t.project.root, address, prefix: '/api/tabs/jobs/', libraryDir: t.lib}); return 'ok'; }
      catch (error) { return error.code; }
    };
    assert.equal(await run('POST', 'feed'), 'method_not_allowed');
    assert.equal(await run('GET', 'other'), 'unknown_route');
    assert.equal(await run('GET', 'feed', {address: '10.0.0.5', port: 1}), 'forbidden');
    assert.equal(await run('GET', 'feed', {address: '127.0.0.1', port: 1}), 'upstream_unavailable');
  } finally { await t.close(); }
});

test('shapeJob drops results and bounds text', () => {
  const j = shapeJob({id: 'job-1', name: 'x', status: 'failed', owner: {agent: 'a', session: 's'}, createdAt: 'c', result: {secret: 1}, error: {message: 'e'.repeat(900)}, log: Array.from({length: 40}, (_, i) => 'l' + i), logLines: 40, cost: {wallMs: 5}});
  assert.ok(!('result' in j));
  assert.equal(j.error.message.length, 300);
  assert.equal(j.log.length, 20);
  assert.equal(j.wallMs, 5);
});
