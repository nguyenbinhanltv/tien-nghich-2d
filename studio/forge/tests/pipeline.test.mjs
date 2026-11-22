// End to end: the committed bake-off sheet, layout and rig.json reproduce all 32 bake-off frames through the
// single pipeline (import -> pixelise -> rig bake -> patches -> gates), from the outline-free indexed layers.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runPipeline, openForgeProject, readBakeDir, qaStage, framesEqual, readFrame, normalizeLayout, sha256 } from '../index.mjs';
import { convertPrototypeRig } from '../rig/tests/fixtures/convert-prototype-rig.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const dir = path.join(root, 'assets/experiments/forge_bakeoff/lt_ink_marten/');
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const facings = ['south', 'west', 'north', 'east'];
const clips = {idle: 4, follow: 4};
const marks = [{color: 'soul_07', minRgb: [165, 0, 187], blueOverGreen: 17}];

async function inputs(layoutFile) {
  return {
    project: await openForgeProject(root, 'pet'),
    layout: await json(dir + layoutFile),
    sheet: {bytes: await fs.readFile(dir + 'turnaround.png'), source: 'turnaround.png'},
    prompt: await fs.readFile(dir + 'prompt.txt', 'utf8'),
    marks,
    rig: convertPrototypeRig(await json(dir + 'rig.json'), {id: 'lt_ink_marten'}),
    library: await json(new URL('../rig/tests/fixtures/marten/bakeoff-motion.json', import.meta.url)),
    qa: {weightTransfer: false},
  };
}

function assertAllFrames(artifacts) {
  let compared = 0;
  for (const [clip, n] of Object.entries(clips)) for (const facing of facings) for (let i = 0; i < n; i++) {
    const frame = artifacts.bake.frames[`${clip}_${facing}_${i}`];
    assert.ok(framesEqual(frame, readFrame(`${dir}frames/${clip}_${facing}_${i}.png`)), `${clip}_${facing}_${i}`);
    compared++;
  }
  assert.equal(compared, 32);
}

test('the legacy layout, bake-off rig.json and sheet reproduce all 32 frames and pass the gates', async () => {
  const {summary, artifacts} = await runPipeline(await inputs('layout.json'));
  assert.equal(summary.ok, true, summary.error);
  assert.deepEqual(summary.stages.gates.findings, []);
  assertAllFrames(artifacts);
  assert.equal(summary.stages.import.record.sheet.sha256, (await fs.readFile(dir + 'turnaround.sha256', 'utf8')).split(/\s/)[0]);
  // JSON-serialisable end to end: this object is what a tool hands back.
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), summary);
  assert.equal(Object.keys(summary.stages.bake.frames).length, 32);
});

test('the width-basis marten layout gives the same frames and the same fit as the legacy layout', async () => {
  const legacy = await runPipeline(await inputs('layout.json'));
  const fixed = await runPipeline(await inputs('layout.forge.json'));
  assert.equal(normalizeLayout(await json(dir + 'layout.forge.json')).landmarkBasis, 'cell_width');
  assert.equal(fixed.summary.ok, true, fixed.summary.error);
  assertAllFrames(fixed.artifacts);
  const fit = r => r.summary.stages.import.record.cells.map(c => [c.id, c.ground, c.bounds, c.scale, c.limit]);
  assert.deepEqual(fit(fixed), fit(legacy));
  assert.deepEqual(fixed.summary.stages.bake.frames, legacy.summary.stages.bake.frames);
});

test('feeding the outlined layer instead of the indexed one loses exactness: the indexed layer is what the baker gets', async () => {
  const input = await inputs('layout.json');
  const {artifacts} = await runPipeline(input);
  const same = facings.filter(f => framesEqual(artifacts.pixelized.cells.get(f).indexed, artifacts.pixelized.cells.get(f).native));
  assert.deepEqual(same, [], 'indexed and native layers differ (the outline), so the choice matters');
});

test('a failing stage ends the run with its name and message; the gates verdict gates ok', async () => {
  const input = await inputs('layout.json');
  const bad = structuredClone(input.rig);
  bad.facings.south.parts[0].role = 'wing';
  const rigFail = await runPipeline({...input, rig: bad});
  assert.equal(rigFail.summary.ok, false);
  assert.equal(rigFail.summary.failed, 'bake');
  assert.match(rigFail.summary.error, /wing/);
  assert.deepEqual(Object.keys(rigFail.summary.stages), ['import', 'pixelize', 'bake']);
  const layoutFail = await runPipeline({...(await inputs('layout.forge.json')), layout: {...(await json(dir + 'layout.forge.json')), cells: []}});
  assert.equal(layoutFail.summary.failed, 'import');
  // A pixel patch that wrecks a planted foot is caught by the gates: the run finishes but is not ok.
  const patch = {schema: 'studio.patch', version: 1, frames: {follow_west_1: [{op: 'fill', box: [8, 20, 14, 26], color: null}]}};
  const gated = await runPipeline({...input, patch});
  assert.equal(gated.summary.failed, 'gates');
  assert.ok(gated.summary.stages.gates.findings.some(f => f.severity === 'error'));
});

