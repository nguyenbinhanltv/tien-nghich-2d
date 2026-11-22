// Thin adapter over studio/core: the project pack decides what is editable.
// The pack is the one that ships with this app; `root` is the project data directory, which
// may be a trimmed copy (the promotion tests), so only the files actually read must exist.
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { loadPack, loadEditableCatalog, createStanding, problem } from '../../studio/core/index.mjs';

export { problem };

export const packRoot = fileURLToPath(new URL('../../', import.meta.url));

export async function loadCatalog(root, packDir = packRoot) {
  return loadEditableCatalog(await loadPack(packDir, undefined, {verifyFiles: false}), root);
}

/** Review standing resolver for the project data directory: which frames a human record or the pack's baseline covers. */
export async function loadStanding(root, packDir = packRoot) {
  const pack = await loadPack(packDir, undefined, {verifyFiles: false});
  return createStanding(await fs.realpath(root), {review: pack.review, approvalsDir: pack.directories.approvals});
}
