// The rubric table and lineup picture in the art detail: the view model, the page text with and without data, and the read routes.
// None of it can approve anything: the standing, art-approvals and owner-approval-all-art tests own that, and nothing here writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { openWorkspace } from '../../../core/workspace.mjs';
import { loadAssetIndex } from '../../../mcp/asset-index.mjs';
import { encodePixels } from '../../../core/png.mjs';
import { loadPackSync } from '../../../core/pack.mjs';
import { criteriaOf } from '../../../core/rubric.mjs';
import { rubricView, lineupView, evidenceView, lineupZoom } from './evidence.mjs';
import { handle, clearAudioCache } from './server.mjs';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const criteria = criteriaOf(loadPackSync(root, undefined, {verifyFiles: false}));
const en = JSON.parse(fs.readFileSync(new URL('i18n/en.json', import.meta.url)));
const vi = JSON.parse(fs.readFileSync(new URL('i18n/vi.json', import.meta.url)));

const rubricEvidence = {rubric: {status: 'fail', rows: [
  {id: 'silhouette', mandatory: true, observation: 'Limbs merge at the elbow', result: 'fail', confidence: 0.9, evidence: [{frame: 'idle_south_0', region: {x: 1, y: 2, w: 3, h: 4}}]},
  {id: 'perspective', mandatory: true, observation: 'Faces the viewer', result: 'pass', confidence: 0.8, evidence: [{frame: 'idle_south_0'}]},
  {id: 'identity', mandatory: true, observation: 'Looks right', result: 'unknown', claimed: 'pass', why: 'confidence 0.2 is below the project\'s 0.5', confidence: 0.2, evidence: []}]}};
const lineupEvidence = (sha, image = 'x/work/lt_a/lineup/a.png') => ({lineup: {status: 'fail', group: 'humanoid', references: ['kiln_keeper'], image, sha256: sha,
  rows: [{metric: 'heightRatio', measured: 0.4, figure: 12, reference: 30, block: {min: 0.5, max: 1.15}, typical: {min: 0.6, max: 1.05}, status: 'fail'},
    {metric: 'limbWidthRatio', measured: 1, figure: 4, reference: 4, block: {min: 0.15, max: 5}, typical: null, status: 'pass'}]}});
const ev = (kind, revision, evidence, request = 'rq-1') => ({seq: 1, ts: '2026-11-23T01:00:00Z', request, key: 'k', revision, kind, agent: 'codex', session: 'abcdef1234567890', text: 't', replyTo: null, resolves: false, evidence});

test('rubricView joins the pack criteria with the stored rows; a mandatory fail blocks, a mandatory unknown is unproven, a missing row is not assessed', () => {
  const v = rubricView(criteria, [ev('request', 1, rubricEvidence)], 1);
  assert.equal(v.status, 'fail');
  assert.deepEqual(v.blocking, ['silhouette']);
  assert.deepEqual(v.unproven, ['identity']);
  assert.equal(v.criteria.length, criteria.length);
  assert.equal(v.criteria.find(c => c.id === 'motion').why, 'not assessed');
  assert.equal(v.criteria.find(c => c.id === 'motion').result, 'unknown');
  assert.equal(v.criteria.find(c => c.id === 'identity').claimed, 'pass');
  assert.deepEqual(v.counts, {pass: 1, fail: 1, unknown: criteria.length - 2});
  assert.equal(v.current, true);
  assert.equal(rubricView(criteria, [ev('request', 0, rubricEvidence)], 2).current, false, 'an older revision is flagged, not hidden');
});

test('no rubric and no lineup come back as null, and a reply or a request without evidence is ignored', () => {
  assert.equal(rubricView(criteria, [], 0), null);
  assert.equal(lineupView([ev('reply', 0, rubricEvidence), ev('request', 0, null)], 0), null);
  assert.equal(rubricView([], [ev('request', 0, rubricEvidence)], 0), null, 'a pack with no criteria shows no table');
  const body = evidenceView({key: 'k', revision: 0, criteria, events: []});
  assert.deepEqual([body.rubric, body.lineup, body.rubricDefined], [null, null, true]);
  assert.equal(evidenceView({key: 'k', revision: 0, criteria: [], events: []}).rubricDefined, false);
});