test('writing the run to disk, the gates can run again from bake.json and the frames', async t => {
  const out = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'forge-pipe-'));
  t.after(() => fs.rm(out, {recursive: true, force: true}));
  const input = await inputs('layout.json');
  const {summary} = await runPipeline({...input, out});
  assert.equal(summary.ok, true);
  assert.deepEqual((await fs.readdir(out)).sort(), ['bake', 'import', 'pipeline.json', 'pixelize']);
  const again = await readBakeDir(path.join(out, 'bake'));
  const qa = qaStage(again, {settings: input.project.settings, palette: input.project.palette, rig: input.rig, options: input.qa});
  assert.deepEqual(qa.findings, []);
  assert.equal(sha256(await fs.readFile(dir + 'turnaround.png')), summary.stages.import.record.sheet.sha256);
  assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(out, 'pipeline.json'), 'utf8')).stages), ['import', 'pixelize', 'bake', 'gates']);
});

test('the CLI runs the whole chain: pixelise writes the indexed layers, bake feeds them, gates re-run from disk', async t => {
  const out = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'forge-cli-'));
  t.after(() => fs.rm(out, {recursive: true, force: true}));
  const cli = path.join(root, 'studio/forge/cli.mjs'), p = ['--project', root, '--profile', 'pet'];
  const rigFile = path.join(out, 'rig.json'), marksFile = path.join(out, 'marks.json'), libFile = path.join(out, 'lib.json'), opts = path.join(out, 'qa.json');
  await fs.writeFile(rigFile, JSON.stringify(convertPrototypeRig(await json(dir + 'rig.json'), {id: 'lt_ink_marten'})));
  await fs.writeFile(marksFile, JSON.stringify(marks));
  await fs.copyFile(new URL('../rig/tests/fixtures/marten/bakeoff-motion.json', import.meta.url), libFile);
  await fs.writeFile(opts, JSON.stringify({weightTransfer: false}));
  await run('node', [cli, 'import', '--layout', dir + 'layout.forge.json', '--sheet', dir + 'turnaround.png', '--prompt', dir + 'prompt.txt', '--out', path.join(out, 'imp'), ...p]);
  await run('node', [cli, 'pixelise', '--import', path.join(out, 'imp'), '--marks', marksFile, '--out', path.join(out, 'px'), ...p]);
  await run('node', [cli, 'bake', '--pixelize', path.join(out, 'px'), '--rig', rigFile, '--library', libFile, '--qa', opts, '--out', path.join(out, 'bake'), ...p]);
  await run('node', [cli, 'gates', '--bake', path.join(out, 'bake'), '--rig', rigFile, '--qa', opts, ...p]);
  for (const [clip, n] of Object.entries(clips)) for (const f of facings) for (let i = 0; i < n; i++)
    assert.ok(framesEqual(readFrame(path.join(out, 'bake', `${clip}_${f}_${i}.png`)), readFrame(`${dir}frames/${clip}_${f}_${i}.png`)), `${clip}_${f}_${i}`);
  const full = path.join(out, 'full');
  const result = await run('node', [cli, 'run', '--layout', dir + 'layout.forge.json', '--sheet', dir + 'turnaround.png', '--prompt', dir + 'prompt.txt', '--marks', marksFile,
    '--rig', rigFile, '--library', libFile, '--qa', opts, '--out', full, ...p]);
  assert.match(result.stdout, /pipeline ok/);
  assert.equal((await json(path.join(full, 'pipeline.json'))).ok, true);
});

test('runPipeline never throws: a bad project, a failed import and a failed write are all stages, and pipeline.json is left behind', async t => {
  const out = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'forge-fail-'));
  t.after(() => fs.rm(out, {recursive: true, force: true}));
  const input = await inputs('layout.forge.json');
  // Bad profile: project loading is the first stage.
  const bad = await runPipeline({...input, project: {root, profile: 'no_such_profile'}, out: path.join(out, 'a')});
  assert.equal(bad.summary.ok, false);
  assert.equal(bad.summary.failed, 'project');
  assert.match(bad.summary.error, /no_such_profile/);
  assert.equal((await json(path.join(out, 'a', 'pipeline.json'))).failed, 'project');
  // Bad project root.
  assert.equal((await runPipeline({...input, project: {root: path.join(out, 'missing'), profile: 'pet'}})).summary.failed, 'project');
  // Failed import with out set: no import/ directory, but the diagnosis is on disk.
  const empty = {...(await json(dir + 'layout.forge.json')), cells: []};
  const failed = await runPipeline({...input, layout: empty, out: path.join(out, 'b')});
  assert.equal(failed.summary.failed, 'import');
  assert.deepEqual((await fs.readdir(path.join(out, 'b'))).sort(), ['pipeline.json']);
  assert.equal((await json(path.join(out, 'b', 'pipeline.json'))).failed, 'import');
  // A stage that failed after others finished: what finished is written.
  const bakeFail = structuredClone(input.rig); bakeFail.facings.south.parts[0].role = 'wing';
  const partial = await runPipeline({...input, rig: bakeFail, out: path.join(out, 'c')});
  assert.equal(partial.summary.failed, 'bake');
  assert.deepEqual((await fs.readdir(path.join(out, 'c'))).sort(), ['import', 'pipeline.json', 'pixelize']);
  // The output step itself failing (out is an existing file) is reported, not thrown.
  const file = path.join(out, 'plain-file');
  await fs.writeFile(file, 'x');
  const writeFailed = await runPipeline({...input, out: file});
  assert.equal(writeFailed.summary.failed, 'write');
  assert.ok(writeFailed.summary.writeError);
  // ...and it does not hide an earlier failure.
  const both = await runPipeline({...input, layout: empty, out: file});
  assert.equal(both.summary.failed, 'import');
  assert.ok(both.summary.writeError);
});
