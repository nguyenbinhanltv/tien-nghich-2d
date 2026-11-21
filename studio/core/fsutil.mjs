// Small, careful file helpers shared by the authoring modules: contained paths, atomic writes,
// an in-process mutex per file, content hashes.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from './errors.mjs';

export const sha256 = data => createHash('sha256').update(data).digest('hex');

/** A project-relative path that stays inside the project: no drive, no "..", no empty or dot parts. */
export function isContained(rel) {
  return typeof rel === 'string' && rel.length > 0 && rel.length < 400 && !path.isAbsolute(rel) && !/^[A-Za-z]:|\\|\0/.test(rel) &&
    rel.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Resolve `rel` under `root`, refusing anything that is not contained (before touching the disk). */
export function containedPath(root, rel) {
  if (!isContained(rel)) throw problem(422, 'invalid_path', `Not a project-relative path: ${JSON.stringify(rel)}`);
  return path.join(root, rel);
}

/**
 * Create `rel`'s directory (and parents) and confirm the real directory is still inside the real
 * root, so a symlinked component cannot redirect a write outside the project.
 */
export async function ensureDirInside(root, relDir) {
  const abs = containedPath(root, relDir);
  await fs.mkdir(abs, {recursive: true});
  const real = await fs.realpath(abs);
  const rel = path.relative(root, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw problem(403, 'outside_project', `${relDir} resolves outside the project`);
  return real;
}

const locks = new Map();
/** Run `fn` after every earlier call with the same key has settled (one writer at a time per file). */
export function withLock(key, fn) {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(key, tail);
  tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
  return run;
}

/** Write via a temp file in the same directory and rename, so readers never see half a file. */
export async function writeFileAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, text, {flag: 'wx', mode: 0o644});
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, {force: true});
    throw error;
  }
}

export async function readTextIfExists(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export const yieldToLoop = () => new Promise(resolve => setImmediate(resolve));