test('a lineup without a hash has no picture, and out-of-range numbers never become a pass', () => {
  const v = lineupView([ev('request', 0, lineupEvidence('nope'))], 0);
  assert.equal(v.hasImage, false);
  assert.deepEqual(v.blocking, ['heightRatio']);
  const bogus = lineupView([ev('request', 0, {lineup: {status: 'bogus', rows: [{metric: 'heightRatio', status: 'bogus'}, {metric: 'limbWidthRatio'}]}})], 0);
  assert.equal(bogus.status, 'warn');
  assert.deepEqual(bogus.rows.map(r => r.status), ['warn', 'warn'], 'an unknown or missing row status is never a pass');
  assert.equal(lineupZoom(100, 1000), 10);
  assert.equal(lineupZoom(100, 40), 1);
  assert.equal(lineupZoom(0, 40), 1);
});

// ---- page text: a small stand-in for the DOM, enough for the helpers in dom.mjs ----
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.className = ''; this.listeners = {}; this.style = {}; this.dataset = {}; }
  setAttribute(k, v) { this.attrs[k] = v; }
  append(...k) { for (const x of k) this.children.push(typeof x === 'string' ? new Text(x) : x); }
  replaceChildren(...k) { this.children = []; this.append(...k); }
  addEventListener(n, f) { this.listeners[n] = f; }
  get textContent() { return this.children.map(c => c.textContent).join(' '); }
  set textContent(v) { this.children = [new Text(v)]; }
  find(fn) { return fn(this) ? this : this.children.map(c => c.find?.(fn)).find(Boolean) ?? null; }
}
class Text { constructor(s) { this.textContent = String(s); } }
globalThis.document = {createElement: tag => new El(tag)};
const { evidenceSection } = await import('./evidence-view.mjs');

const ctxFor = lang => { const dict = lang === 'vi' ? vi : en; return {lang, t: (k, p = {}) => (dict[k] ?? en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => p[n] ?? '')}; };

for (const lang of ['en', 'vi']) {
  test(`page text with data (${lang}): criteria, results, measures, what blocks, the picture and its caption`, () => {
    const body = evidenceView({key: 'k', revision: 1, criteria, events: [ev('request', 1, {...rubricEvidence, ...lineupEvidence('a'.repeat(64))})]});
    const text = evidenceSection(ctxFor(lang), body, 'longtime/lt_a/idle_south_0').textContent;
    const d = lang === 'vi' ? vi : en;
    assert.ok(text.includes(d['ev.rubric']) && text.includes(d['ev.lineup']));
    assert.ok(text.includes(criteria[0].label[lang]), 'the criterion label in the page language');
    for (const w of ['Limbs merge at the elbow', '0.90', d['ev.result.fail'], d['ev.result.pass'], d['ev.blocks'], d['ev.unproven']]) assert.ok(text.includes(w), w);
    assert.ok(text.includes('silhouette'), 'what blocks is named');
    assert.ok(text.includes('idle_south_0 1,2 3×4'), 'the evidence region');
    assert.ok(text.includes(d['ev.metric.heightRatio']) && text.includes('0.4 (') && text.includes('0.5 – 1.15'), 'lineup measure and the blocked band');
    const img = evidenceSection(ctxFor(lang), body, 'longtime/lt_a/idle_south_0').find(e => e.tag === 'img');
    assert.match(img.attrs.src, /\/api\/tabs\/review\/lineup-image\?key=longtime%2Flt_a%2Fidle_south_0$/);
    assert.ok(img.attrs.alt.includes('kiln_keeper'));
  });

  test(`page text without data (${lang}): says what is missing and names the tool to run, never offers to run it`, () => {
    const body = evidenceView({key: 'k', revision: 0, criteria, events: []});
    const section = evidenceSection(ctxFor(lang), body, 'k');
    const text = section.textContent, d = lang === 'vi' ? vi : en;
    assert.ok(text.includes(d['ev.none.rubric']) && text.includes(d['ev.none.lineup']));
    assert.ok(text.includes('studio_qa_run') && text.includes('studio_review_request') && text.includes('studio_template_get'));
    assert.equal(section.find(e => e.tag === 'button' || e.tag === 'img'), null, 'no button to run anything, no picture');
    assert.ok(evidenceSection(ctxFor(lang), {...body, rubricDefined: false}, 'k').textContent.includes(d['ev.noDefinition']));
    assert.ok(evidenceSection(ctxFor(lang), null, 'k', new Error('boom')).textContent.includes('boom'));
  });
}

