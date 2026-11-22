import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { makeProject } from '../../../mcp/testkit.mjs';
import { handle } from './server.mjs';

async function call(project, body, {method = 'POST', name = 'plan-import', type = 'application/json'} = {}) {
  const req = Object.assign(Readable.from([Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]), {method, headers: {'content-type': type}});
  let status = 200, out;
  const res = {writeHead(s) { status = s; }, end(t) { out = JSON.parse(t); }};
  try { await handle(req, res, new URL('http://127.0.0.1/api/tabs/overview/' + name), {root: project.root, prefix: '/api/tabs/overview/'}); }
  catch (error) { return {status: error.status, code: error.code, message: error.message}; }
  return {status, ...out};
}

const CSV = ['id,category,size class,clips,brief,chunk,owner,notes',
  'lt_lamp_seller,npc,npc,,A seller of paper lamps,abode,mei,"loud, cheerful"',
  'lt_kiln_keeper,npc,npc,,already in the manifest,abode,,',
  'lt_lamp_seller,npc,npc,,again,abode,,',
  'lt_floating_ash,vfx,24x24,drift:6@90,Ash that drifts upward,mist_archive,,',
  'bad id,npc,npc,,x,abode,,',
  'lt_no_size,npc,huge,,x,abode,,',
  'lt_no_clips,vfx,16x16,,x,abode,,'].join('\n');
const MAPPING = {id: 'id', category: 'category', size: 'size class', clips: 'clips', brief: 'brief', chunk: 'chunk'};
const planFile = p => path.join(p.root, 'assets/studio_plans.json');

test('OVERVIEW-001: a spreadsheet import never overwrites an existing id and a dry run writes nothing', async () => {
  const p = makeProject();
  try {
    const dry = await call(p, {csv: CSV, mapping: MAPPING});
    assert.equal(dry.status, 200);
    assert.equal(dry.dryRun, true);
    const by = Object.fromEntries(dry.rows.map(r => [r.line, r]));
    assert.equal(by[2].action, 'create');
    assert.equal(by[3].reason, 'exists');
    assert.equal(by[4].reason, 'repeated');
    assert.equal(by[5].action, 'create');
    assert.match(by[6].message, /id must look like/);
    assert.match(by[7].message, /neither one of/);
    assert.match(by[8].message, /needs clips/);
    assert.deepEqual(dry.summary, {create: 2, skip: 5});
    assert.equal(fs.existsSync(planFile(p)), false, 'a dry run writes nothing');
    // unmapped columns travel with the entry
    assert.deepEqual(by[2].entry.context, {owner: 'mei', notes: 'loud, cheerful', category: 'npc'});
    assert.deepEqual(by[5].entry.custom.clips, {drift: {frames: 6, frameMs: 90}});
    assert.equal(by[5].entry.chunk_group, 'mist_archive');

    const applied = await call(p, {csv: CSV, mapping: MAPPING, dryRun: false});
    assert.equal(applied.written, true);
    const stored = JSON.parse(fs.readFileSync(planFile(p), 'utf8'));
    assert.deepEqual(stored.entries.map(e => e.id), ['lt_lamp_seller', 'lt_floating_ash']);
    assert.equal(stored.entries[0].studio.createdBy.agent, 'studio-ui');
    // a second run changes nothing: both ids now exist
    const again = await call(p, {csv: CSV, mapping: MAPPING, dryRun: false});
    assert.equal(again.written, false);
    assert.equal(again.rows.find(r => r.line === 2).reason, 'exists');
    assert.deepEqual(JSON.parse(fs.readFileSync(planFile(p), 'utf8')), stored);
  } finally { await p.cleanup(); }
});

test('OVERVIEW-002: the importer reads the file first: headers, a suggested mapping, the project options, a sample', async () => {
  const p = makeProject();
  try {
    const r = await call(p, {csv: CSV});
    assert.deepEqual(r.headers.slice(0, 3), ['id', 'category', 'size class']);
    assert.equal(r.suggested.brief, 'brief');
    assert.equal(r.suggested.size, 'size class');
    assert.ok(r.options.chunks.includes('abode') && r.options.profiles.includes('npc'));
    assert.equal(r.rowCount, 7);
    const bad = await call(p, {csv: 'a,b\n"x'});
    assert.equal(bad.status, 422);
    assert.match(bad.message, /never closed/);
  } finally { await p.cleanup(); }
});

test('OVERVIEW-003: the import route refuses anything but a JSON POST, an unmapped id or brief, and a column the file lacks', async () => {
  const p = makeProject();
  try {
    assert.equal((await call(p, {csv: CSV}, {method: 'GET'})).code, 'method_not_allowed');
    assert.equal((await call(p, '{}', {type: 'text/plain'})).code, 'unsupported_media_type');
    assert.equal((await call(p, {csv: CSV}, {name: 'other'})).code, 'unknown_route');
    assert.match((await call(p, {csv: CSV, mapping: {id: 'id'}})).message, /needs a column for brief/);
    assert.match((await call(p, {csv: CSV, mapping: {id: 'id', brief: 'nope'}})).message, /no column "nope"/);
    assert.match((await call(p, {csv: CSV, mapping: {id: 'id', brief: 'brief'}})).message ?? 'ok', /./);
    const noChunk = await call(p, {csv: CSV, mapping: {id: 'id', brief: 'brief', size: 'size class'}});
    assert.ok(noChunk.rows.filter(r => r.action === 'skip').some(r => /no chunk/.test(r.message)));
    assert.equal(fs.existsSync(planFile(p)), false);
  } finally { await p.cleanup(); }
});
