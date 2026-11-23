#!/usr/bin/env node
// Write or check the pack's accepted-baseline record (pack block `review.baseline`).
//
//   node studio/baseline.mjs --check   report how many baseline directories still match (exit 1 when any do not)
//   node studio/baseline.mjs --write   (re)write the record from the PNG directories under review.baseline.roots
//
// --write is a deliberate act: it declares the art as it stands NOW to be shipped legacy art with no review record. Run it only
// when freezing a project's baseline for the first time; new art added later must stay "awaiting review", so never re-run it to
// make awaiting art look settled. It never approves anything: baseline is not approved.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPack } from './core/pack.mjs';
import { buildBaselineRecord, baselineDirectories, baselineSetAside, createStanding } from './core/standing.mjs';

const at = process.argv.indexOf('--project'), joined = process.argv.find(a => a.startsWith('--project='));
const root = joined ? path.resolve(joined.slice('--project='.length)) : at > 0 ? path.resolve(process.argv[at + 1]) : path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const mode = process.argv.slice(2).find(a => a === '--write' || a === '--check');
if (!['--write', '--check'].includes(mode)) { console.error('Usage: node studio/baseline.mjs [--project <dir>] --check | --write'); process.exit(2); }
const pack = await loadPack(root, undefined, {verifyFiles: false});
const declared = pack.review?.baseline;
if (!declared) { console.log('The pack declares no review.baseline: every frame without a human record reads as awaiting review.'); process.exit(0); }
const file = path.join(root, declared.file);
if (mode === '--write') {
  const record = await buildBaselineRecord(root, pack.review);
  const body = {schema_version: 1,
    description: 'Accepted baseline: shipped art that predates the studio and has no review record either way. Per frame directory, a digest of its PNG names and sha256s; a directory whose digest no longer matches (a frame added, removed or changed) is awaiting review. `set_aside`: name prefixes of files added to a shared directory after the freeze; they are outside its digest and always awaiting. This is NOT an approval. Written by `node studio/baseline.mjs --write`.',
    roots: declared.roots, directories: record.directories, ...(Object.keys(record.set_aside).length ? {set_aside: record.set_aside} : {})};
  await fs.mkdir(path.dirname(file), {recursive: true});
  await fs.writeFile(file, JSON.stringify(body, null, 1) + '\n');
  console.log(`Wrote ${Object.keys(record.directories).length} baseline directories to ${declared.file}`);
} else {
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  const recorded = baselineDirectories(data), aside = baselineSetAside(data);
  const standing = createStanding(root, {review: pack.review});
  let bad = 0;
  for (const [dir] of recorded) {
    const names = (await fs.readdir(path.join(root, dir)).catch(() => [])).filter(n => n.endsWith('.png') && !(aside.get(dir) ?? []).some(p => n.startsWith(p)));
    if (!names.length || (await standing.of(`${dir}/${names[0]}`)) !== 'baseline') { bad++; console.log('changed or gone: ' + dir); }
  }
  console.log(`${recorded.size - bad} of ${recorded.size} baseline directories still match`);
  process.exit(bad ? 1 : 0);
}
