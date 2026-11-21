import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveMarks, readImport, writeImport, writePixelized, createImage } from '../index.mjs';

const palette = {colors: [{id: 'a', hex: '#101010', rgb: [16, 16, 16]}, {id: 'm', hex: '#ffe066', rgb: [255, 224, 102]}]};

test('marks must be palette colours and need a valid minRgb', () => {
  assert.deepEqual(resolveMarks([{color: '#FFE066', minRgb: [1, 2, 3]}], palette)[0].id, 'm');
  assert.throws(() => resolveMarks([{color: '#123456', minRgb: [1, 2, 3]}], palette), /not in the palette/);
  assert.throws(() => resolveMarks([{color: 'zz', minRgb: [1, 2, 3]}], palette), /not in the palette/);
  for (const minRgb of [undefined, [0, 0], [0, 0, 256], [0, 0, 1.5]])
    assert.throws(() => resolveMarks([{color: 'm', minRgb}], palette), /minRgb/);
});

test('crafted ids and crop paths are rejected on read and write', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-hard-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const record = (id, crop) => ({schema: 'forge.sheet-import', cells: [{id, crop}], prompt: {text: ''}});
  await fs.mkdir(path.join(dir, 'cells'));
  for (const [id, crop] of [['a', '../../x'], ['../x', 'cells/../x.png'], ['A', 'cells/A.png']]) {
    await fs.writeFile(path.join(dir, 'import.json'), JSON.stringify(record(id, crop)));
    await assert.rejects(readImport(dir));
  }
  const bad = new Map([['../evil', createImage(1, 1)]]);
  await assert.rejects(writeImport(path.join(dir, 'o'), {record: record('x', 'y'), cells: bad, layout: {}}), /invalid cell id/);
  await assert.rejects(writePixelized(path.join(dir, 'p'), {cells: new Map([['../evil', {native: createImage(1, 1)}]]), record: {}}), /invalid cell id/);
});
