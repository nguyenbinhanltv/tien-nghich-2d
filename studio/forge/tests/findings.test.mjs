// Behaviour added after the Codex pose-sheet trial: labels that fit, import warnings for cut drawings, facing-level
// scale and ground, scale locked to a turnaround, declared contacts on pose clips, marks that survive resampling.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadPack } from '../../core/pack.mjs';
import { bakeStage, boundsOf, compareSets, decodePng, encodePng, importSheet, pixelizeImport, qaStage, renderTemplate, resolveMarks, rigPalette,
  scalesByFacing, settingsFromPack, writeBakeDir, turnaroundLayout, validateLayout, normalizeEntries } from '../index.mjs';
import { drawFigure, makeProject, palette } from './fixture.mjs';

const rgb = id => { const hex = palette.colors.find(c => c.id === id).hex; return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); };

async function project(clips) {
  const dir = await makeProject({clips});
  const pack = await loadPack(dir);
  return {dir, settings: await settingsFromPack(pack, dir, 'critter')};
}

test('template labels shrink to fit narrow cells and a label that cannot fit is rejected', () => {
  const layout = turnaroundLayout({id: 'p', facings: ['south', 'west', 'north', 'east'], poses: ['contact_a', 'passing_a'], size: [1024, 1024], heightPx: 20, columns: 4});
  assert.deepEqual(validateLayout(layout), []);
  const img = renderTemplate(layout);
  // Black label pixels of the first cell never leave that cell (256 px wide).
  const black = boundsOf(img, i => img.pixels[i] === 0 && img.pixels[i + 1] === 0 && img.pixels[i + 2] === 0, [0, 0, 256, 128]);
  assert.ok(black[2] <= 256 - 4, `label ends at ${black[2]}`);
  assert.throws(() => turnaroundLayout({id: 'c', facings: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], poses: ['contact_a'], size: [256, 256], heightPx: 5, columns: 8}),
    /needs \d+px at the smallest size/);
});

test('import warns when a drawing touches its crop edge or runs into the label band', async t => {
  const {dir, settings} = await project();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const layout = turnaroundLayout({id: 'w', facings: ['front', 'side'], size: [800, 800], heightPx: 26, columns: 2});
  const sheet = renderTemplate(layout);
  drawFigure(sheet, layout, 'front', {width: 120, height: 160, body: rgb('clay'), head: rgb('rose')});
  // The side drawing is a wide block that crosses the cell's right edge and its top (label band).
  const band = Math.round(400 * 0.13);
  for (let y = band - 6; y < 300; y++) for (let x = 520; x < 800; x++) sheet.pixels.set([...rgb('moss'), 255], (y * 800 + x) * 4);
  const record = importSheet({layout, sheet, profile: settings.profile}).record;
  assert.deepEqual(record.cells.find(c => c.id === 'front').warnings, []);
  assert.deepEqual(record.cells.find(c => c.id === 'side').warnings, ['right_edge', 'label_band']);
});

function poseSheet(settings) {
  const layout = turnaroundLayout({id: 'ps', facings: ['front', 'side'], poses: ['stand', 'crouch', 'lift'], size: [900, 1200], heightPx: 26});
  const sheet = renderTemplate(layout);
  const look = {stand: {height: 160}, crouch: {height: 120}, lift: {height: 160, lift: 14}};
  // The side facing is drawn wider so its natural scale differs from the front's.
  for (const cell of layout.cells) drawFigure(sheet, layout, cell.id, {width: cell.facing === 'side' ? 200 : 120, ...look[cell.pose], body: rgb('moss'), head: rgb('rose')});
  return {layout, sheet};
}

test('facing mode: the poses of one facing share a scale, facings keep their own', async t => {
  const {dir, settings} = await project();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const {layout, sheet} = poseSheet(settings);
  const entries = scaleOptions => importSheet({layout, sheet, profile: settings.profile, scaleOptions}).record.cells;
  const byFacing = entries({mode: 'facing'});
  for (const facing of ['front', 'side']) assert.equal(new Set(byFacing.filter(c => c.facing === facing).map(c => c.scale)).size, 1, facing);
  assert.notEqual(byFacing.find(c => c.facing === 'front').scale, byFacing.find(c => c.facing === 'side').scale);
  assert.equal(new Set(entries({mode: 'sheet'}).map(c => c.scale)).size, 1);
  assert.throws(() => normalizeEntries(byFacing, settings.profile, {mode: 'row'}), /unknown scale mode/);
});

