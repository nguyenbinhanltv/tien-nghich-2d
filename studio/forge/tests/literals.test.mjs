// The forge library must stay project-agnostic: no project names, paths or palette ids in its sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const banned = [/\bassets\//, /\btools\//, /palette\.json/, /manifest[\w.]*\.json/, /tien[-_ ]?nghich/i, /xianxia/i, /pixellab/i,
  /longtime/i, /marten/i, /\bsoul_\d|\bink_\d|\bjade_\d/, /#14101a/i, /\bpet\b/];

async function sources(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, e.name);
    if (e.isDirectory() && !['tests', 'prototype'].includes(e.name)) out.push(...await sources(file));
    else if (e.isFile() && e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs')) out.push(file);
  }
  return out;
}

test('studio/forge sources hold no project-specific literals', async () => {
  const hits = [];
  for (const file of await sources(root)) {
    // The forge lanes share this guard: only the sheet and pixelize lanes and the shared entry points are checked here.
    const rel = path.relative(root, file);
    if (!/^(image|index|cli)\.mjs$|^(sheet|pixelize)\//.test(rel)) continue;
    (await fs.readFile(file, 'utf8')).split('\n').forEach((line, i) => banned.forEach(re => re.test(line) && hits.push(`${rel}:${i + 1} ${re} ${line.trim()}`)));
  }
  assert.deepEqual(hits, []);
});
