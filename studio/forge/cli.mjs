#!/usr/bin/env node
// Forge CLI: the same steps the MCP tools run, for a human or CI.
//   node studio/forge/cli.mjs template  --out template.png [--layout-out layout.json] [--layout in.json]
//        [--id name] [--facings south,west,north,east] [--poses idle,walk] [--size 1024x1024] [--height-px 20]
//        [--project root --profile <name>]            (profile supplies the facings and a default height)
//   node studio/forge/cli.mjs import    --layout layout.json --sheet sheet.png --out dir [--prompt file | --prompt-text s]
//        [--project root --profile <name>]            (profile adds the normalised scale to the record)
//   node studio/forge/cli.mjs pixelise  --import dir --out dir --project root --profile <name> [--marks marks.json]
//        (writes <cell>.png, indexed/<cell>.png - the outline-free layers the rig baker takes - and pixelize.json)
//   node studio/forge/cli.mjs bake      --pixelize dir --out dir --project root --profile <name> [--rig rig.json]
//        [--poses poseclips.json] [--pose-rig rig.json] [--patch patch.json] [--library lib.json] [--clips a,b] [--qa gates.json]
//        rig bake + pose-sheet clips, patches, then the gates; writes frames, bake.json, gates.json; exit 2 on a gate error
//   node studio/forge/cli.mjs gates     --bake dir --project root --profile <name> [--rig rig.json] [--pose-rig rig.json] [--qa gates.json]
//   node studio/forge/cli.mjs run       --layout layout.json --sheet sheet.png --out dir --project root --profile <name>
//        [--prompt file] [--marks marks.json] [bake options] [import options]   the whole chain; writes import/ pixelize/ bake/ pipeline.json
//   node studio/forge/cli.mjs compare   --sets name=dir,name=dir --out sheet.png [--json report.json] [--scale 4]
//        [--project root --profile <name> --rig rig.json --qa gates.json]    side-by-side contact sheet of bake or frame directories;
//        with a profile the bake directories are also run through the gates and summarised per gate
// import and run also take --scale-mode cell|facing|sheet [--ground-lift n] [--margin n] [--fixed-scale scales.json]
// ({facing: scale}, e.g. the per-facing scales of a turnaround import) - all recorded in import.json. `qa` is an alias of `gates`.
// `pixelize` is accepted as an alias. Output directories are created; inputs are never modified.
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPack } from '../core/pack.mjs';
import { bakeStage, compareSets, encodePng, importSheet, normalizeLayout, pixelizeImport, qaStage, readBakeDir, readImport, readPixelized, readSheetFile, renderTemplate,
  resolveMarks, rigPalette, runPipeline, settingsFromPack, summarizeBake, turnaroundLayout, writeBakeDir, writeImport, writePixelized } from './index.mjs';

const usage = 'usage: cli.mjs template|import|pixelise [options]  (see the header of studio/forge/cli.mjs)';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    opts[arg.slice(2)] = value;
  }
  return opts;
}

const need = (opts, name) => opts[name] ?? (() => { throw new Error(`missing --${name}`); })();
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function project(opts) {
  if (!opts.profile) return null;
  const root = path.resolve(opts.project ?? '.');
  const pack = await loadPack(root);
  return settingsFromPack(pack, root, opts.profile);
}

const scaleOptionsOf = opts => ({
  ...(opts['scale-mode'] ? {mode: opts['scale-mode']} : {}),
  ...(opts['ground-lift'] ? {groundLift: Number(opts['ground-lift'])} : {}),
  ...(opts.margin ? {margin: Number(opts.margin)} : {}),
  ...(opts['fixed-scale'] ? {fixedScale: JSON.parse(readFileSync(opts['fixed-scale'], 'utf8'))} : {}),
});
const optionalJson = async file => (file ? readJson(file) : undefined);
const reportGates = gates => {
  const errors = gates.findings.filter(f => f.severity === 'error');
  console.log(`gates: ${gates.pass ? 'pass' : 'FAIL'} (${errors.length} error(s), ${gates.findings.length - errors.length} warning(s))`);
  for (const f of gates.findings) console.log(`  ${f.severity} ${f.gate} ${f.clip}/${f.facing} key ${f.frame}: ${f.message}`);
  if (!gates.pass) process.exitCode = 2;
};

