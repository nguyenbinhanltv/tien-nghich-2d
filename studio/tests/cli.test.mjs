// The command line: init, check, doctor, --project, and the studio as a directory you can copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { StdioClient } from '../mcp/stdio_client.mjs';

const run = promisify(execFile);
const STUDIO = fileURLToPath(new URL('../', import.meta.url));
const SAMPLE = path.join(STUDIO, 'examples/moss-lantern');
const META = {'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': {name: 'cli-test', version: '1'}};

const tmpdir = t => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-cli-'))); t.after(() => fs.rmSync(d, {recursive: true, force: true})); return d; };
const cli = (studio, ...args) => run(process.execPath, [path.join(studio, 'cli.mjs'), ...args]).then(r => ({code: 0, ...r}), e => ({code: e.code, stdout: e.stdout, stderr: e.stderr}));
/** The studio on its own, as a stranger would copy it: no examples, no tests. */
const copyStudio = dir => { const to = path.join(dir, 'studio'); fs.cpSync(STUDIO, to, {recursive: true, filter: s => !s.startsWith(path.join(STUDIO, 'examples'))}); return to; };
const tree = dir => { const out = []; const walk = (d, rel) => { for (const e of fs.readdirSync(d, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) { const r = `${rel}${e.name}`; if (e.isDirectory()) walk(path.join(d, e.name), r + '/'); else out.push(r); } }; walk(dir, ''); return out; };

test('CLI-001: init creates a project that passes check, with a starter palette, folders, empty manifests, three agent configs and a README', async t => {
  const dir = tmpdir(t), studio = copyStudio(dir), project = path.join(dir, 'pond');
  const init = await cli(studio, 'init', project, '--name', 'Tiny Pond');
  assert.equal(init.code, 0, init.stderr);
  const files = tree(project);
  for (const f of ['studio.project.json', 'art/colors.json', 'design/sprites.json', 'design/audio.json', '.mcp.json', '.codex/config.toml', '.agents/mcp_config.json', 'README.md', 'src/sprites/.gitkeep', 'records/.gitkeep'])
    assert.ok(files.includes(f), f);
  const pack = JSON.parse(fs.readFileSync(path.join(project, 'studio.project.json'), 'utf8'));
  assert.deepEqual([pack.id, pack.name], ['tiny-pond', 'Tiny Pond']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'art/colors.json'), 'utf8')).colors.length, 8);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'design/sprites.json'), 'utf8')).assets, []);
  const checked = await cli(studio, 'check', '--project', project);
  assert.equal(checked.code, 0, checked.stdout);
  assert.match(checked.stdout, /Tiny Pond \[tiny-pond\]: OK \(0 errors, 0 warnings\)/);
  assert.match(checked.stdout, /no baseline declared: every frame without a human record is awaiting review/);
});

test('CLI-001: init never overwrites a file and never writes outside the directory, not even through a symlinked folder', async t => {
  const dir = tmpdir(t), studio = copyStudio(dir), project = path.join(dir, 'pond'), outside = path.join(dir, 'outside');
  fs.mkdirSync(project); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(project, 'README.md'), 'mine\n');
  fs.writeFileSync(path.join(project, 'studio.project.json'), '{"keep":"me"}\n');
  fs.symlinkSync(outside, path.join(project, 'art'));
  // A link above a folder that does not exist yet: mkdir -p through it would create the tail outside.
  const outsideDeep = path.join(dir, 'outside-deep');
  fs.mkdirSync(outsideDeep);
  fs.symlinkSync(outsideDeep, path.join(project, 'audio'));
  const init = await cli(studio, 'init', project);
  assert.equal(init.code, 0, init.stderr);
  assert.equal(fs.readFileSync(path.join(project, 'README.md'), 'utf8'), 'mine\n');
  assert.equal(fs.readFileSync(path.join(project, 'studio.project.json'), 'utf8'), '{"keep":"me"}\n');
  assert.match(init.stdout, /skipped  README\.md/);
  assert.match(init.stdout, /skipped  art\/colors\.json \(its folder leads outside the project\)/);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written through the symlink');
  assert.deepEqual(fs.readdirSync(outsideDeep), [], 'no folder was created through a linked parent either');
  assert.match(init.stdout, /skipped  audio\/packs\/\.gitkeep \(its folder leads outside the project\)/);
  const again = await cli(studio, 'init', project);
  assert.doesNotMatch(again.stdout, /created  /, 'a second run creates nothing');
  assert.notEqual((await cli(studio, 'init')).code, 0, 'init needs a directory');
  fs.writeFileSync(path.join(dir, 'afile'), 'x');
  assert.notEqual((await cli(studio, 'init', path.join(dir, 'afile'))).code, 0, 'a file is not a project directory');
});

