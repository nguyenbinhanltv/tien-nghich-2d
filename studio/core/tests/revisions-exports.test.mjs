// Every name any module of the repo imports from core/revisions.mjs must be exported by it, and saveRevision keeps its contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as revisions from '../revisions.mjs';
import { connect, makeFrame, makeProject, PROVENANCE, clipFrames } from '../../mcp/testkit.mjs';
import { bareFrame } from '../review.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function* sources(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'tools', '.inspector-revisions'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (e.name.endsWith('.mjs')) yield p;
  }
}

test('every name imported from core/revisions.mjs anywhere in the repo is exported', () => {
  const wanted = new Map();
  const target = path.join(ROOT, 'studio', 'core', 'revisions.mjs');
  const dirs = ['studio', 'playables'].map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d));
  for (const file of dirs.flatMap((d) => [...sources(d)])) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      if (!m[2].startsWith('.') || path.resolve(path.dirname(file), m[2]) !== target) continue;
      for (const part of m[1].split(',').map((x) => x.trim()).filter(Boolean)) wanted.set(part.split(/\s+as\s+/)[0], path.relative(ROOT, file));
    }
  }
  assert.ok(wanted.size >= 2, 'the scan found the importers');
  for (const [name, from] of wanted) assert.equal(typeof revisions[name], 'function', `${from} imports ${name} from core/revisions.mjs, which does not export it`);
  for (const name of ['saveRevision', 'saveRevisions', 'headPng']) assert.equal(typeof revisions[name], 'function', `${name} stays exported`);
});

test('saveRevision keeps its one-frame contract on top of the transaction', async () => {
  const p = makeProject({ git: false });
  try {
    const a = connect(p.root);
    await a.ok('studio_frames_submit', { assetId: 'lt_seed_broker', provenance: PROVENANCE, frames: clipFrames('idle', 'south', 1) });
    const baseline = makeFrame(32, 32, { variant: 0 }).png, png = makeFrame(32, 32, { variant: 4 }).png;
    const ws = a.project.workspace;
    const key = 'longtime/lt_seed_broker/idle_south_0';
    const r = await revisions.saveRevision(ws, { key, baseline, png });
    assert.deepEqual([r.revision, r.changed, r.status, r.previous], [1, true, 'pending', 0]);
    assert.equal((await revisions.saveRevision(ws, { key, baseline, png })).changed, false, 'the same pixels are not a new revision');
    await assert.rejects(revisions.saveRevision(ws, { key, baseline, png: makeFrame(32, 32, { variant: 5 }).png, baseRevision: 0 }), /Reload the current revision/);
    assert.deepEqual(await revisions.saveRevisions(ws, []), []);
    assert.equal((await ws.store()).operate(bareFrame(key), baseline, 'frame', {}).head, 1);
  } finally { await p.cleanup(); }
});
