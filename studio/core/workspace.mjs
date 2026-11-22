// A workspace is one project directory opened for the studio tools: its pack, palette, asset index,
// revision store and Studio database. Cheap data (pack, palette, index) is re-read on every call so a
// long-lived server never serves stale facts; the two SQLite handles are opened lazily and kept.
import fs from 'node:fs';
import path from 'node:path';
import { loadPackSync, parsePalette } from './pack.mjs';
import { readJson } from './files.mjs';

/**
 * `indexer(pack, root)` is the project adapter: it returns the asset index (see assets.mjs for the
 * record contract). The core has no default, because the core knows no project's conventions.
 */
export function openWorkspace(rootArg, {libraryDir, indexer} = {}) {
  if (typeof indexer !== 'function') throw new Error('openWorkspace needs an indexer');
  const root = fs.realpathSync(rootArg);
  const loadPack = () => loadPackSync(root, undefined, {verifyFiles: false});
  const library = () => libraryDir ?? path.join(root, loadPack().directories.revisions);
  let store, db, standing, standingKey;
  return {
    root,
    loadPack,
    libraryDir: library,
    /** Pack, parsed palette ({colors:Set, outline}), raw palette file and a fresh asset index. */
    async snapshot() {
      const pack = loadPack();
      const paletteFile = await readJson(root, pack.palette.file);
      return {pack, palette: parsePalette(paletteFile), paletteFile, index: await indexer(pack, root)};
    },
    async store() {
      if (!store) {
        const {revisionStore} = await import('./store.mjs');
        const pack = loadPack();
        store = revisionStore(root, pack.directories.revisions, library());
      }
      return store;
    },
    /** Resolver for the review standing of frames nobody judged in the revision store (standing.mjs). Rebuilt if the pack's declaration changes. */
    async standing() {
      const pack = loadPack();
      const key = JSON.stringify([pack.review ?? null, pack.directories.approvals ?? null]);
      if (!standing || key !== standingKey) {
        const {createStanding} = await import('./standing.mjs');
        standing = createStanding(root, {review: pack.review, approvalsDir: pack.directories.approvals});
        standingKey = key;
      }
      return standing;
    },
    async db() {
      if (!db) {
        const {openStudioDb} = await import('./studio-db.mjs');
        db = openStudioDb(library());
      }
      return db;
    },
    close() { store?.close(); db?.close(); store = db = standing = undefined; },
  };
}