const commands = {
  async template(opts) {
    const settings = await project(opts);
    let layout;
    if (opts.layout) layout = normalizeLayout(await readJson(opts.layout));
    else {
      const facings = opts.facings?.split(',') ?? settings?.profile.directions;
      if (!facings) throw new Error('give --layout, --facings or a --profile with directions');
      const [w, h] = (opts.size ?? '1024x1024').split('x').map(Number);
      layout = turnaroundLayout({id: opts.id ?? settings?.profile.name ?? 'sheet', facings, poses: opts.poses?.split(','),
        size: [w, h], heightPx: Number(opts['height-px'] ?? (settings ? Math.round(settings.profile.nativePx[1] * 0.65) : 20))});
    }
    await fs.writeFile(need(opts, 'out'), encodePng(renderTemplate(layout)));
    if (opts['layout-out']) await fs.writeFile(opts['layout-out'], JSON.stringify(layout, null, 2) + '\n');
    console.log(`template ${layout.id}: ${layout.cells.length} cells, ${layout.size.join('x')} -> ${opts.out}`);
  },

  async import(opts) {
    const settings = await project(opts);
    const layout = normalizeLayout(await readJson(need(opts, 'layout')));
    const sheetFile = need(opts, 'sheet'), {bytes, image} = await readSheetFile(sheetFile);
    const prompt = opts.prompt ? await fs.readFile(opts.prompt, 'utf8') : opts['prompt-text'] ?? '';
    const result = importSheet({layout, sheet: image, sheetBytes: bytes, source: path.basename(sheetFile), prompt, profile: settings?.profile, scaleOptions: scaleOptionsOf(opts)});
    await writeImport(need(opts, 'out'), result, {protect: [sheetFile]});
    console.log(`import ${layout.id}: ${result.cells.size} cells, sheet sha256 ${result.record.sheet.sha256} -> ${opts.out}`);
    for (const c of result.record.cells.filter(cell => cell.warnings.length)) console.warn(`warning ${c.id}: ${c.warnings.join(', ')} (the crop may cut the drawing)`);
  },

  async pixelise(opts) {
    const settings = await project({project: '.', ...opts});
    if (!settings) throw new Error('missing --profile');
    const imported = await readImport(need(opts, 'import'));
    const marks = resolveMarks(opts.marks ? await readJson(opts.marks) : [], settings.palette);
    const result = pixelizeImport(imported, settings, {marks});
    await writePixelized(need(opts, 'out'), result, {protect: [path.join(opts.import, 'import.json')]});
    const warned = result.record.cells.filter(c => c.warnings.length);
    console.log(`pixelise ${result.record.profile.name}: ${result.cells.size} sprites at ${result.record.profile.nativePx.join('x')} -> ${opts.out}`);
    for (const c of warned) console.warn(`warning ${c.id}: ${c.warnings.join('; ')}`);
  },

  async bake(opts) {
    const settings = await project({project: '.', ...opts});
    if (!settings) throw new Error('missing --profile');
    const pixelized = await readPixelized(need(opts, 'pixelize'));
    const rig = await optionalJson(opts.rig), poseRig = await optionalJson(opts['pose-rig']), poseClips = await optionalJson(opts.poses);
    if (!rig && !poseClips) throw new Error('give --rig and/or --poses');
    const palette = rigPalette(settings);
    const result = bakeStage({settings, palette, cells: pixelized.cells, rig, poseRig, poseClips, patch: await optionalJson(opts.patch),
      library: await optionalJson(opts.library), clips: opts.clips?.split(',')});
    const gates = qaStage(result, {settings, palette, rig, poseRig, options: await optionalJson(opts.qa)});
    const out = need(opts, 'out');
    const names = await writeBakeDir(result, out);
    await fs.writeFile(path.join(out, 'gates.json'), JSON.stringify(gates, null, 2) + '\n');
    console.log(`bake ${result.profile}: ${Object.keys(result.clips).length} clip(s), ${names.length} frames -> ${out}`);
    reportGates(gates);
  },

  async gates(opts) {
    const settings = await project({project: '.', ...opts});
    if (!settings) throw new Error('missing --profile');
    const result = await readBakeDir(need(opts, 'bake'));
    const gates = qaStage(result, {settings, palette: rigPalette(settings), rig: await optionalJson(opts.rig), poseRig: await optionalJson(opts['pose-rig']),
      options: await optionalJson(opts.qa)});
    reportGates(gates);
  },

  async compare(opts) {
    const dirs = Object.fromEntries(need(opts, 'sets').split(',').map(pair => { const i = pair.indexOf('='); if (i < 1) throw new Error('--sets takes name=dir,name=dir'); return [pair.slice(0, i), pair.slice(i + 1)]; }));
    const settings = opts.profile ? await project({project: '.', ...opts}) : null;
    const gates = settings ? {settings, palette: rigPalette(settings), rig: await optionalJson(opts.rig), poseRig: await optionalJson(opts['pose-rig']), options: await optionalJson(opts.qa)} : undefined;
    const {sheet, rows, sets} = await compareSets(dirs, {scale: Number(opts.scale ?? 4), gates});
    await fs.writeFile(need(opts, 'out'), encodePng(sheet));
    if (opts.json) await fs.writeFile(opts.json, JSON.stringify({rows, sets}, null, 2) + '\n');
    console.log(`compare: ${Object.keys(dirs).length} set(s), ${rows.length} row(s) -> ${opts.out}`);
    for (const [name, set] of Object.entries(sets)) console.log(`  ${name}: ${set.frames} frames${set.gates ? `, gates ${set.gates.pass ? 'pass' : 'FAIL'} ${JSON.stringify(set.gates.findings)}` : ''}`);
  },

  async run(opts) {
    if (!opts.profile) throw new Error('missing --profile');
    const sheetFile = need(opts, 'sheet'), {bytes} = await readSheetFile(sheetFile);
    const {summary} = await runPipeline({
      project: {root: path.resolve(opts.project ?? '.'), profile: opts.profile},
      layout: await readJson(need(opts, 'layout')), sheet: {bytes, source: sheetFile},
      prompt: opts.prompt ? await fs.readFile(opts.prompt, 'utf8') : opts['prompt-text'] ?? '',
      marks: await optionalJson(opts.marks), scaleOptions: scaleOptionsOf(opts),
      rig: await optionalJson(opts.rig), poseRig: await optionalJson(opts['pose-rig']), poseClips: await optionalJson(opts.poses),
      patch: await optionalJson(opts.patch), library: await optionalJson(opts.library), clips: opts.clips?.split(','),
      qa: await optionalJson(opts.qa), out: need(opts, 'out'),
    });
    if (summary.ok) console.log(`pipeline ok: ${Object.keys(summary.stages).join(' -> ')} -> ${opts.out}`);
    else {
      console.error(`pipeline failed at ${summary.failed}: ${summary.error}`);
      if (summary.stages.gates) reportGates(summary.stages.gates);
      process.exitCode = process.exitCode || 1;
    }
  },
};
commands.pixelize = commands.pixelise;
commands.qa = commands.gates;

try {
  const [name, ...rest] = process.argv.slice(2);
  if (!commands[name]) throw new Error(usage);
  await commands[name](parseArgs(rest));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