test('fixedScale pins a facing to the scale of another import, e.g. the turnaround', async t => {
  const {dir, settings} = await project();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const {layout, sheet} = poseSheet(settings);
  const turnaround = importSheet({layout, sheet, profile: settings.profile}).record;
  const locked = scalesByFacing({cells: turnaround.cells.filter(c => c.id.startsWith('stand_'))});
  assert.deepEqual(Object.keys(locked).sort(), ['front', 'side']);
  const imported = importSheet({layout, sheet, profile: settings.profile, scaleOptions: {mode: 'facing', fixedScale: locked}});
  for (const c of imported.record.cells) { assert.equal(c.scale, locked[c.facing]); assert.equal(c.limit, 'fixed'); }
  assert.deepEqual(imported.record.scaleOptions.fixedScale, locked);
  // The recorded fit is reused (options unchanged), and changes to the locked scales are honoured.
  const same = pixelizeImport(imported, settings);
  assert.deepEqual(same.record.cells.map(c => c.scale), imported.record.cells.map(c => c.scale));
  const other = pixelizeImport(imported, settings, {scaleOptions: {mode: 'facing', fixedScale: {front: locked.front / 2}}});
  assert.equal(other.record.cells.find(c => c.id === 'stand_front').scale, locked.front / 2);
});

test('a pose clip can declare planted contacts per key, checked against the drawn pixels', async t => {
  const {dir, settings} = await project({walk: [4, 100]});
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const {layout, sheet} = poseSheet(settings);
  const px = pixelizeImport(importSheet({layout, sheet, profile: settings.profile, scaleOptions: {mode: 'sheet'}}), settings);
  const [x0, , x1, y1] = boundsOf(px.cells.get('stand_front').native);
  const left = [x0 + 1, y1 - 1], right = [x1 - 2, y1 - 1];
  const key = (a, b) => [{id: 'foot_l', xy: left, planted: a}, {id: 'foot_r', xy: right, planted: b}];
  const spec = {keys: ['stand', 'stand', 'stand', 'stand'], facings: ['front'], contacts: {front: [key(true, true), key(true, true), key(true, true), key(true, true)]}};
  const clips = {schema: 'forge.poseclips', version: 1, clips: {walk: spec}};
  const pal = rigPalette(settings);
  const result = bakeStage({settings, palette: pal, cells: px.cells, poseClips: clips});
  assert.deepEqual(result.clips.walk.facings.front.contacts[0].map(c => c.id), ['foot_l', 'foot_r']);
  assert.deepEqual(qaStage(result, {settings, palette: pal, options: {pivotDrift: false, flicker: false}}).findings, []);
  // A planted foot that moves between planted keys is now a foot-slide error from the gates.
  const slid = structuredClone(clips); slid.clips.walk.contacts.front[1][0].xy = [left[0] + 1, left[1]];
  const gates = qaStage(bakeStage({settings, palette: pal, cells: px.cells, poseClips: slid}), {settings, palette: pal, options: {pivotDrift: false, flicker: false}});
  assert.ok(gates.findings.some(f => f.gate === 'foot_slide' && f.severity === 'error'), JSON.stringify(gates.findings.map(f => f.gate)));
  // A contact that is not on an opaque pixel is refused at bake time, with the key named.
  const off = structuredClone(clips); off.clips.walk.contacts.front[2][1].xy = [0, 0];
  assert.throws(() => bakeStage({settings, palette: pal, cells: px.cells, poseClips: off}), /contact foot_r of front key 2/);
  const short = structuredClone(clips); short.clips.walk.contacts.front.pop();
  assert.throws(() => bakeStage({settings, palette: pal, cells: px.cells, poseClips: short}), /one list per key/);
});

test('minCoverage keeps a small mark that the area filter would average away; keepOnOutline survives the outline', async t => {
  const {dir, settings} = await project();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const layout = turnaroundLayout({id: 'm', facings: ['front'], size: [400, 400], heightPx: 26, columns: 1});
  const sheet = renderTemplate(layout);
  const [bx0, by0] = drawFigure(sheet, layout, 'front', {width: 160, height: 200, body: rgb('moss'), head: rgb('rose')});
  // A 6x6 source-pixel notch on the left edge of the head: far less than half of one native pixel at this scale.
  const notch = rgb('mark');
  for (let y = by0 + 30; y < by0 + 36; y++) for (let x = bx0 + 54; x < bx0 + 60; x++) sheet.pixels.set([...notch, 255], (y * 400 + x) * 4);
  const imported = importSheet({layout, sheet, profile: settings.profile});
  const count = marks => pixelizeImport(imported, settings, {marks: resolveMarks(marks, settings.palette)}).record.cells[0].marks[0].visiblePx;
  const base = {color: 'mark', minRgb: [230, 200, 0]};
  const plain = count([base]);
  const covered = count([{...base, minCoverage: 0.05}]);
  assert.ok(covered > plain, `${covered} > ${plain}`);
  assert.throws(() => resolveMarks([{...base, minCoverage: 2}], settings.palette), /minCoverage/);
  // keepOnOutline: a covered pixel on the silhouette edge stays mark-coloured instead of becoming ink.
  // A notch on the body's left silhouette edge: the rebuilt outline inks it unless keepOnOutline says otherwise.
  for (let y = by0 + 120; y < by0 + 128; y++) for (let x = bx0; x < bx0 + 8; x++) sheet.pixels.set([...notch, 255], (y * 400 + x) * 4);
  const edged = importSheet({layout, sheet, profile: settings.profile});
  const edgeCount = marks => pixelizeImport(edged, settings, {marks: resolveMarks(marks, settings.palette)}).record.cells[0].marks[0].visiblePx;
  const inked = edgeCount([{...base, minCoverage: 0.05}]), kept = edgeCount([{...base, minCoverage: 0.05, keepOnOutline: true}]);
  assert.ok(kept > inked, `${kept} > ${inked}`);
});

