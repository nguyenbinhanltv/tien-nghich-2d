// Thin adapter over studio/core: the project pack decides what is editable.
// The pack is the one that ships with this app; `root` is the project data directory, which
// may be a trimmed copy (the promotion tests), so only the files actually read must exist.
import { fileURLToPath } from 'node:url';
import { loadPack, loadEditableCatalog, problem } from '../../studio/core/index.mjs';

export { problem };

const packRoot = fileURLToPath(new URL('../../', import.meta.url));

export async function loadCatalog(root) {
  return loadEditableCatalog(await loadPack(packRoot, undefined, {verifyFiles: false}), root);
}
