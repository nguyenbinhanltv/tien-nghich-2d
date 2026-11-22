// Project-side hook named by the pack (serve.hooks): the live asset index the playables read.
// GET /__preview_index.json lists the delivered atlases, processed and raw PNGs and dev fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';

async function walkFiles(root, relDir, predicate) {
  const results = [];
  async function visit(dir) {
    let entries;
    try { entries = await fs.readdir(dir, {withFileTypes: true}); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await visit(full);
      else if (ent.isFile()) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (!predicate || predicate(rel)) results.push(rel);
      }
    }
  }
  await visit(path.join(root, relDir));
  return results.sort();
}

export async function buildPreviewIndex({root, pack}) {
  const DIRS = pack.directories;
  const [atlases, processedPngs, rawEnvironmentPngs, rawCharacterPngs, processedJsons, rawEnvJsons, fixtureAtlases, fixturePngs] = await Promise.all([
    walkFiles(root, DIRS.atlases.core + '/web', f => /atlas-\d+\.json$/.test(f)),
    walkFiles(root, DIRS.processed.core, f => f.endsWith('.png')),
    walkFiles(root, DIRS.raw.environment, f => f.endsWith('.png')),
    walkFiles(root, DIRS.raw.characters, f => f.endsWith('.png')),
    walkFiles(root, DIRS.processed.core, f => /(bitmask|blob47|autotile).*\.json$/i.test(f)),
    walkFiles(root, DIRS.raw.environment, f => /(bitmask|blob47|autotile).*\.json$/i.test(f)),
    walkFiles(root, DIRS.fixtures.atlases, f => f.endsWith('.json')),
    walkFiles(root, DIRS.fixtures.pngs, f => f.endsWith('.png')),
  ]);
  return {generatedAt: new Date().toISOString(), repoRoot: path.basename(root), atlases, processedPngs, rawEnvironmentPngs,
    rawCharacterPngs, bitmaskJsons: [...processedJsons, ...rawEnvJsons], fixtureAtlases, fixturePngs};
}

/** The hook contract: handle(req, res, {root, pack}) answers the request. */
export async function handle(req, res, {root, pack}) {
  res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(await buildPreviewIndex({root, pack}), null, 2));
}
