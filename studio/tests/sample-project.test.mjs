// CLI-005 and CLI-007: the acceptance test of P6. A second project, deliberately unlike the first, runs the whole loop
// (plan, generate, metadata, QA, an independent check from a second session, a review request, the human step,
// pack, export, an animated asset through the forge, an audio render, the nine tabs) through the MCP tools as
// an agent would, against a PRISTINE COPY of studio/ that lives outside the project, and the copy must not have
// changed by one byte afterwards.
//
// The human step is played by the test exactly as the human-only tests do it: through the revision store of the
// project, which is what the review page writes to. No agent tool approves anything; the test shows that before
// and after.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { StdioClient } from '../mcp/stdio_client.mjs';
import { decodePng, encodePng, cellRect } from '../forge/index.mjs';

const REPO_STUDIO = fileURLToPath(new URL('../', import.meta.url));
const SAMPLE = path.join(REPO_STUDIO, 'examples/moss-lantern');
const META = {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {name: 'sample-test', version: '1'}};

function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(d, e.name), r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(abs, r); else h.update(`${r}:${createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}\n`);
    }
  };
  walk(dir, '');
  return h.digest('hex');
}

/** One MCP session over stdio, against the studio COPY. Each call to session() is a new server process, so a new session. */
function session(studio, project, agent, scope = 'author') {
  const client = new StdioClient(path.join(studio, 'mcp.mjs'), ['--project', project, '--scope', scope, '--agent', agent]);
  let n = 0;
  const call = async (name, args = {}) => {
    const r = await client.request(`c${++n}`, 'tools/call', {name, arguments: args, _meta: META}, 60_000);
    return r.error ? {rpcError: r.error} : r.result;
  };
  const ok = async (name, args) => {
    const r = await call(name, args);
    if (r.rpcError || r.isError) throw new Error(`${name}: ${JSON.stringify(r.rpcError ?? r.content?.[0]?.text)}`);
    return r.structuredContent;
  };
  return {call, ok, client, close: () => client.close()};
}

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
/** Draw a body block with a head and two feet touching the cell's ground line, in a layout cell of a template sheet. */
function drawFigure(img, layout, cellId, {width, height, body, head, lift = 0}) {
  const cell = layout.cells.find(c => c.id === cellId);
  const [x0, y0, x1, y1] = cellRect(cell, img.width, img.height);
  const ground = y0 + Math.round((y1 - y0) * layout.ground.fraction) - lift;
  const cx = x0 + Math.round((layout.landmarkBasis === 'cell_width' ? x1 - x0 : y1 - y0) * cell.landmarks.centerX);
  const put = (x, y, c) => img.pixels.set([...c, 255], (y * img.width + x) * 4);
  const left = cx - Math.floor(width / 2), top = ground - height;
  for (let y = top; y < ground; y++) for (let x = left; x < left + width; x++) {
    if (y >= ground - Math.round(height * 0.15) && Math.abs(x - cx) < width * 0.12) continue;
    put(x, y, (x === left || x === left + width - 1 || y === top) ? mix(body, layout.key.rgb, 0.35) : body);
  }
  const hs = Math.round(width * 0.5);
  for (let y = top - hs; y < top; y++) for (let x = Math.round(cx - hs / 2); x < cx + hs / 2; x++) put(x, y, head);
}

async function startServer(studio, project) {
  const child = spawn(process.execPath, [path.join(studio, 'cli.mjs'), 'serve', '--project', project, '--port', '0'], {env: {...process.env, PIXEL_KILN_HOME: path.join(path.dirname(project), 'pk-home')}, stdio: ['ignore', 'pipe', 'pipe']});
  const base = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', c => { out += c; const m = /(http:\/\/127\.0\.0\.1:\d+)\/studio\//.exec(out); if (m) resolve(m[1]); });
    child.on('exit', code => reject(new Error(`server exited ${code}`)));
    setTimeout(() => reject(new Error('server did not start')), 20_000).unref();
  });
  let closed;
  return {base, close: () => closed ??= new Promise(r => { if (child.exitCode !== null) return r(); child.once('exit', r); child.kill('SIGTERM'); })};
}

