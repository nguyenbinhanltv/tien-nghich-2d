// Pack a set (or one chunk of it) into a STAGING directory and say how it compares with the shipped atlas.
// Two ways to stage, both through code the pack registers or this studio ships, neither able to write a shipped directory:
//   studio     this studio's packer (atlas-sets.mjs): same layout algorithm, same JSON text, pixel-identical pages.
//   authority  the project's own packer, run through the registered adapter into the staging directory: byte for byte.
// Every run fingerprints the shipped atlas directories before and after, on success and on failure alike, and fails with `shipped_changed` if they moved.
import fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from './errors.mjs';
import { packSet, setDir, shippedPages, chunksOf, budgetOf, chunkSprites } from './atlas-sets.mjs';
import { compareDirs, compareFile, fingerprint, runAuthority, stagingFor, writeStaged } from './atlas-proof.mjs';
import { listFrames } from './assets.mjs';

const pageFile = /^atlas-\d+\.(png|json|array\.json)$/;

/** Names the studio packer can write for a set (page files, plus the set's summary file). */
const producedByStudio = set => name => pageFile.test(name) || name === set.chunks?.summaryFile;

const shippedDirs = pack => [...new Set(Object.values(pack.directories.atlases ?? {}))];

/** Budget of one packed profile (pages, bytes) against the chunk's design ceiling, when the set has one. */
function budgetFor(set, index, chunk, profileName, profile, pages, bytes) {
  const ceilings = index.info?.[set.design?.chunks ?? 'chunks'] ?? {};
  const mine = set.design?.profile === profileName && chunk && Number.isInteger(ceilings[chunk]) ? ceilings[chunk] : null;
  return budgetOf({pages, bytes, ceilingPages: mine, pageArea: profile.limit * profile.limit, bytesPerPixel: index.info?.[set.design?.from ?? set.design?.profile]?.bytes_per_pixel ?? 4});
}

/** Asset ids of a chunk that have processed frames: what the project's packer is asked to pack. */
async function processedIds(root, index, chunk) {
  const ids = [];
  for (const a of [...index.assets.values()].filter(x => x.chunk === chunk && x.layout).sort((p, q) => (p.id < q.id ? -1 : 1))) if ((await listFrames(root, a, 'processed')).frames.length) ids.push(a.id);
  return ids;
}

async function listFilesIn(dir) {
  const out = [];
  async function walk(abs, rel) {
    for (const e of await fs.readdir(abs, {withFileTypes: true}).catch(() => [])) {
      if (e.isDirectory()) await walk(path.join(abs, e.name), `${rel}${e.name}/`);
      else if (e.isFile()) out.push(`${rel}${e.name}`);
    }
  }
  await walk(dir, '');
  return out;
}

/**
 * Stage and compare. Options: {root, pack, index, set, chunk, engine: 'studio' | 'authority', base (library directory), check (also ask the
 * project's validator to accept the staged pages)}. Returns {engine, dir (absolute staging dir), profiles: {name: {...}}, check?, authority?, shipped: {unchanged, fingerprint}}.
 */
