// Thin adapter over studio/core: the default in-repo library name comes from the project pack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPackSync } from '../../studio/core/index.mjs';
import { revisionStore as coreStore } from '../../studio/core/store.mjs';

const packRoot = fileURLToPath(new URL('../../', import.meta.url));
export function revisionStore(root, dir, packDir = packRoot) {
  const reserved = loadPackSync(packDir, undefined, {verifyFiles: false}).directories.revisions;
  return coreStore(root, reserved, dir ?? path.join(root, reserved));
}
