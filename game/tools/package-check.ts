// E9.4 CLI. node tools/package-check.ts [--dist dir] [--pack dir]
// Builds the web package (game/dist: the PWA plugin writes sw.js and the atlas there, always) and the content pack (temp folder) unless
// --dist/--pack point at existing ones, then checks them against package-budget.json.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GAME } from './lib/repo.ts';
import { checkChunks, checkContentPack, checkWeb } from './lib/package-check.ts';

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tn2d-pkg-'));
const run = (cmd: string, args: string[]): void => { execFileSync(cmd, args, { cwd: GAME, stdio: ['ignore', 'pipe', 'inherit'] }); };
const dist = flag('--dist') ?? path.join(GAME, 'dist');
const pack = flag('--pack') ?? path.join(tmp, 'pack');
if (!flag('--dist')) run(path.join(GAME, 'node_modules/.bin/vite'), ['build', '--emptyOutDir']);
if (!flag('--pack')) run('node', ['tools/content-build.ts', '--out', pack]);
const problems = [...checkWeb(dist).map((x) => `web: ${x}`), ...checkContentPack(pack).map((x) => `pack: ${x}`), ...checkChunks().map((x) => `atlas: ${x}`)];
fs.rmSync(tmp, { recursive: true, force: true });
for (const x of problems) console.error(`ERROR: ${x}`);
console.log(problems.length ? `package:check FAILED: ${problems.length} problem(s)` : 'package:check OK: web build, content pack and atlas chunk budgets');
process.exit(problems.length ? 1 : 0);