export async function stageAndProve({root, pack, index, set, chunk, engine = 'studio', base, check = false}) {
  if (!['studio', 'authority'].includes(engine)) throw problem(422, 'invalid_input', 'engine must be "studio" or "authority".');
  const chunked = set.layout.includes('{chunk}');
  if (chunked && !chunksOf(set, index).includes(chunk)) throw problem(404, 'unknown_chunk', `No chunk "${chunk}" in set ${set.id}.`);
  const dir = await stagingFor(root, pack, base, 'atlas-staging', set.id, chunked ? chunk : '_all', engine);
  const before = await fingerprint(root, shippedDirs(pack));
  const out = {engine, set: set.id, chunk: chunk ?? null, profiles: {}, dir};
  let failure = null;
  try {
    await fs.rm(dir, {recursive: true, force: true});
    await fs.mkdir(dir, {recursive: true});

    if (engine === 'studio') {
      const packed = await packSet(root, pack, index, set, {chunk});
      out.assets = packed.assets;
      for (const [name, p] of Object.entries(packed.profiles)) {
        const rel = setDir(pack, set, name, chunk).slice(pack.directories.atlases[set.atlases].length + 1);
        const stagedDir = path.join(dir, rel);
        await writeStaged(stagedDir, p.files);
        const comparison = await compareDirs(stagedDir, path.join(root, setDir(pack, set, name, chunk)), {producedBy: producedByStudio(set)});
        out.profiles[name] = {pages: p.pages, bytes: p.bytes, profile: p.profile, comparison, budget: budgetFor(set, index, chunk, name, p.profile, p.pages.length, p.bytes), dir: rel};
      }
      if (check) {
        if (!set.authority?.check) out.check = {ran: false, reason: 'The pack registers no validator for this set.'};
        else {
          // The validator reads the whole atlas directory (including files this studio does not write), so it checks a copy of the shipped one with the staged pages laid over it.
          const merged = path.join(dir, '_check');
          await fs.cp(path.join(root, pack.directories.atlases[set.atlases]), merged, {recursive: true});
          for (const rel of await listFilesIn(dir)) {
            if (rel.startsWith('_check/')) continue;
            await fs.mkdir(path.dirname(path.join(merged, rel)), {recursive: true});
            await fs.copyFile(path.join(dir, rel), path.join(merged, rel));
          }
          const r = await runAuthority(root, pack, set.authority.check, {out: merged});
          out.check = {ran: true, ok: r.ok, code: r.code, ms: r.ms, stdout: r.stdout, stderr: r.stderr};
          await fs.rm(merged, {recursive: true, force: true});
        }
      }
    } else {
      if (!set.authority?.build) throw problem(409, 'no_authority', `The pack registers no authority packer for set ${set.id}.`);
      const ids = chunked ? await processedIds(root, index, chunk) : [];
      if (chunked && !ids.length) throw problem(409, 'no_frames', `Chunk ${chunk} has no processed frames to pack.`);
      const r = await runAuthority(root, pack, set.authority.build, {out: dir, ids});
      out.authority = {ok: r.ok, code: r.code, ms: r.ms, timedOut: r.timedOut, stdout: r.stdout, stderr: r.stderr, ids};
      if (!r.ok) throw problem(502, 'authority_failed', `The project packer exited ${r.code}: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
      for (const name of set.profiles) {
        const rel = setDir(pack, set, name, chunk).slice(pack.directories.atlases[set.atlases].length + 1);
        const stagedDir = path.join(dir, rel);
        const comparison = await compareDirs(stagedDir, path.join(root, setDir(pack, set, name, chunk)), {producedBy: n => !n.startsWith('.')});
        const pages = (await shippedPagesOf(stagedDir)).pages;
        out.profiles[name] = {pages, bytes: null, comparison, dir: rel};
      }
    }
    // Files that live beside the profile directories (type declarations, runtime tables): only the project's packer writes them.
    out.extra = [];
    for (const name of set.extraFiles ?? []) {
      const shipped = await fs.readFile(path.join(root, pack.directories.atlases[set.atlases], name)).catch(() => null);
      const staged = engine === 'authority' ? await fs.readFile(path.join(dir, name)).catch(() => null) : null;
      out.extra.push(!shipped ? {name, status: 'absent'} : !staged ? {name, status: 'not_produced', reason: 'authority_only'} : compareFile(name, staged, shipped));
    }
  } catch (error) { failure = error; }
  // Whatever happened above, the shipped directories are checked last. A packer that wrote into them and then failed is reported as that, not as an ordinary failure.
  const after = await fingerprint(root, shippedDirs(pack));
  if (after !== before) throw problem(500, 'shipped_changed', `The shipped atlas directories (${shippedDirs(pack).join(', ')}) changed while staging${failure ? ` (the run also failed: ${failure.message})` : ''}. This must never happen; check them with git status before doing anything else.`);
  if (failure) throw failure;
  out.shipped = {unchanged: true, fingerprint: after.slice(0, 16), directories: shippedDirs(pack)};
  return out;
}

async function shippedPagesOf(stagedDir) {
  const names = (await fs.readdir(stagedDir).catch(() => [])).filter(n => /^atlas-\d+\.json$/.test(n));
  const pages = [];
  for (const n of names.sort()) { const d = JSON.parse(await fs.readFile(path.join(stagedDir, n), 'utf8')); pages.push({name: n.slice(0, -5), width: d.meta?.size?.w, height: d.meta?.size?.h, frames: Object.keys(d.frames ?? {}).length}); }
  return {pages};
}

/**
 * "What would change if the staged assets were packed": the chunk packed from processed frames only against the same chunk with the frames
 * studio agents submitted for assets that have no processed frames yet. Numbers only (no pages are drawn); each profile gets pages and
 * bytes before and after, and the budget state of the "after".
 */
export async function whatIf(root, pack, index, set, chunk) {
  const [now, next] = [await packSet(root, pack, index, set, {chunk, layoutOnly: true}).catch(e => (e.code === 'no_frames' ? null : Promise.reject(e))),
    await packSet(root, pack, index, set, {chunk, staged: true, layoutOnly: true}).catch(e => (e.code === 'no_frames' ? null : Promise.reject(e)))];
  const staged = Object.entries(next?.assets ?? {}).filter(([, v]) => v.stage === 'staged').map(([id, v]) => ({id, frames: v.frames}));
  const profiles = {};
  for (const name of set.profiles) {
    const a = now?.profiles[name], b = next?.profiles[name];
    profiles[name] = {before: a ? {pages: a.pages.length, bytes: a.bytes} : {pages: 0, bytes: 0}, after: b ? {pages: b.pages.length, bytes: b.bytes} : {pages: 0, bytes: 0},
      budget: b ? budgetFor(set, index, chunk, name, b.profile, b.pages.length, b.bytes) : null};
  }
  return {chunk: chunk ?? null, staged, frames: {before: now?.sprites.length ?? 0, after: next?.sprites.length ?? 0}, profiles};
}

/** Summary of a set's shipped pages per profile (and chunk): pages, frames, bytes, area and budget. */
export async function shippedSummary(root, pack, index, set, chunk) {
  const out = {};
  for (const name of set.profiles) {
    const {pages} = await shippedPages(root, pack, set, name, chunk);
    const bpp = index.info?.[set.design?.from ?? set.design?.profile]?.bytes_per_pixel ?? 4;
    const bytes = pages.reduce((n, p) => n + p.width * p.height * bpp, 0);
    const limit = pack.atlasProfiles?.[name]?.limit ?? 0;
    const sized = set.design?.profile === name ? (index.info?.[set.design.from ?? name]?.page?.[0] ?? limit) : limit;
    out[name] = {pages: pages.length, frames: pages.reduce((n, p) => n + p.frameCount, 0), bytes, bytesPerPixel: bpp,
      budget: budgetFor(set, index, chunk, name, {limit: sized}, pages.length, bytes), sizes: pages.map(p => [p.width, p.height])};
  }
  return out;
}

export { chunkSprites };
