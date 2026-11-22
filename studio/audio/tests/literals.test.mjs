// The engine must stay project-agnostic: no project names, paths or cue IDs in studio/audio sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const banned = [/\bassets\//, /\btools\//, /palette\.json/, /manifest[\w.]*\.json/, /tien[-_ ]?nghich/i, /xianxia/i, /pixellab/i, /longtime/i,
  /hengyue/i, /blood[_-]?sea/i, /dong[_-]?phu/i, /\bbgm_|\bsfx_/, /preview-app/];

test('studio/audio sources hold no project-specific literals', async () => {
  const hits = [];
  for (const e of await fs.readdir(root, {withFileTypes: true})) {
    if (!e.isFile() || !e.name.endsWith('.mjs')) continue;
    (await fs.readFile(path.join(root, e.name), 'utf8')).split('\n').forEach((line, i) =>
      banned.forEach(re => re.test(line) && hits.push(`${e.name}:${i + 1} ${re} ${line.trim()}`)));
  }
  assert.deepEqual(hits, []);
});

test('studio/audio uses only node: built-ins and its own files, plus studio/core', async () => {
  const bad = [];
  for (const e of await fs.readdir(root, {withFileTypes: true})) {
    if (!e.isFile() || !e.name.endsWith('.mjs')) continue;
    const text = await fs.readFile(path.join(root, e.name), 'utf8');
    for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1];
      if (!(spec.startsWith('node:') || spec.startsWith('./') || /^\.\.\/core\/[\w.-]+\.mjs$/.test(spec))) bad.push(`${e.name}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
