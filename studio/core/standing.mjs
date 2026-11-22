// Review standing of a frame that no one has judged inside the studio's revision store: the three honest states.
//
//   approved   a human record exists for exactly these bytes: an entry in the project's hash-tied approvals record
//              (art_approvals.json in the pack's directories.approvals) whose sha256 equals the file's. A human sign-off
//              inside the revision store is not decided here; the store keeps it and it wins over everything below.
//   baseline   shipped art that predates the studio and has no review record either way. The pack names it with
//              `review.baseline`: a record file that holds, for each frame directory, a digest of the directory's PNG
//              names and sha256s. A frame is baseline only while its directory still digests to the recorded value, so a
//              new frame, a removed frame or one changed byte takes the whole directory out of the baseline.
//   awaiting   everything else. This is the default whenever nothing above says otherwise.
//
// Nothing here writes anything and nothing here is reachable as a way to approve: the approvals record is a tracked
// file a human's statement is transcribed into, and the baseline record is produced by the command in studio/baseline.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readInside, readJsonIfExists } from './files.mjs';
import { decodeRgba } from './png.mjs';

/** Do two PNGs show the same pixels? (A stored revision 0 is a normalized copy of the file, so bytes cannot be compared.) */
export function sameImage(a, b) {
  if (!a || !b) return false;
  try {
    const x = decodeRgba(Buffer.from(a)), y = decodeRgba(Buffer.from(b));
    return x.width === y.width && x.height === y.height && Buffer.from(x.pixels).equals(Buffer.from(y.pixels));
  } catch { return false; }
}

export const STANDINGS = ['approved', 'baseline', 'awaiting'];
export const ART_APPROVALS_FILE = 'art_approvals.json';
const SHA = /^[0-9a-f]{64}$/;
const safeRel = v => typeof v === 'string' && v.length < 300 && !v.startsWith('/') && !v.includes('..') && !v.includes('\\');

/** Map of project-relative PNG path to the sha256 a human approved, from an approvals record; malformed parts are ignored. */
export function approvedPaths(data) {
  const out = new Map();
  for (const a of Array.isArray(data?.approvals) ? data.approvals : []) {
    if (typeof a?.id !== 'string' || typeof a?.approved_by !== 'string' || !a.assets || typeof a.assets !== 'object') continue;
    for (const info of Object.values(a.assets)) {
      if (!safeRel(info?.frame_dir)) continue;
      for (const [key, sha] of Object.entries(info.frames ?? {})) {
        if (typeof sha === 'string' && SHA.test(sha)) out.set(`${info.frame_dir}/${key.split('/').at(-1)}.png`, sha);
      }
    }
  }
  return out;
}

