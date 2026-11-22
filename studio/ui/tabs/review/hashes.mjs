// sha256 of project files, cached by path + size + mtime, so listing 46 masters every 10 s rehashes
// nothing unless a master actually changed. Each caller makes its own hasher so one big scan (the art
// approvals record covers hundreds of frames) cannot evict another's entries.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readInside } from '../../../core/files.mjs';

export function createHasher(maxEntries = 200) {
  const cache = new Map();
  const hasher = async (root, rel) => {
    const stat = await fs.stat(path.join(root, rel));
    const key = root + '\0' + rel;
    const hit = cache.get(key);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.sha256;
    const sha256 = createHash('sha256').update(await readInside(root, rel)).digest('hex');
    cache.set(key, {size: stat.size, mtimeMs: stat.mtimeMs, sha256});
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return sha256;
  };
  hasher.size = () => cache.size;
  return hasher;
}

export const hashOf = createHasher(200);