// ---- drawn-key clips: region marks, declared landmarks, identity drift, compare

const imports = [];
async function poseBake(t, {clipSpec, withMark = false} = {}) {
  const {dir, settings} = await project({walk: [4, 100]});
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const layout = turnaroundLayout({id: 'pc', facings: ['front'], poses: ['a', 'b', 'c'], size: [900, 400], heightPx: 26, columns: 3});
  const sheet = renderTemplate(layout);
  const looks = {a: {body: 'moss', head: 'rose'}, b: {body: 'clay', head: 'sand'}, c: {body: 'sky', head: 'rose'}};
  for (const cell of layout.cells) drawFigure(sheet, layout, cell.id, {width: 120, height: 150, body: rgb(looks[cell.pose].body), head: rgb(looks[cell.pose].head), ...(withMark && cell.pose === 'a' ? {mark: rgb('mark')} : {})});
  const imported = importSheet({layout, sheet, profile: settings.profile, scaleOptions: {mode: 'sheet'}});
  imports.push(imported);
  const marks = withMark ? resolveMarks([{color: 'mark', minRgb: [230, 200, 0]}], settings.palette) : [];
  const px = pixelizeImport(imported, settings, {marks});
  const pal = rigPalette(settings);
  const keys = ['a', 'b', 'a', 'c'];
  const result = bakeStage({settings, palette: pal, cells: px.cells, poseClips: {schema: 'forge.poseclips', version: 1, clips: {walk: {keys, ...clipSpec}}}});
  return {dir, settings, px, pal, result};
}

test('a mark region limits where the mark is looked for', async t => {
  const {dir, settings} = await project();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const layout = turnaroundLayout({id: 'r', facings: ['front'], size: [400, 400], heightPx: 26, columns: 1});
  const sheet = renderTemplate(layout);
  const [bx0, by0] = drawFigure(sheet, layout, 'front', {width: 160, height: 200, body: rgb('moss'), head: rgb('rose')});
  for (let y = by0 + 30; y < by0 + 60; y++) for (let x = bx0 + 54; x < bx0 + 84; x++) sheet.pixels.set([...rgb('mark'), 255], (y * 400 + x) * 4);
  const imported = importSheet({layout, sheet, profile: settings.profile});
  const seen = region => pixelizeImport(imported, settings, {marks: resolveMarks([{color: 'mark', minRgb: [230, 200, 0], ...(region ? {region} : {})}], settings.palette)}).record.cells[0].marks[0].visiblePx;
  const everywhere = seen(null);
  assert.ok(everywhere > 0);
  assert.equal(seen([0, 0, 1, 0.5]), everywhere, 'the head is in the top half');
  assert.equal(seen([0, 0.6, 1, 1]), 0, 'a region that excludes the head ignores the mark');
  assert.throws(() => resolveMarks([{color: 'mark', minRgb: [0, 0, 0], region: [0.5, 0, 0.2, 1]}], settings.palette), /region/);
});

