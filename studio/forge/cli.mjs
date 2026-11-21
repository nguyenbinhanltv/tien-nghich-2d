#!/usr/bin/env node
// Forge CLI: the same steps the MCP tools run, for a human or CI.
//   node studio/forge/cli.mjs template  --out template.png [--layout-out layout.json] [--layout in.json]
//        [--id name] [--facings south,west,north,east] [--poses idle,walk] [--size 1024x1024] [--height-px 20]
//        [--project root --profile <name>]            (profile supplies the facings and a default height)
//   node studio/forge/cli.mjs import    --layout layout.json --sheet sheet.png --out dir [--prompt file | --prompt-text s]
//        [--project root --profile <name>]            (profile adds the normalised scale to the record)
//   node studio/forge/cli.mjs pixelise  --import dir --out dir --project root --profile <name> [--marks marks.json]
// `pixelize` is accepted as an alias. Output directories are created; inputs are never modified.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPack } from '../core/pack.mjs';
import { encodePng, importSheet, normalizeLayout, pixelizeImport, readImport, readSheetFile, renderTemplate,
  resolveMarks, settingsFromPack, turnaroundLayout, writeImport, writePixelized } from './index.mjs';

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
    const result = importSheet({layout, sheet: image, sheetBytes: bytes, source: path.basename(sheetFile), prompt, profile: settings?.profile});
    await writeImport(need(opts, 'out'), result, {protect: [sheetFile]});
    console.log(`import ${layout.id}: ${result.cells.size} cells, sheet sha256 ${result.record.sheet.sha256} -> ${opts.out}`);
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
};
commands.pixelize = commands.pixelise;

try {
  const [name, ...rest] = process.argv.slice(2);
  if (!commands[name]) throw new Error(usage);
  await commands[name](parseArgs(rest));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