test('an older revision is marked in the page', () => {
  const body = evidenceView({key: 'k', revision: 3, criteria, events: [ev('request', 1, rubricEvidence)]});
  assert.ok(evidenceSection(ctxFor('en'), body, 'k').textContent.includes('older revision r1'));
});

// ---- the routes ----
const lib = () => fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'review-ev-'));
async function call(dir, name, query) {
  let status = 200, headers, out;
  const res = {writeHead(s, h) { status = s; headers = h; }, end(b) { out = b; }};
  try { await handle({method: 'GET', headers: {}}, res, new URL('http://127.0.0.1/api/tabs/review/' + name + '?' + query), {root, prefix: '/api/tabs/review/', libraryDir: dir}); }
  catch (error) { return {status: error.status, error: error.code}; }
  return {status, headers, body: headers['Content-Type'].startsWith('image') ? out : JSON.parse(out)};
}
function seed(dir, key, evidence) {
  const ws = openWorkspace(root, {indexer: loadAssetIndex, libraryDir: dir});
  return ws.db().then(db => { db.addEvent({request: 'rq-1', key, rev: 0, kind: 'request', agent: 'codex', session: 'abcdef1234567890', text: 'look', evidence}); ws.close(); });
}

test('route evidence: nothing recorded reads as no rubric and no lineup; a stored request is returned joined with the pack', async () => {
  clearAudioCache();
  const dir = lib(), key = 'longtime/lt_a/idle_south_0';
  let r = await call(dir, 'evidence', `key=${encodeURIComponent(key)}&revision=0`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.rubric, r.body.lineup, r.body.rubricDefined], [null, null, true]);
  await seed(dir, key, rubricEvidence);
  r = await call(dir, 'evidence', `key=${encodeURIComponent(key)}&revision=0`);
  assert.equal(r.body.rubric.status, 'fail');
  assert.deepEqual(r.body.rubric.blocking, ['silhouette']);
  assert.equal(r.body.lineup, null);
  assert.equal((await call(dir, 'evidence', 'key=../x')).status, 422);
});

test('route lineup-image: served only from the lineup work directory, only with the recorded hash', async () => {
  clearAudioCache();
  const dir = lib(), key = 'longtime/lt_a/idle_south_0';
  const png = encodePixels(2, 2, Buffer.alloc(16, 255)), sha = crypto.createHash('sha256').update(png).digest('hex');
  const pics = path.join(dir, 'work', 'lt_a', 'lineup');
  fs.mkdirSync(pics, {recursive: true});
  fs.writeFileSync(path.join(pics, 'a.png'), png);
  await seed(dir, key, lineupEvidence(sha, path.join(pics, 'a.png')));
  const ok = await call(dir, 'lineup-image', `key=${encodeURIComponent(key)}`);
  assert.equal(ok.status, 200);
  assert.deepEqual(Buffer.from(ok.body), png);
  fs.writeFileSync(path.join(pics, 'a.png'), encodePixels(2, 2, Buffer.alloc(16, 9)));
  assert.equal((await call(dir, 'lineup-image', `key=${encodeURIComponent(key)}`)).error, 'no_lineup', 'changed since it was recorded');
  fs.writeFileSync(path.join(dir, 'elsewhere.png'), png);
  const other = 'longtime/lt_b/idle_south_0';
  await seed(dir, other, lineupEvidence(sha, path.join(dir, 'elsewhere.png')));
  assert.equal((await call(dir, 'lineup-image', `key=${encodeURIComponent(other)}`)).error, 'no_lineup', 'a path outside the lineup directory is never read');
  assert.equal((await call(dir, 'lineup-image', 'key=longtime%2Fnone%2Fidle_south_0')).error, 'no_lineup');
});
