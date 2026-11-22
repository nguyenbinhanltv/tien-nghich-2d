// Thin adapter over studio/core: the project pack decides what is editable.
// The pack is the one that ships with this app; `root` is the project data directory, which
// may be a trimmed copy (the promotion tests), so only the files actually read must exist.
import { fileURLToPath } from 'node:url';
import { loadPack, loadEditableCatalog, problem } from '../../studio/core/index.mjs';

export { problem };

export const packRoot = fileURLToPath(new URL('../../', import.meta.url));

export async function loadCatalog(root, packDir = packRoot) {
  return loadEditableCatalog(await loadPack(packDir, undefined, {verifyFiles: false}), root);
}