test('CLI-002: check reports what is missing and exits 1 on errors; doctor names only Node as required', async t => {
  const dir = tmpdir(t), studio = copyStudio(dir);
  const empty = await cli(studio, 'check', '--project', dir);
  assert.equal(empty.code, 1);
  assert.match(empty.stdout, /error\s+studio\.project\.json: not found/);
  const project = path.join(dir, 'p');
  await cli(studio, 'init', project);
  fs.rmSync(path.join(project, 'art/colors.json'));
  const noPalette = await cli(studio, 'check', '--project', project, '--json');
  assert.equal(noPalette.code, 1);
  const report = JSON.parse(noPalette.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some(e => /art\/colors\.json/.test(e.message + e.where)), JSON.stringify(report.errors));
  const design = path.join(project, 'design/sprites.json');
  fs.writeFileSync(path.join(project, 'art/colors.json'), JSON.stringify({outline: '#000000', colors: [{id: 'a', hex: '#000000'}]}));
  fs.writeFileSync(design, JSON.stringify({...JSON.parse(fs.readFileSync(design, 'utf8')), assets: [{id: 'x', profile: 'nope', chunk_group: 'main'}]}));
  assert.match((await cli(studio, 'check', '--project', project)).stdout, /asset x names profile "nope", which does not exist/);
  const doc = await cli(studio, 'doctor', '--project', SAMPLE, '--json');
  assert.equal(doc.code, 0);
  const checks = JSON.parse(doc.stdout);
  assert.deepEqual(checks.filter(c => c.required).map(c => c.name).sort(), ['node', 'node:sqlite']);
  assert.ok(checks.find(c => c.name === 'project interpreter').status === 'ok');
  const text = await cli(studio, 'doctor');
  assert.match(text.stdout, /Nothing required is missing\. Optional tools matter only/);
});

test('CLI-003 CLI-004: a copy of studio/ alone, outside the project, serves it, speaks MCP for it, and checks the baseline; no install', async t => {
  const dir = tmpdir(t), studio = copyStudio(dir), project = path.join(dir, 'game with space');
  await cli(studio, 'init', project, '--name', 'Spacey');
  const link = path.join(dir, 'link');
  fs.symlinkSync(project, link);   // the project reached through a symlink must work too
  assert.ok(!fs.existsSync(path.join(studio, 'node_modules')));
  // mcp: one real session at author scope plans an asset.
  const client = new StdioClient(path.join(studio, 'cli.mjs'), ['mcp', '--project', link, '--scope', 'author', '--agent', 'test']);
  t.after(() => client.close());
  const call = async (name, args) => (await client.request(`c-${name}`, 'tools/call', {name, arguments: args, _meta: META}, 30_000)).result;
  const info = await call('studio_project_info', {});
  assert.equal(info.structuredContent.palette.count, 8);
  const planned = await call('studio_asset_plan', {op: 'create', id: 'first_sprite', profile: 'sprite', chunk: 'main', phase: 'later', brief: 'The first one.'});
  assert.equal(planned.isError, undefined, JSON.stringify(planned));
  assert.ok(JSON.parse(fs.readFileSync(path.join(project, 'design/studio_plans.json'), 'utf8')).entries.some(e => e.id === 'first_sprite'));
  // serve: the shell and the project API answer.
  const server = spawn(process.execPath, [path.join(studio, 'cli.mjs'), 'serve', '--project', link, '--port', '0'], {stdio: ['ignore', 'pipe', 'pipe']});
  t.after(() => server.kill('SIGTERM'));
  const base = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', c => { out += c; const m = /(http:\/\/127\.0\.0\.1:\d+)\/studio\//.exec(out); if (m) resolve(m[1]); });
    server.on('exit', code => reject(new Error(`server exited ${code}`)));
    setTimeout(() => reject(new Error('no server')), 20_000).unref();
  });
  assert.equal((await fetch(`${base}/studio/`)).status, 200);
  const projectInfo = await (await fetch(`${base}/api/studio/project`)).json();
  assert.equal(projectInfo.name, 'Spacey');
  assert.equal((await fetch(`${base}/api/studio/overview`)).status, 200);
  // The forge and audio command lines take --project too (the sample brings its own profile and sample rate).
  const out = path.join(dir, 'out');
  fs.mkdirSync(out);
  await run(process.execPath, [path.join(studio, 'forge/cli.mjs'), 'template', '--project', SAMPLE, '--profile', 'critter', '--out', path.join(out, 't.png'), '--layout-out', path.join(out, 'l.json'), '--size', '600x600']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'l.json'), 'utf8')).cells.length, 2);
  await run(process.execPath, [path.join(studio, 'audio/cli.mjs'), 'render', path.join(SAMPLE, 'audio/documents/chime_soft.patch.json'), '--out', path.join(out, 'c.wav'), '--project', SAMPLE]);
  assert.equal(fs.readFileSync(path.join(out, 'c.wav')).readUInt32LE(24), 32000, 'rendered at the sample\'s own rate');
  // baseline: this project declares none.
  assert.match((await cli(studio, 'baseline', '--project', project, '--check')).stdout, /declares no review\.baseline/);
});

