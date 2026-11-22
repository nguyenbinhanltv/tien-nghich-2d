#!/usr/bin/env node
// Pixel Kiln's single entry point (command `pixel-kiln`, alias `studio`; or `node studio/cli.mjs`). Works from a copy of the studio/ directory alone: no install, no npm.
//
//   node studio/cli.mjs init <dir> [--name <text>] [--id <slug>]    create a new, empty project
//   node studio/cli.mjs serve  [--project <dir>] [--port <n>] [--host <addr>] [--revision-dir <abs>]   (no --project: opens on the Projects screen)
//   node studio/cli.mjs projects list [--json] | add <dir> | remove <id>   the user-level list of projects (never deletes files)
//   node studio/cli.mjs mcp    [--project <dir>] [--scope read|author|pack] [--agent <name>] ...   (the options of mcp.mjs)
//   node studio/cli.mjs check  [--project <dir>] [--json]           validate the pack and say what is missing
//   node studio/cli.mjs doctor [--project <dir>] [--json]           Node version and optional tools
//   node studio/cli.mjs baseline [--project <dir>] --check|--write  the review baseline record (see studio/baseline.mjs)
//
// check, doctor, baseline and mcp take --project (default: the current directory). `serve` without --project starts on the Projects screen.
// The studio may live anywhere, inside the project or outside it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const HELP = `Pixel Kiln: a local pixel-art asset studio.
Usage: pixel-kiln <command> [options]   (alias: studio; or: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url)) || 'cli.mjs'} <command> [options])

Commands:
  init <dir>   create a project (pack, starter palette, folders, empty manifests, agent configs at read scope, README); never overwrites
  serve        run Pixel Kiln in the browser (loopback only); with --project it opens that project, without it the Projects screen
  projects     list | add <dir> | remove <id>: the list of projects on this machine (remove never deletes files)
  mcp          run the MCP server for a project over stdio (one agent is enough)
  check        validate the pack and report what is missing (exit 1 on errors)
  doctor       Node version and the optional tools on this machine
  baseline     write or check the review baseline record (--check | --write)

Options:
  --project <dir>   the project directory (default: the current directory; for serve: none, start on the Projects screen)
  --json            check and doctor: print JSON
  --help
Run a command with --help for its own options (serve, mcp).`;

/** Hand over to one of the studio's own scripts, as if it had been started by name (they read process.argv and own their signals and exit codes). */
async function run(script, args) {
  const file = path.join(here, script);
  process.argv = [process.argv[0], file, ...args];
  await import(file);
}

// `--project=<dir>` and `--project <dir>` mean the same everywhere: hand every script the separate form.
const argv = process.argv.slice(2).flatMap(a => (a.startsWith('--project=') ? ['--project', a.slice('--project='.length)] : [a]));
const [command, ...rest] = argv;
if (!command || ['-h', '--help', 'help'].includes(command)) { console.log(HELP); process.exit(command ? 0 : 2); }

function flags(options) {
  try { return parseArgs({args: rest, options: {project: {type: 'string'}, ...options}, allowPositionals: true}); }
  catch (error) { console.error(`pixel-kiln ${command}: ${error.message}`); process.exit(2); }
}
const projectOf = values => path.resolve(values.project ?? process.cwd());

switch (command) {
  case 'init': {
    const {values, positionals} = flags({name: {type: 'string'}, id: {type: 'string'}});
    if (positionals.length !== 1) { console.error('pixel-kiln init: give one directory, e.g. `init my-game`'); process.exit(2); }
    const {scaffold} = await import('./core/scaffold.mjs');
    try {
      const r = await scaffold(positionals[0], here, values);
      console.log(`Project "${r.name}" (${r.id}) in ${r.dir}`);
      for (const f of r.created) console.log(`  created  ${f}`);
      for (const f of r.skipped) console.log(`  skipped  ${f} (already exists; not touched)`);
      console.log(`\nNext:\n  node ${path.join(here, 'cli.mjs')} check --project ${r.dir}\n  node ${path.join(here, 'cli.mjs')} serve --project ${r.dir}`);
    } catch (error) { console.error(`pixel-kiln init: ${error.message}`); process.exit(1); }
    break;
  }
  case 'serve': await run('serve.mjs', rest); break;
  case 'projects': {
    const {values, positionals} = flags({json: {type: 'boolean'}});
    const [action, arg, ...more] = positionals;
    const reg = await import('./core/project-registry.mjs');
    const registry = reg.createRegistry();
    const fail = (message, code = 1) => { console.error(`pixel-kiln projects: ${message}`); process.exit(code); };
    if (more.length || !['list', 'add', 'remove'].includes(action) || (action === 'list') !== (arg === undefined)) fail('use `projects list`, `projects add <dir>` or `projects remove <id>`', 2);
    if (action === 'list') {
      const entries = await registry.list();
      const rows = await Promise.all(entries.map(async e => {
        try { await reg.inspectProject(e.path, {strict: false}); return {...e, status: 'ok'}; }
        catch (error) { return {...e, status: error.code === 'not_found' ? 'missing' : 'invalid'}; }
      }));
      if (values.json) console.log(JSON.stringify({home: registry.home, projects: rows}, null, 2));
      else if (!rows.length) console.log(`No projects yet. Add one with \`pixel-kiln projects add <dir>\`. (list: ${registry.file})`);
      else for (const r of rows) console.log(`${r.id}  ${r.status.padEnd(7)} ${r.name}  ${r.path}${r.lastOpened ? `  (opened ${r.lastOpened})` : ''}`);
    } else if (action === 'add') {
      try {
        const found = await reg.inspectProject(arg, {strict: false});
        const entry = await registry.add({root: found.root, name: found.pack.name});
        console.log(`Added "${entry.name}" (${entry.id}) at ${entry.path}`);
      } catch (error) {
        console.error(`pixel-kiln projects add: ${error.message}`);
        for (const issue of error.issues ?? []) console.error(`  ${issue}`);
        process.exit(1);
      }
    } else if (!(await registry.remove(arg))) fail(`no project with id ${arg} in the list`);
    else console.log(`Removed ${arg} from the list. No file was deleted.`);
    break;
  }
  case 'mcp': await run('mcp.mjs', rest.includes('--project') ? rest : ['--project', process.cwd(), ...rest]); break;
  case 'baseline': await run('baseline.mjs', rest.includes('--project') ? rest : ['--project', process.cwd(), ...rest]); break;
  case 'check': {
    const {values} = flags({json: {type: 'boolean'}});
    const {checkProject, formatCheck} = await import('./core/check-project.mjs');
    const result = await checkProject(projectOf(values));
    console.log(values.json ? JSON.stringify(result, null, 2) : formatCheck(result));
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case 'doctor': {
    const {values} = flags({json: {type: 'boolean'}});
    const {doctor, formatDoctor} = await import('./core/doctor.mjs');
    const checks = await doctor(values.project ? projectOf(values) : (await import('node:fs')).existsSync(path.join(process.cwd(), 'studio.project.json')) ? process.cwd() : undefined);
    console.log(values.json ? JSON.stringify(checks, null, 2) : formatDoctor(checks));
    process.exit(checks.some(c => c.required && c.status !== 'ok') ? 1 : 0);
    break;
  }
  default:
    console.error(`pixel-kiln: unknown command "${command}"\n\n${HELP}`);
    process.exit(2);
}