test('CLI-005 CLI-007: the sample project runs the whole loop through the MCP against an untouched copy of studio/, and with no baseline declared everything awaits review', {timeout: 240_000}, async t => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-sample-')));
  t.after(() => fs.rmSync(tmp, {recursive: true, force: true}));
  const studio = path.join(tmp, 'tools', 'studio'), project = path.join(tmp, 'moss-lantern');
  // The studio goes where a stranger would put it: copied on its own, outside the project. Its examples are the project, not the studio.
  fs.cpSync(REPO_STUDIO, studio, {recursive: true, filter: src => !src.startsWith(path.join(REPO_STUDIO, 'examples'))});
  fs.cpSync(SAMPLE, project, {recursive: true});
  const before = treeHash(studio);
  assert.ok(!fs.existsSync(path.join(studio, '..', 'package.json')) && !fs.existsSync(path.join(studio, 'node_modules')), 'no install step');

  const samplePack = JSON.parse(fs.readFileSync(path.join(project, 'studio.project.json'), 'utf8'));
  const author = session(studio, project, 'codex'), checker = session(studio, project, 'claude-code');
  t.after(async () => { await author.close(); await checker.close(); });
  const text = r => r.content?.[0]?.text ?? JSON.stringify(r.rpcError);

  // The sample is deliberately unlike the main project: another palette, sizes, outline rule, directories, id rule, generator, sample rate.
  const mainPack = JSON.parse(fs.readFileSync(path.join(REPO_STUDIO, '..', 'studio.project.json'), 'utf8'));
  assert.notEqual(samplePack.palette.file, mainPack.palette.file);
  assert.deepEqual(Object.keys(samplePack.sizeClasses).filter(k => k in mainPack.sizeClasses), []);
  assert.notDeepEqual(samplePack.rules.outline, mainPack.rules.outline);
  assert.deepEqual(Object.values(samplePack.directories.raw).filter(d => Object.values(mainPack.directories.raw).includes(d)), []);
  assert.deepEqual(Object.keys(samplePack.adapters.generators), ['blob']);
  assert.equal(samplePack.adapters.interpreter.runtime, 'node', 'no Python is needed');
  assert.equal(samplePack.review?.baseline, undefined, 'no baseline is declared');

  // ---- 1. orientation: the second project's own numbers ------------------------------------------------------------------
  const info = await author.ok('studio_project_info', {});
  assert.equal(info.palette.count, 12);
  assert.equal(info.palette.outline.hex, '#1b1727');
  assert.equal(info.rules.outline.borderIsEdge, true);
  assert.deepEqual(Object.keys(info.sizeClasses.packClasses).sort(), ['badge', 'critter', 'floor']);
  const found = await author.ok('studio_catalog_search', {});
  assert.deepEqual(found.results.map(a => a.id).sort(), ['chime_bright', 'chime_soft', 'ml_fern_fox', 'ml_moss_tile']);

  // ---- 2. plan an asset (with the project's own id rule) -----------------------------------------------------------------
  assert.match(text(await author.call('studio_asset_plan', {op: 'create', id: 'wrong_prefix_gem', profile: 'gem', chunk: 'cave', phase: 'wave_1', brief: 'x'})), /ml_/);
  const planned = await author.ok('studio_asset_plan', {op: 'create', id: 'ml_lantern_gem', profile: 'gem', chunk: 'cave', phase: 'wave_1', brief: 'A small glowing gem for the cave.'});
  assert.equal(planned.created, true);

  // ---- 3. generate frames with the project's registered generator (plain Node, no Python) --------------------------------
  const GEN = (clip, frames) => ({assetId: 'ml_lantern_gem', generator: 'blob', params: {shape: 'blob', size: 12, fill: 'lantern_2', accent: 'cream_1', clip, direction: 'none', frames}, seed: 7, submit: true});
  const unknown = await author.call('studio_generator_run', {assetId: 'ml_lantern_gem', generator: 'primitives', params: {}});
  assert.match(text(unknown), /Registered: blob/);
  for (const [clip, frames] of [['glyph', 1], ['sparkle', 3]]) {
    const run = await author.ok('studio_generator_run', GEN(clip, frames));
    assert.equal(run.deterministic, true);
    assert.deepEqual(run.defects, {errors: 0, warnings: 0});
    assert.equal(run.files.length, frames);
  }

  // ---- 4. metadata -------------------------------------------------------------------------------------------------------
  const meta = await author.call('studio_metadata_set', {assetId: 'ml_lantern_gem', pivot: [6, 6], hitbox: {x: 2, y: 2, w: 8, h: 8}});
  assert.equal(meta.isError, undefined, text(meta));

  // ---- 5. QA by the author, then an independent check from a SECOND session ----------------------------------------------
  const own = await author.ok('studio_qa_run', {assetId: 'ml_lantern_gem'});
  assert.equal(own.summary.frames, 4);
  assert.match(text(await author.call('studio_review_request', {assetId: 'ml_lantern_gem', note: 'Please look.'})), /different session/);
  const second = await checker.ok('studio_qa_run', {assetId: 'ml_lantern_gem', independent: true});
  assert.equal(second.qa.status === 'fail', false);
  const refusedSelf = await author.call('studio_qa_run', {assetId: 'ml_lantern_gem', independent: true});
  assert.equal(refusedSelf.isError, true, 'the author cannot check its own work independently');

  // ---- 6. ask for a review: a comment, never a status ---------------------------------------------------------------------
  const asked = await author.ok('studio_review_request', {assetId: 'ml_lantern_gem', note: 'A cave gem, glyph and a three-frame sparkle.', questions: ['Does it read at 1x?']});
  assert.equal(asked.asked, 4);
  assert.match(asked.status, /unchanged/);

  // ---- 7. the state of review before any human acts: nothing approved, and no baseline was declared, so everything awaits ----
  const projectUrl = pathToFileURL(path.join(studio, 'mcp/project.mjs')).href, reviewUrl = pathToFileURL(path.join(studio, 'core/review.mjs')).href;
  const {openProject} = await import(projectUrl), {bareFrame} = await import(reviewUrl);
  const ws = openProject(project).workspace;
  const store = await ws.store();
  const KEY = 'sprite/ml_lantern_gem/glyph_none_0';
  const snap = () => store.operate(bareFrame(KEY), fs.readFileSync(path.join(project, 'src/sprites/ml_lantern_gem/frames/glyph_none_0.png')), 'frame', {});
  assert.equal(snap().status, 'pending');
  const listed = await author.ok('studio_review_list', {assetId: 'ml_lantern_gem'});
  assert.equal(listed.approvedByHuman, 0, 'before the human step nothing is approved');

  // ---- 8. THE HUMAN STEP, played through the revision store the review page writes to ------------------------------------
  const png = fs.readFileSync(path.join(project, 'src/sprites/ml_lantern_gem/frames/glyph_none_0.png'));
  store.operate(bareFrame(KEY), png, 'review', {revision: 0, status: 'approved'});
  assert.equal(snap().status, 'approved');
  assert.equal((await author.ok('studio_review_list', {assetId: 'ml_lantern_gem'})).approvedByHuman, 1, 'the agent sees the human decision; it could not make it');
  assert.match(text(await author.call('studio_review_approve', {assetId: 'ml_lantern_gem'})), /Unknown tool/);

  // ---- 9. pack into STAGING (the agent's tool), against the chunk budget the design manifest declares ---------------------
  const shippedBefore = treeHash(path.join(project, 'build/atlases'));
  const packed = await author.ok('studio_pack', {chunk: 'cave'});
  assert.equal(packed.pass, true);
  assert.deepEqual([packed.web.pages, packed.mobile.pages, packed.assets.ml_lantern_gem.frames], [1, 1, 4]);
  assert.equal(packed.web.profile.limit, 512, 'the sample\'s own atlas profile, not the main project\'s');
  assert.equal(treeHash(path.join(project, 'build/atlases')), shippedBefore, 'packing never writes the shipped atlas directories');

  // ---- 10. an animated asset through the forge, with a tiny fixture sheet ------------------------------------------------
  const tpl = await author.call('studio_template_get', {assetId: 'ml_fern_fox', kind: 'pose-sheet', clip: 'walk'});
  assert.equal(tpl.isError, undefined, text(tpl));
  const {layout, poseClips} = tpl.structuredContent;
  assert.equal(layout.cells.length, 8, 'four key poses, two facings');
  const sheet = decodePng(Buffer.from(tpl.content.find(c => c.type === 'image').data, 'base64'));
  const palette = JSON.parse(fs.readFileSync(path.join(project, samplePack.palette.file), 'utf8'));
  const colour = id => rgb(palette.colors.find(c => c.id === id).hex);
  for (const cell of layout.cells) drawFigure(sheet, layout, cell.id, {width: 150, height: 120, body: colour('moss_2'), head: colour('lantern_2'), lift: cell.pose.startsWith('passing') ? 6 : 0});
  fs.mkdirSync(path.join(project, 'work'), {recursive: true});
  fs.writeFileSync(path.join(project, 'work/walk.png'), Buffer.from(encodePng(sheet)));
  const imported = await author.ok('studio_sheet_import', {assetId: 'ml_fern_fox', sheet: {file: 'work/walk.png'}, layout, prompt: 'A tiny fixture sheet drawn by the acceptance test.', tool: 'test fixture drawing', scaleOptions: {mode: 'sheet'}});
  assert.equal(imported.cells.length, 8);
  const processed = await author.call('studio_process', {assetId: 'ml_fern_fox'});
  assert.equal(processed.isError, undefined, text(processed));
  const baked = await author.ok('studio_rig_bake', {assetId: 'ml_fern_fox', poseClips});
  assert.equal(baked.pass, true);
  assert.equal(baked.clips.walk.source, 'poses');
  assert.deepEqual(baked.clips.walk.facings, {south: 4, east: 4});
  const submitted = await author.ok('studio_rig_bake', {assetId: 'ml_fern_fox', submit: true});
  assert.equal(submitted.submit.written, 8);

  // ---- 11. one audio render, with the project's own sample rate -----------------------------------------------------------
  const doc = JSON.parse(fs.readFileSync(path.join(project, 'audio/documents/chime_soft.patch.json'), 'utf8'));
  delete doc.sampleRate;
  const audio = await author.ok('studio_audio_render', {cueId: 'chime_soft', document: doc, keep: true, note: 'The soft chime of the sample.'});
  assert.equal(audio.deterministic, true);
  assert.equal(audio.measurements?.sampleRate ?? audio.sampleRate ?? 32000, 32000);

  // ---- 12. HUMAN: promote the approved frames and deliver the staged atlas, then export for one engine -------------------------
  // Promotion and delivery are human steps (no agent tool does either): the test plays the human by copying files, as a person would.
  for (const id of ['ml_lantern_gem', 'ml_fern_fox']) {
    fs.mkdirSync(path.join(project, 'build/frames', id), {recursive: true});
    for (const f of fs.readdirSync(path.join(project, 'src/sprites', id, 'frames'))) fs.copyFileSync(path.join(project, 'src/sprites', id, 'frames', f), path.join(project, 'build/frames', id, f));
  }
  const server = await startServer(studio, project);
  t.after(() => server.close());
  const get = async p => { const r = await fetch(server.base + p); return {status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer())}; };
  const post = async (p, body) => { const r = await fetch(server.base + p, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}); return {status: r.status, body: await r.json()}; };
  // Each chunk is staged through the Atlas tab, delivered by the human (a copy into the shipped directories), then exported.
  const exportedKeys = [];
  for (const chunk of ['cave', 'meadow']) {
    const staged = await post('/api/tabs/atlas/pack', {set: 'sprites', chunk, engine: 'studio'});
    assert.equal(staged.status, 200, JSON.stringify(staged.body));
    for (const profile of ['web', 'mobile']) {
      const from = path.join(project, '.review-db/atlas-staging/sprites', chunk, 'studio', profile), to = path.join(project, 'build/atlases', profile);
      fs.mkdirSync(to, {recursive: true});
      fs.cpSync(from, to, {recursive: true});
    }
    const exported = await post('/api/tabs/atlas/export', {set: 'sprites', profile: 'web', chunk, formats: ['phaser']});
    assert.equal(exported.status, 200, JSON.stringify(exported.body));
    assert.deepEqual(exported.body.formats.map(f => f.id), ['phaser']);
    assert.ok(exported.body.formats[0].files.some(f => f.name === 'phaser/multiatlas.json'));
    const atlasFile = await get(`/api/tabs/atlas/export-file?path=${encodeURIComponent(exported.body.downloadBase + '/phaser/multiatlas.json')}`);
    assert.equal(atlasFile.status, 200);
    exportedKeys.push(...atlasFile.body.textures.flatMap(tx => tx.frames.map(f => f.filename)));
  }
  assert.ok(exportedKeys.includes('sprite/ml_lantern_gem/glyph_none_0') && exportedKeys.includes('sprite/ml_fern_fox/walk_south_0'),
    'both assets are in an exported atlas, under the keys the pack defines: ' + exportedKeys.join(' '));

  // ---- 13. the nine tabs answer for this project ------------------------------------------------------------------------------
  assert.equal((await fetch(`${server.base}/studio/`)).status, 200);
  const overview = await get('/api/studio/overview');
  assert.equal(overview.status, 200);
  assert.equal((await post('/api/tabs/overview/plan-import', {csv: 'id,profile\nml_x,gem\n'})).status, 200);
  const roster = await get('/api/tabs/characters/roster');
  assert.equal(roster.status, 200);
  assert.ok(JSON.stringify(roster.body).includes('ml_fern_fox'));
  const sheetPng = await get('/api/tabs/characters/sheet.png?id=ml_fern_fox&scale=2');
  assert.deepEqual([sheetPng.status, sheetPng.type], [200, 'image/png']);
  assert.equal((await get('/api/tabs/objects/links')).status, 200);
  assert.equal((await get('/api/tabs/vfx/effects')).status, 200);
  const library = await get('/api/tabs/audio/library');
  assert.equal(library.status, 200);
  assert.ok(JSON.stringify(library.body).includes('chime_soft'));
  const inbox = await get('/api/tabs/review/inbox');
  assert.equal(inbox.status, 200);
  // CLI-007: no baseline is declared in this pack, so promoted frames can only be awaiting review, never baseline or approved by a record.
  assert.equal(inbox.body.artCounts.baseline, 0);
  assert.equal(inbox.body.artCounts.approved, 0);
  assert.ok(inbox.body.artCounts.awaiting > 0 && inbox.body.artCounts.awaiting === inbox.body.artCounts.total);
  assert.equal((await get('/api/tabs/jobs/feed')).status, 200);
  const config = await get('/api/tabs/sandbox/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.palette.length ?? Object.keys(config.body.palette).length, 12);
  const sets = await get('/api/tabs/atlas/sets');
  assert.equal(sets.status, 200);
  assert.equal(sets.body.sets[0].id, 'sprites');
  await server.close();

  // ---- the studio copy did not change by one byte -------------------------------------------------------------------------------
  ws.close();
  assert.equal(treeHash(studio), before, 'no file under studio/ differs after the whole loop');
});