test('CLI-004: package.json declares name, version, type, engines and bin and nothing that installs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(STUDIO, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg).filter(k => ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'scripts', 'workspaces'].includes(k)), []);
  assert.deepEqual([pkg.type, pkg.engines.node, pkg.bin.studio], ['module', '>=24', 'cli.mjs']);
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  // Every import of the studio's own code is relative or built in: nothing needs a package.
  const bad = [];
  const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true})) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['examples', 'node_modules'].includes(e.name)) walk(p); continue; }
    if (!/\.(mjs|js)$/.test(e.name) || /\.test\./.test(e.name) || p.includes(`${path.sep}tests${path.sep}`) || p.includes(`${path.sep}prototype${path.sep}`) || p.includes(`${path.sep}ui${path.sep}`) && !p.endsWith('.mjs')) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:^|\n)\s*import\s[^'"\n]*?['"]([^'"]+)['"]/g)) if (!m[1].startsWith('.') && !m[1].startsWith('node:') && !m[1].startsWith('/')) bad.push(`${path.relative(STUDIO, p)}: ${m[1]}`);
  } };
  walk(STUDIO);
  assert.deepEqual(bad, []);
});

test('CLI-006: the agent configs init writes are at read scope, and an agent connected with them cannot write', async t => {
  const dir = tmpdir(t), studio = copyStudio(dir), project = path.join(dir, 'p');
  await cli(studio, 'init', project);
  const json = JSON.parse(fs.readFileSync(path.join(project, '.mcp.json'), 'utf8')).mcpServers.studio;
  const anti = JSON.parse(fs.readFileSync(path.join(project, '.agents/mcp_config.json'), 'utf8')).mcpServers.studio;
  const toml = fs.readFileSync(path.join(project, '.codex/config.toml'), 'utf8');
  const tomlArgs = JSON.parse(/^args = (\[.*\])$/m.exec(toml)[1]);
  for (const args of [json.args, anti.args, tomlArgs]) {
    assert.equal(args[args.indexOf('--scope') + 1], 'read');
    assert.ok(path.isAbsolute(args[0]) && args[0].startsWith(studio), 'the studio is outside the project, so the path is absolute');
    assert.equal(args[args.indexOf('--project') + 1], '.');
  }
  assert.match(toml, /change "read" to "author"/);
  assert.match(fs.readFileSync(path.join(project, 'README.md'), 'utf8'), /change `"read"` to `"author"`/);
  // Start the server exactly as the config says, from the project directory.
  const client = new StdioClient(json.args[0], json.args.slice(1), {cwd: project});
  t.after(() => client.close());
  const list = await client.request('l1', 'tools/list', {_meta: META});
  const names = list.result.tools.map(x => x.name);
  assert.ok(names.includes('studio_project_info') && !names.includes('studio_frames_submit') && !names.includes('studio_asset_plan'));
  assert.ok(!names.some(n => /approve|sign|publish|delete/.test(n)));
  const write = await client.request('w1', 'tools/call', {name: 'studio_asset_plan', arguments: {op: 'create', id: 'x', profile: 'sprite', chunk: 'main'}, _meta: META});
  assert.ok(write.error || write.result?.isError, 'a write at read scope is refused: ' + JSON.stringify(write));
  assert.match(JSON.stringify(write), /scope|Unknown tool/);
});

