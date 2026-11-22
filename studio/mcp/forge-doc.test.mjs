import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDoc, updateDoc } from './workflow/forge.mjs';

test('concurrent edits of different fields of the process document both survive', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'forge-doc-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const ws = {root}, asset = {layout: {rawDir: 'raw/x'}};
  for (let i = 0; i < 25; i++) {
    await fs.rm(path.join(root, 'raw/x/forge/process.json'), {force: true});
    await Promise.all([
      updateDoc(ws, asset, 'process', d => ({...(d ?? {marks: []}), marks: [{color: `m${i}`}]})),
      updateDoc(ws, asset, 'process', d => ({...(d ?? {marks: []}), hold: false})),
    ]);
    const doc = await readDoc(ws, asset, 'process');
    assert.deepEqual(doc.marks, [{color: `m${i}`}], 'marks kept');
    assert.equal(doc.hold, false, 'hold kept');
  }
});
