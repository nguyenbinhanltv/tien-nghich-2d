// Write exports into an EXPORT STAGING directory (never a shipped atlas directory): describe the pages of one set, chunk and profile,
// run the chosen formats, write their files and copy the page images beside them.
import fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from '../errors.mjs';
import { readInside } from '../files.mjs';
import { decodeRgba } from '../png.mjs';
import { shippedPages, setDir } from '../atlas-sets.mjs';
import { stagingFor } from '../atlas-proof.mjs';
import { describeAtlas } from './describe.mjs';
import { formats, formatOf } from './index.mjs';

/** The neutral description of the shipped pages of a set (and chunk) at a profile. */
export async function describeShipped(root, pack, index, set, profile, chunk) {
  const {pages} = await shippedPages(root, pack, set, profile, chunk);
  if (!pages.length) throw problem(409, 'no_pages', `Set ${set.id}${chunk ? ` chunk ${chunk}` : ''} has no shipped ${profile} pages to export.`);
  const config = pack.ui?.tabs?.atlas?.export ?? {};
  return {desc: describeAtlas(index, pages, {name: chunk ?? set.id, tilesetCategories: config.tilesetCategories ?? []}), pages, config};
}

/**
 * Export into `base`/exports/<set>/<chunk>/<profile>/. Returns {dir, formats: [{id, files: [{name, bytes}], notes}]}.
 * `ids` picks formats (default all). The directory is emptied first, so it holds exactly this run.
 */
export async function exportAtlas({root, pack, index, set, profile, chunk, ids, base}) {
  const wanted = ids?.length ? ids : formats.map(f => f.id);
  for (const id of wanted) if (!formatOf(id)) throw problem(422, 'invalid_input', `Unknown export format "${id}". Formats: ${formats.map(f => f.id).join(', ')}.`);
  const {desc, pages, config} = await describeShipped(root, pack, index, set, profile, chunk);
  const dir = await stagingFor(root, pack, base, 'exports', set.id, chunk ?? '_all', profile);
  await fs.rm(dir, {recursive: true, force: true});
  const cache = new Map();
  const readPage = async i => { if (!cache.has(i)) cache.set(i, decodeRgba(await readInside(root, pages.find(p => p.index === i).png))); return cache.get(i); };
  const out = {dir, set: set.id, chunk: chunk ?? null, profile, summary: {pages: desc.pages.length, frames: desc.frames.length, clips: desc.clips.length, tilesets: desc.tilesets.length}, formats: []};
  for (const id of wanted) {
    const format = formatOf(id);
    const built = await format.build(desc, {name: desc.name, readPage, pixelsPerUnit: config.pixelsPerUnit});
    const written = [];
    for (const f of built.files) { const file = path.join(dir, f.name); await fs.mkdir(path.dirname(file), {recursive: true}); await fs.writeFile(file, f.data); written.push({name: f.name, bytes: f.data.length}); }
    for (const c of built.copies) { const file = path.join(dir, c.name); await fs.mkdir(path.dirname(file), {recursive: true}); await fs.copyFile(path.join(root, pages.find(p => p.index === c.page).png), file); written.push({name: c.name, bytes: (await fs.stat(file)).size}); }
    out.formats.push({id, label: format.label, files: written, notes: built.notes});
  }
  return out;
}