test('CLI-003: --project=<dir> and --project <dir> select the same project for serve, check, baseline and mcp', async t => {
  const dir = tmpdir(t), studio = copyStudio(dir), project = path.join(dir, 'equals form');
  await cli(studio, 'init', project, '--name', 'Equals Form');
  const other = path.join(dir, 'cwd project');   // the current directory is a DIFFERENT project: picking it would be the bug
  await cli(studio, 'init', other, '--name', 'The Cwd One');
  const inCwd = (args, extra = {}) => run(process.execPath, [path.join(studio, 'cli.mjs'), ...args], {cwd: other, ...extra}).then(r => ({code: 0, ...r}), e => ({code: e.code, stdout: e.stdout, stderr: e.stderr}));
  for (const form of [['--project', project], [`--project=${project}`]]) {
    assert.match((await inCwd(['check', ...form])).stdout, /Equals Form \[equals-form\]: OK/, form.join(' '));
    // baseline reads the pack of the project it is given: a declared baseline in one project and none in the other tells them apart.
    const pack = JSON.parse(fs.readFileSync(path.join(project, 'studio.project.json'), 'utf8'));
    pack.review = {baseline: {file: 'records/baseline.json', roots: ['build/frames']}};
    fs.writeFileSync(path.join(project, 'studio.project.json'), JSON.stringify(pack));
    fs.writeFileSync(path.join(project, 'records/baseline.json'), JSON.stringify({schema_version: 1, roots: ['build/frames'], directories: {}}));
    assert.match((await inCwd(['baseline', ...form, '--check'])).stdout, /0 of 0 baseline directories still match/, form.join(' '));
    delete pack.review;
    fs.writeFileSync(path.join(project, 'studio.project.json'), JSON.stringify(pack));
    assert.match((await inCwd(['baseline', ...form, '--check'])).stdout, /declares no review\.baseline/, form.join(' '));
    // serve announces the project it serves.
    const server = spawn(process.execPath, [path.join(studio, 'cli.mjs'), 'serve', ...form, '--port', '0'], {cwd: other, stdio: ['ignore', 'pipe', 'pipe']});
    const said = await new Promise((resolve, reject) => {
      let out = '';
      server.stdout.on('data', c => { out += c; if (/http:\/\/127\.0\.0\.1:\d+\/studio\//.test(out)) resolve(out); });
      server.on('exit', code => reject(new Error(`server exited ${code}`)));
      setTimeout(() => reject(new Error('no server')), 20_000).unref();
    });
    server.kill('SIGTERM');
    assert.match(said, /Pixel Kiln serving Equals Form at /, form.join(' '));
    // mcp: the project info of the session names the project.
    const client = new StdioClient(path.join(studio, 'cli.mjs'), ['mcp', ...form, '--scope', 'read'], {cwd: other});
    const info = await client.request('i1', 'tools/call', {name: 'studio_project_info', arguments: {sections: ['palette']}, _meta: META}, 30_000);
    await client.close();
    assert.equal(info.result.structuredContent.palette.count, 8);
    assert.match(info.result._meta['io.modelcontextprotocol/serverInfo'].title, /Equals Form/, form.join(' '));
  }
});

test('CLI-009: the tool is named Pixel Kiln for people; pixel-kiln is the command and studio stays an alias', async () => {
  const read = f => fs.readFileSync(path.join(STUDIO, f), 'utf8');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.name, 'pixel-kiln');
  assert.equal(pkg.bin['pixel-kiln'], 'cli.mjs');
  assert.equal(pkg.bin.studio, 'cli.mjs', 'the old command keeps working');
  assert.match(read('index.html'), /<title>Pixel Kiln<\/title>/);
  for (const lang of ['en', 'vi']) assert.equal(JSON.parse(read(`ui/i18n/${lang}.json`))['app.title'], 'Pixel Kiln');
  assert.match(read('README.md'), /^# Pixel Kiln/m);
  const help = await cli(STUDIO, '--help');
  assert.match(help.stdout, /Pixel Kiln/);
  assert.match(help.stdout, /pixel-kiln <command>/);
  // No place a person reads calls the tool by an old name (tool names studio_*, the studio/ directory and schema keys are contracts and stay).
  const readable = ['README.md', 'index.html', 'ui/README.md', 'mcp/README.md', 'specs/mcp.md', 'ui/i18n/en.json', 'ui/i18n/vi.json', 'core/scaffold.mjs'];
  for (const f of readable) assert.doesNotMatch(read(f), /pixel studio/i, f);
  // The MCP handshake names the tool and, separately, the project.
  const client = new StdioClient(path.join(STUDIO, 'cli.mjs'), ['mcp', '--project', SAMPLE, '--scope', 'read']);
  const init = await client.request('i0', 'initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'cli-test', version: '1'}}, 30_000);
  await client.close();
  assert.match(init.result.serverInfo.title, /^Pixel Kiln · /);
  assert.match(init.result.instructions, /^Pixel Kiln, the pixel-art asset studio, serving the project "/);
});