test('a pose clip declares the anatomical box of a mark and the markSide gate validates it on every key', async t => {
  const {px, settings, pal} = await poseBake(t, {withMark: true});
  const native = px.cells.get('a_front').native;
  const hits = [];
  for (let y = 0; y < native.height; y++) for (let x = 0; x < native.width; x++) if (native.pixels[(y * native.width + x) * 4 + 3] === 255 && [...native.pixels.subarray((y * native.width + x) * 4, (y * native.width + x) * 4 + 3)].join() === rgb('mark').join()) hits.push([x, y]);
  assert.ok(hits.length > 0);
  const box = [Math.min(...hits.map(h => h[0])), Math.min(...hits.map(h => h[1])), Math.max(...hits.map(h => h[0])) + 1, Math.max(...hits.map(h => h[1])) + 1];
  const run = landmarkBox => {
    const spec = {landmarks: {front: [{id: 'crest', color: 'mark', box: landmarkBox}]}};
    const {result} = {result: bakeStage({settings, palette: pal, cells: px.cells, poseClips: {schema: 'forge.poseclips', version: 1, clips: {walk: {keys: ['a', 'a', 'a', 'a'], ...spec}}}})};
    return qaStage(result, {settings, palette: pal, options: {pivotDrift: false}}).findings.filter(f => f.gate === 'mark_side');
  };
  assert.deepEqual(run(box), []);
  assert.ok(run([0, 0, 3, 3]).length > 0, 'a box in the wrong place is a markSide error');
  assert.throws(() => bakeStage({settings, palette: pal, cells: px.cells, poseClips: {schema: 'forge.poseclips', version: 1, clips: {walk: {keys: ['a', 'a', 'a', 'a'], landmarks: {front: [{id: 'x', color: 'nope', box}]}}}}}), /unknown palette id/);
});

test('drawn-key clips skip the rig flicker gate by default and report identity drift instead', async t => {
  const {settings, pal, result} = await poseBake(t);
  const gates = options => qaStage(result, {settings, palette: pal, options: {pivotDrift: false, ...options}});
  const base = gates({});
  assert.ok(!base.findings.some(f => f.gate === 'flicker'), 'no flicker findings for drawn keys by default');
  const metrics = base.metrics['walk/front'];
  assert.ok(metrics.interiorChange > 0.3 && metrics.colorShift > 0.1, JSON.stringify(metrics));
  assert.equal(base.pass, true);
  // The old gate is available per run (options.pose) and per clip; the same drawn keys trip it.
  assert.ok(gates({pose: {flicker: {maxPixels: 10}}}).findings.some(f => f.gate === 'flicker'));
  // Identity thresholds produce warnings, which never fail the run.
  const strict = gates({pose: {identity: {maxInteriorChange: 0.1, maxColorShift: 0.1}}});
  assert.ok(strict.findings.some(f => f.gate === 'identity_drift' && f.severity === 'warn'));
  assert.equal(strict.pass, true);
  assert.equal(gates({pose: {identity: false}}).metrics['walk/front'].interiorChange, undefined);
  // A rig clip is still judged by the flicker gate: the default options for non-pose clips are untouched.
  const rigLike = {...result, clips: {walk: {...result.clips.walk, source: 'rig'}}};
  assert.ok(qaStage(rigLike, {settings, palette: pal, options: {pivotDrift: false}}).findings.some(f => f.gate === 'flicker'));
});

test('compare puts bake directories side by side, summarises their gates, and the CLI exposes it', async t => {
  const {dir, settings, pal, result, px} = await poseBake(t, {clipSpec: {qa: {identity: false}}});
  const out = path.join(dir, 'cmp');
  await fs.mkdir(out);
  await writeBakeDir(result, path.join(out, 'one'));
  await writeBakeDir(result, path.join(out, 'two'));
  await fs.mkdir(path.join(out, 'plain'));
  for (const [id, cell] of px.cells) await fs.writeFile(path.join(out, 'plain', `idle_${id.split('_').pop()}_${'abc'.indexOf(id.split('_')[0])}.png`), encodePng(cell.native));
  const sets = {one: path.join(out, 'one'), two: path.join(out, 'two'), plain: path.join(out, 'plain')};
  const report = await compareSets(sets, {scale: 2, gates: {settings, palette: pal, options: {pivotDrift: false}}});
  assert.deepEqual(report.rows.map(r => [r.clip, r.facing]), [['walk', 'front'], ['idle', 'front']]);
  assert.equal(report.sets.one.frames, 4);
  assert.equal(report.sets.one.gates.pass, true);
  assert.equal(report.sets.plain.gates, undefined, 'a plain frame directory has no bake.json to judge');
  assert.ok(report.sheet.width > 4 * 2 * 48 && report.sheet.height > 2 * 40);
  const cli = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'cli.mjs');
  const {stdout} = await promisify(execFile)('node', [cli, 'compare', '--sets', `one=${sets.one},two=${sets.two}`, '--out', path.join(out, 'sheet.png'), '--json', path.join(out, 'r.json'),
    '--project', dir, '--profile', 'critter', '--qa', await (async () => { const f = path.join(out, 'qa.json'); await fs.writeFile(f, '{"pivotDrift": false}'); return f; })()]);
  assert.match(stdout, /one: 4 frames, gates pass/);
  assert.equal(decodePng(await fs.readFile(path.join(out, 'sheet.png'))).width > 0, true);
  assert.equal(JSON.parse(await fs.readFile(path.join(out, 'r.json'), 'utf8')).sets.two.frames, 4);
});
