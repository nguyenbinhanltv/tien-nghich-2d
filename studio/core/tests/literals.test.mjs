// The core must stay project-agnostic: no Tien Nghich path or ID literal inside studio/core/.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../', import.meta.url));
const banned = [
  /\bassets\//, /\btools\//, /palette\.json/, /manifest[\w.]*\.json/, /vfx_index/, /approved-frames/,
  /inspector-revisions/, /preview-app/, /tien[-_ ]?nghich/i, /xianxia/i, /pixellab/i, /longtime/i,
  /hengyue/i, /blood[_-]?sea/i, /\bui_[a-z]+/, /hit_spark/, /\bbgm_|\bsfx_/, /#14101a/i
];

test('studio/core has no project-specific literals', async () => {
  const files = (await fs.readdir(dir, {withFileTypes: true})).filter(e => e.isFile() && e.name.endsWith('.mjs'));
  assert.ok(files.length >= 8);
  const hits = [];
  for (const file of files) {
    const lines = (await fs.readFile(dir + file.name, 'utf8')).split('\n');
    lines.forEach((line, i) => banned.forEach(re => re.test(line) && hits.push(`${file.name}:${i + 1} ${re} ${line.trim()}`)));
  }
  assert.deepEqual(hits, []);
});
