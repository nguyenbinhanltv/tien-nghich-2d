// The user-level project list of Pixel Kiln: which projects this person opened lately. It lives in the
// user's own config directory, never inside a project or the repo, and `PIXEL_KILN_HOME` overrides the
// location (tests use it so they never touch the real machine).
//   macOS    ~/Library/Application Support/Pixel Kiln
//   Windows  %APPDATA%\Pixel Kiln
//   other    $XDG_CONFIG_HOME/pixel-kiln, else ~/.config/pixel-kiln
// The list holds only paths and names. Removing a project from it never deletes a file of the project.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { problem } from './errors.mjs';
import { withLock, writeFileAtomic } from './fsutil.mjs';
import { loadPack, packFileName } from './pack.mjs';

export const REGISTRY_SCHEMA = 'pixel-kiln.projects';
export const MAX_PROJECTS = 200;
const MAX_PATH = 1024;
const MAX_PACK_BYTES = 2 * 1024 * 1024;

/** The directory of the user's Pixel Kiln settings. `env`, `platform` and `home` are injectable for tests. */
export function pixelKilnHome({env = process.env, platform = process.platform, home = os.homedir()} = {}) {
  if (env.PIXEL_KILN_HOME) {
    if (!path.isAbsolute(env.PIXEL_KILN_HOME)) throw new Error('PIXEL_KILN_HOME must be an absolute path');
    return path.resolve(env.PIXEL_KILN_HOME);
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Pixel Kiln');
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Pixel Kiln');
  return path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'pixel-kiln');
}

/**
 * Turn what a person typed into one absolute, normalised path, or refuse it before the disk is touched.
 * `strict` (the browser) also refuses a relative path and any ".." part: a typed path must say where it goes.
 */
export function normalizeProjectPath(input, {strict = true, cwd = process.cwd(), home = os.homedir()} = {}) {
  if (typeof input !== 'string' || !input.trim()) throw problem(422, 'invalid_path', 'Give the path of a project folder');
  let text = input.trim();
  if (text.length > MAX_PATH) throw problem(422, 'invalid_path', 'That path is too long');
  if (/[\u0000-\u001f\u007f]/.test(text)) throw problem(422, 'invalid_path', 'That path has control characters');
  if (text === '~' || text.startsWith('~/') || text.startsWith('~\\')) text = path.join(home, text.slice(1));
  if (strict) {
    if (!path.isAbsolute(text)) throw problem(422, 'path_not_absolute', 'Type the full path, starting from the root of the disk');
    if (text.split(/[\\/]/).includes('..')) throw problem(422, 'invalid_path', 'A path with ".." is not accepted; type the real path');
  }
  return path.resolve(cwd, text);
}

/**
 * Check that `dirArg` is a Pixel Kiln project: a real directory with a valid `studio.project.json` at its root.
 * Returns {root, pack}; otherwise throws a problem whose `code` says what is wrong (`issues` lists the schema errors).
 * Only the pack is read; the files it names are not (a project may be half-built).
 */
export async function inspectProject(dirArg, options) {
  const wanted = normalizeProjectPath(dirArg, options);
  let root;
  try { root = await fs.realpath(wanted); }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw problem(404, 'not_found', 'There is no folder at that path');
    throw problem(403, 'unreadable', 'That folder cannot be read');
  }
  if (!(await fs.stat(root)).isDirectory()) throw problem(422, 'not_a_directory', 'That path is a file, not a folder');
  const packFile = path.join(root, packFileName);
  let real;
  try {
    real = await fs.realpath(packFile);
    const rel = path.relative(root, real);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw problem(403, 'outside_project', `${packFileName} leads outside the folder`);
    const stat = await fs.stat(real);
    if (!stat.isFile()) throw problem(422, 'no_pack', `${packFileName} is not a file`);
    if (stat.size > MAX_PACK_BYTES) throw problem(422, 'invalid_pack', `${packFileName} is too large to be a project pack`);
  } catch (error) {
    if (error.code === 'ENOENT') throw problem(422, 'no_pack', `This folder has no ${packFileName}, so it is not a Pixel Kiln project`);
    throw error;
  }
  try { return {root, pack: await loadPack(root, undefined, {verifyFiles: false})}; }
  catch (error) {
    if (error.code === 'invalid_pack') throw Object.assign(problem(422, 'invalid_pack', `${packFileName} does not match the project schema`), {issues: error.issues});
    if (error instanceof SyntaxError) throw problem(422, 'invalid_pack', `${packFileName} is not valid JSON`);
    throw error;
  }
}

/** A project's stable id in the list: derived from its real path, so adding the same folder twice finds the same entry. */
export const projectIdOf = root => 'p_' + createHash('sha256').update(root).digest('hex').slice(0, 10);

const clean = (text, max) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

/** The list: `home` is the settings directory. Methods never throw for a corrupt file; they start from an empty list. */
export function createRegistry({home = pixelKilnHome(), now = () => new Date()} = {}) {
  const file = path.join(home, 'projects.json');
  async function read() {
    let data;
    try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return []; }
    if (data?.schema !== REGISTRY_SCHEMA || !Array.isArray(data.projects)) return [];
    return data.projects.filter(p => p && typeof p.id === 'string' && typeof p.path === 'string' && path.isAbsolute(p.path))
      .map(p => ({id: p.id, path: p.path, name: clean(p.name, 120), addedAt: clean(p.addedAt, 40), lastOpened: p.lastOpened ? clean(p.lastOpened, 40) : null}));
  }
  async function write(projects) {
    await fs.mkdir(home, {recursive: true, mode: 0o700});
    await writeFileAtomic(file, JSON.stringify({schema: REGISTRY_SCHEMA, version: 1, projects}, null, 2) + '\n');
  }
  const order = list => [...list].sort((a, b) => (b.lastOpened ?? b.addedAt).localeCompare(a.lastOpened ?? a.addedAt));
  const update = fn => withLock(file, async () => { const next = await fn(await read()); await write(next.slice(0, MAX_PROJECTS)); return next; });
  return {
    home, file,
    async list() { return order(await read()); },
    async get(id) { return (await read()).find(p => p.id === id) ?? null; },
    /** Add (or refresh the name of) a project that `inspectProject` accepted. `opened` also stamps the time it was opened. */
    async add({root, name}, {opened = false} = {}) {
      const id = projectIdOf(root), stamp = now().toISOString();
      let entry;
      await update(list => {
        const found = list.find(p => p.id === id);
        entry = found ?? {id, path: root, name: clean(name, 120), addedAt: stamp, lastOpened: null};
        entry.name = clean(name, 120) || entry.name;
        if (opened) entry.lastOpened = stamp;
        return found ? list : [entry, ...list];
      });
      return entry;
    },
    async touch(id) {
      let entry = null;
      await update(list => { entry = list.find(p => p.id === id) ?? null; if (entry) entry.lastOpened = now().toISOString(); return list; });
      return entry;
    },
    /** Drop an entry from the list. Nothing on disk is touched. Returns whether it was there. */
    async remove(id) {
      let removed = false;
      await update(list => list.filter(p => (p.id === id ? !(removed = true) : true)));
      return removed;
    },
  };
}
