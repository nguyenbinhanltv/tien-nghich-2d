import fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from './errors.mjs';

/** Read a project file by relative path, refusing anything whose real path leaves `root`. */
export async function readInside(root, relative) {
  const real = await fs.realpath(path.join(root, relative));
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw problem(500, 'catalog_error', 'Catalog input is outside the library');
  }
  return fs.readFile(real);
}

export async function readJson(root, relative) {
  return JSON.parse(await readInside(root, relative));
}