/** The digest a baseline record stores for one directory: sha256 over the sorted lines `<name>\0<file sha256>\n`. */
export function directoryDigest(entries) {
  const h = createHash('sha256');
  for (const [name, sha] of [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(`${name}\0${sha}\n`);
  return h.digest('hex');
}

/** {directory: digest} from a baseline record; malformed parts are ignored. */
export function baselineDirectories(data) {
  const out = new Map();
  if (data && typeof data === 'object' && data.directories && typeof data.directories === 'object') {
    for (const [dir, digest] of Object.entries(data.directories)) if (safeRel(dir) && typeof digest === 'string' && SHA.test(digest)) out.set(dir, digest);
  }
  return out;
}

/** Project-relative directories that hold at least one PNG, under the given roots (symlinks are not followed). */
export async function pngDirectories(root, roots) {
  const out = [];
  const visit = async rel => {
    let entries;
    try { entries = await fs.readdir(path.join(root, rel), {withFileTypes: true}); } catch { return; }
    if (entries.some(e => e.isFile() && e.name.endsWith('.png'))) out.push(rel);
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) if (e.isDirectory()) await visit(`${rel}/${e.name}`);
  };
  for (const r of roots) await visit(r.replace(/\/+$/, ''));
  return out;
}

/**
 * Standing resolver for one project. `declaration` is the pack's `review` block ({baseline: {file, roots}}) or undefined;
 * `approvalsDir` is the pack's directories.approvals or undefined. Files are re-checked by size and mtime on every call,
 * so a long-lived server never reports a stale standing.
 */
export function createStanding(rootArg, {review, approvalsDir} = {}) {
  const root = realpathSync(rootArg); // contained reads compare real paths
  const fileSha = new Map();   // rel -> {size, mtimeMs, sha}
  const dirCache = new Map();  // dir -> {signature, digest}
  const records = new Map();   // rel -> {stamp, value}

  async function sha(rel) {
    const stat = await fs.stat(path.join(root, rel));
    const hit = fileSha.get(rel);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.sha;
    const value = createHash('sha256').update(await readInside(root, rel)).digest('hex');
    fileSha.set(rel, {size: stat.size, mtimeMs: stat.mtimeMs, sha: value});
    return value;
  }

  async function record(rel, parse) {
    let stamp = 'none';
    try { const s = await fs.stat(path.join(root, rel)); stamp = `${s.size}:${s.mtimeMs}`; } catch { /* no record */ }
    const hit = records.get(rel);
    if (hit && hit.stamp === stamp) return hit.value;
    const value = stamp === 'none' ? parse(null) : parse(await readJsonIfExists(root, rel).catch(() => null));
    records.set(rel, {stamp, value});
    return value;
  }

  const approvals = () => (approvalsDir ? record(`${approvalsDir.replace(/\/+$/, '')}/${ART_APPROVALS_FILE}`, approvedPaths) : new Map());
  const baseline = () => (review?.baseline?.file ? record(review.baseline.file, baselineDirectories) : new Map());

  /** Digest of a directory's PNGs now, or null when the directory cannot be read. */
  async function digestOf(dir) {
    let names;
    try { names = (await fs.readdir(path.join(root, dir), {withFileTypes: true})).filter(e => e.isFile() && e.name.endsWith('.png')).map(e => e.name).sort(); }
    catch { return null; }
    const stats = await Promise.all(names.map(n => fs.stat(path.join(root, dir, n))));
    const signature = names.map((n, i) => `${n}:${stats[i].size}:${stats[i].mtimeMs}`).join('|');
    const hit = dirCache.get(dir);
    if (hit && hit.signature === signature) return hit.digest;
    const digest = directoryDigest(await Promise.all(names.map(async n => [n, await sha(`${dir}/${n}`)])));
    dirCache.set(dir, {signature, digest});
    return digest;
  }

  /** 'approved' | 'baseline' | 'awaiting' for the PNG at a project-relative path, judged on its bytes now. `digests` memoizes directory digests within one bulk pass. */
  async function of(rel, digests) {
    if (typeof rel !== 'string' || !safeRel(rel)) return 'awaiting';
    const approved = (await approvals()).get(rel);
    if (approved) {
      const now = await sha(rel).catch(() => null);
      if (now === approved) return 'approved';
    }
    const dir = path.posix.dirname(rel);
    const recorded = (await baseline()).get(dir);
    if (!recorded) return 'awaiting';
    let digest = digests?.get(dir);
    if (digest === undefined) { digest = await digestOf(dir); digests?.set(dir, digest); }
    return digest === recorded ? 'baseline' : 'awaiting';
  }

  /** {standing, png}: the standing and, when it is approved or baseline, the exact file bytes it was judged on. A stored revision only inherits the standing if it shows these pixels. */
  async function judged(rel) {
    const standing = await of(rel);
    if (standing === 'awaiting') return {standing, png: null};
    return {standing, png: await readInside(root, rel).catch(() => null)};
  }

  /** Standing of many files at once: [rel, standing] pairs. Each directory is digested once, so counting a whole project stays cheap. */
  async function ofMany(rels) {
    const digests = new Map();
    const out = [];
    for (const rel of rels) out.push([rel, await of(rel, digests)]);
    return out;
  }

  return {of, ofMany, judged, declared: Boolean(review?.baseline?.file), approvalsDir: approvalsDir ?? null};
}

/** The record the pack's `review.baseline.file` should hold today: every PNG directory under the pack's roots. */
export async function buildBaselineRecord(rootArg, review) {
  const root = realpathSync(rootArg);
  const dirs = await pngDirectories(root, review?.baseline?.roots ?? []);
  const directories = {};
  for (const dir of dirs) {
    const names = (await fs.readdir(path.join(root, dir), {withFileTypes: true})).filter(e => e.isFile() && e.name.endsWith('.png')).map(e => e.name);
    const entries = [];
    for (const n of names) entries.push([n, createHash('sha256').update(await readInside(root, `${dir}/${n}`)).digest('hex')]);
    directories[dir] = directoryDigest(entries);
  }
  return {directories};
}

/** Count standings of a list of {rel} frames: {approved, baseline, awaiting, total}. */
export async function tallyStandings(standing, rels) {
  const out = {approved: 0, baseline: 0, awaiting: 0, total: 0};
  for (const [, s] of await standing.ofMany(rels)) { out[s]++; out.total++; }
  return out;
}
