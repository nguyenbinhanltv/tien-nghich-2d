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

// jobs: 'real' (the server's own GET /mcp/jobs), 'missing' (a front that answers 404 for it, as an older server would)
// or 'junk' (200 with a body that is not JSON): the tab must report the jobs unavailable and keep the feed.
async function start({jobs = 'real'} = {}) {
  const project = makeProject();
  const lib = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'jobs-lib-'));
  const mcp = createMcpHttp({root: project.root, libraryDir: lib});
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (jobs === 'missing' && url.pathname === '/mcp/jobs') { res.writeHead(404, {'Content-Type': 'application/json'}); return res.end('{"error":"no"}'); }
    if (jobs === 'junk' && url.pathname === '/mcp/jobs') { res.writeHead(200, {'Content-Type': 'application/json'}); return res.end('<html>not json'); }
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
  const t = await start();
  try {
    await t.callTool('studio_project_info');
    const ok = t.mcp.jobs.submit({name: 'qa_run', owner: {agent: 'codex', session: '3fa9c120'}, run: async ({log}) => { log('checking 12 frames'); return {pass: true}; }});
    const bad = t.mcp.jobs.submit({name: 'diff', owner: {agent: 'antigravity', session: '77d01e5b'}, run: async () => { throw new Error('boom'); }});
    await Promise.all([t.mcp.jobs.wait(ok.id, 5000), t.mcp.jobs.wait(bad.id, 5000)]);
    const {status, body} = await t.feed();
    assert.equal(status, 200);
    assert.equal(body.jobs.available, true);
    const byId = Object.fromEntries(body.jobs.items.map(j => [j.id, j]));
    assert.deepEqual([byId[ok.id].status, byId[ok.id].name, byId[ok.id].owner], ['succeeded', 'qa_run', {agent: 'codex', session: '3fa9c120'}]);
    assert.deepEqual(byId[ok.id].log, [], 'the real /mcp/jobs lists views only: no log lines');
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

test('a jobs feed that is missing or returns junk: jobs reported unavailable, the activity feed still works', async () => {
  for (const [jobs, status] of [['missing', 404], ['junk', 0]]) {
    const t = await start({jobs});
    try {
      await t.callTool('studio_project_info');
      const {body} = await t.feed();
      assert.deepEqual([body.jobs.available, body.jobs.status, body.jobs.items], [false, status, []], jobs);
      assert.ok(body.activity.events.length >= 1, jobs);
    } finally { await t.close(); }
  }
});

test("the real GET /mcp/jobs is read by the tab: tool, state, agent, session, assetId, endedAt, durationMs, error", async () => {
  const t = await start();
  try {
    const ok = t.mcp.jobs.submit({name: 'qa_run', owner: {agent: 'codex', session: '3fa9c120'}, meta: {assetId: 'lt_kiln_keeper'}, run: async () => ({pass: true, secret: 'result'})});
    const bad = t.mcp.jobs.submit({name: 'diff', owner: {agent: 'antigravity', session: '77d01e5b'}, run: async () => { throw new Error('revision 3 does not exist'); }});
    await Promise.all([t.mcp.jobs.wait(ok.id, 5000), t.mcp.jobs.wait(bad.id, 5000)]);
    const raw = await fetch(`http://127.0.0.1:${t.address.port}/mcp/jobs`).then(r => r.json());
    assert.deepEqual(Object.keys(raw.jobs.find(j => j.id === ok.id)).sort(), ['agent', 'assetId', 'createdAt', 'durationMs', 'endedAt', 'id', 'session', 'startedAt', 'state', 'tool']);
    const {body} = await t.feed();
    assert.equal(body.jobs.available, true);
    const by = Object.fromEntries(body.jobs.items.map(j => [j.id, j]));
    assert.deepEqual([by[ok.id].name, by[ok.id].status, by[ok.id].owner, by[ok.id].assetId, typeof by[ok.id].wallMs, typeof by[ok.id].finishedAt], ['qa_run', 'succeeded', {agent: 'codex', session: '3fa9c120'}, 'lt_kiln_keeper', 'number', 'string']);
    assert.deepEqual([by[bad.id].status, by[bad.id].error.message], ['failed', 'revision 3 does not exist']);
    assert.ok(!JSON.stringify(body).includes('result'), 'no job result reaches the tab');
  } finally { await t.close(); }
});

test('sessions link to review items and checked assets by agent and session', async () => {
  const t = await start();
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

test('JOBS-001: refuses writes, unknown routes, non-loopback listeners; reports an unreachable feed', async () => {
  const t = await start();
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

test('JOBS-003: with an in-process MCP handler the feed makes no HTTP call, so a port undici blocks (4190) still works', async () => {
  const t = await start();
  const realFetch = globalThis.fetch;
  try {
    await t.callTool('studio_project_info');
    const job = t.mcp.jobs.submit({name: 'qa_run', owner: {agent: 'codex', session: '3fa9c120'}, run: async () => ({})});
    await t.mcp.jobs.wait(job.id, 5000);
    globalThis.fetch = () => { throw new Error('the feed must not call fetch'); };
    const {status, body} = await t.feed(0, {address: {address: '127.0.0.1', port: 4190}, mcp: async () => t.mcp});
    assert.equal(status, 200);
    assert.equal(body.jobs.available, true);
    assert.ok(body.jobs.items.some(j => j.id === job.id));
    assert.ok(body.activity.events.some(e => e.tool === 'studio_project_info'));
  } finally { globalThis.fetch = realFetch; await t.close(); }
});

test('JOBS-002: shapeJob drops results and bounds text', () => {
  const j = shapeJob({id: 'job-1', name: 'x', status: 'failed', owner: {agent: 'a', session: 's'}, createdAt: 'c', result: {secret: 1}, error: {message: 'e'.repeat(900)}, log: Array.from({length: 40}, (_, i) => 'l' + i), logLines: 40, cost: {wallMs: 5}});
  assert.ok(!('result' in j));
  assert.equal(j.error.message.length, 300);
  assert.equal(j.log.length, 20);
  assert.equal(j.wallMs, 5);
});

// A fake MCP server: whatever /mcp/activity and /mcp/jobs should answer, so the tab is tested against the
// documented route shape without needing the route in the real handler.
async function fake({activity = {events: [], next: 0}, jobs}) {
  const server = http.createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    const body = path === '/mcp/activity' ? activity : path === '/mcp/jobs' && jobs !== undefined ? jobs : null;
    res.writeHead(body ? 200 : 404, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(body ?? {error: 'no'}));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const project = makeProject();
  const address = server.address();
  const feed = async () => { let out; await handle({method: 'GET'}, {writeHead() {}, end(s) { out = JSON.parse(s); }}, new URL('http://127.0.0.1/api/tabs/jobs/feed'), {root: project.root, address, prefix: '/api/tabs/jobs/', libraryDir: fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'jobs-lib-'))}); return out; };
  return {feed, close: async () => { server.close(); await project.cleanup(); }};
}

test('the documented /mcp/jobs shape: tool, state, agent, session, assetId, endedAt, durationMs, error; unknown fields ignored', async () => {
  const f = await fake({jobs: {jobs: [
    {id: 'job-aaaa1111', tool: 'qa_run', state: 'succeeded', agent: 'codex', session: 'h-3e05b7aa', assetId: 'lt_kiln_keeper', createdAt: '2026-11-22T10:00:00.000Z', startedAt: '2026-11-22T10:00:01.000Z', endedAt: '2026-11-22T10:00:03.500Z', durationMs: 2500, extra: {secret: 1}},
    {id: 'job-bbbb2222', tool: 'diff', state: 'failed', agent: 'antigravity', session: 'h-e48fe6bb', createdAt: '2026-11-22T10:00:00.000Z', startedAt: '2026-11-22T10:00:01.000Z', endedAt: '2026-11-22T10:00:02.000Z', durationMs: 1000, error: 'revision 3 does not exist'},
    {id: 'job-cccc3333', tool: 'preview_render', state: 'running', agent: 'codex', session: 'h-3e05b7aa', assetId: 'not_in_catalog', createdAt: '2026-11-22T10:00:00.000Z', startedAt: '2026-11-22T10:00:01.000Z'},
    {id: 'job-dddd4444', tool: 'qa_run', state: 'mystery', createdAt: '2026-11-22T10:00:00.000Z'}]}});
  try {
    const {jobs, jobAssets} = await f.feed();
    assert.equal(jobs.available, true);
    const by = Object.fromEntries(jobs.items.map(j => [j.id, j]));
    assert.deepEqual([by['job-aaaa1111'].name, by['job-aaaa1111'].status, by['job-aaaa1111'].owner, by['job-aaaa1111'].assetId, by['job-aaaa1111'].wallMs, by['job-aaaa1111'].finishedAt], ['qa_run', 'succeeded', {agent: 'codex', session: 'h-3e05b7aa'}, 'lt_kiln_keeper', 2500, '2026-11-22T10:00:03.500Z']);
    assert.deepEqual([by['job-bbbb2222'].status, by['job-bbbb2222'].error.message], ['failed', 'revision 3 does not exist']);
    assert.deepEqual([by['job-cccc3333'].status, by['job-cccc3333'].finishedAt], ['running', null]);
    assert.equal(by['job-dddd4444'].status, 'queued');            // unknown state, no timestamps: inferred, not trusted
    assert.ok(!('extra' in by['job-aaaa1111']));
    assert.ok(typeof jobAssets.lt_kiln_keeper === 'string' && !('not_in_catalog' in jobAssets), 'only assets the catalog knows get a link');
  } finally { await f.close(); }
});

test('missing or junk /mcp/jobs content: rows without an id are dropped, a non-list means unavailable, the feed still answers', async () => {
  const junk = await fake({jobs: {jobs: [null, 7, 'x', {tool: 'x'}, {id: 'job-eeee5555'}, {id: 'job-ffff6666', startedAt: 'not a date', durationMs: -5, state: 42}]}});
  try {
    const {jobs} = await junk.feed();
    assert.deepEqual(jobs.items.map(j => [j.id, j.status, j.name, j.wallMs]), [['job-eeee5555', 'queued', '?', null], ['job-ffff6666', 'queued', '?', null]]);
  } finally { await junk.close(); }
  const notAList = await fake({jobs: {jobs: 'nope'}});
  try { assert.deepEqual((await notAList.feed()).jobs, {available: false, status: 200, items: []}); } finally { await notAList.close(); }
  const absent = await fake({activity: {events: [{seq: 1, ts: '2026-11-22T10:00:00.000Z', agent: 'codex', session: 'h-1', tool: 'x', ok: true, ms: 3}], next: 1}});
  try {
    const out = await absent.feed();
    assert.deepEqual([out.jobs.available, out.jobs.status, out.activity.events.length], [false, 404, 1]);
  } finally { await absent.close(); }
});

test('shapeJob keeps the runner view working too (name, status, owner, cost.wallMs, finishedAt)', () => {
  const j = shapeJob({id: 'job-1', name: 'qa_run', status: 'succeeded', owner: {agent: 'a', session: 's'}, createdAt: '2026-11-22T10:00:00.000Z', finishedAt: '2026-11-22T10:00:01.000Z', cost: {wallMs: 40}, log: ['x'], logLines: 1});
  assert.deepEqual([j.name, j.status, j.owner, j.wallMs, j.logLines], ['qa_run', 'succeeded', {agent: 'a', session: 's'}, 40, 1]);
  assert.equal(shapeJob(null), null);
});
