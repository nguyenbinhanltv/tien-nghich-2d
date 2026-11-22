import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
const run = args => promisify(execFile)('node', [cli, ...args]).then(r => ({code: 0, ...r}), e => ({code: e.code, stdout: e.stdout, stderr: e.stderr}));
const commands = ['template', 'import', 'pixelise', 'bake', 'gates', 'compare', 'run'];

test('--help and a bare invocation list every command', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  for (const name of commands) assert.match(help.stdout, new RegExp(`^  ${name}\\s`, 'm'), name);
  const bare = await run([]);
  assert.equal(bare.code, 1);
  for (const name of commands) assert.match(bare.stderr, new RegExp(`^  ${name}\\s`, 'm'), name);
  assert.equal((await run(['help'])).stdout, help.stdout);
});

test('every command the CLI implements is in the help, and every listed command is implemented', async () => {
  const source = await fs.readFile(cli, 'utf8');
  const implemented = [...source.matchAll(/^ {2}async (\w+)\(opts\)/gm)].map(m => m[1]);
  assert.deepEqual(implemented.sort(), [...commands].filter(c => c !== 'pixelise').concat('pixelise').sort());
  for (const name of commands) {
    const one = await run([name, '--help']);
    assert.equal(one.code, 0, name);
    assert.match(one.stdout, new RegExp(`^usage: node studio/forge/cli.mjs ${name} --`), name);
  }
  assert.match((await run(['pixelize', '--help'])).stdout, /cli\.mjs pixelise /);
  assert.match((await run(['qa', '--help'])).stdout, /cli\.mjs gates /);
});

test('an unknown command fails with the full list', async () => {
  const bad = await run(['bakee']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /unknown command "bakee"/);
  assert.match(bad.stderr, /^  compare\s/m);
});
