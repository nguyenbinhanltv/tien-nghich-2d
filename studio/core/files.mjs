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

/** Recursively list files under a project directory (relative paths, sorted); [] if it is missing. */
export async function walkFiles(root, relativeDir, accept = () => true) {
  const out = [];
  async function visit(rel) {
    let entries;
    try { entries = await fs.readdir(path.join(root, rel), {withFileTypes: true}); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel + '/' + entry.name;
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && accept(child)) out.push(child);
    }
  }
  await visit(relativeDir.replace(/\/+$/, ''));
  return out;
}

export async function readJsonIfExists(root, relative) {
  try { return await readJson(root, relative); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
