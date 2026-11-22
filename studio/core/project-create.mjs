// Make a new project folder from a template. `blank` is `init` (scaffold.mjs); `moss-lantern` copies the sample project that ships
// beside the studio. Never writes into a folder that already has something in it, and never reaches outside the folder it was given.
import fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from './errors.mjs';
import { agentConfigs, scaffold } from './scaffold.mjs';
import { normalizeProjectPath } from './project-registry.mjs';
import { applySettings, readSettings } from './project-settings.mjs';

export const TEMPLATES = ['blank', 'moss-lantern'];
// Files of the sample that point at the studio by a relative path: written again for the new place, not copied.
const REWRITTEN = new Set(['.mcp.json', '.codex', '.agents']);

const exists = p => fs.stat(p).then(() => true, () => false);

export async function templateList(studioDir) {
  return [{id: 'blank', available: true}, {id: 'moss-lantern', available: await exists(path.join(studioDir, 'examples', 'moss-lantern', 'studio.project.json'))}];
}

async function copyTree(from, to) {
  await fs.mkdir(to, {recursive: true});
  for (const entry of await fs.readdir(from, {withFileTypes: true})) {
    if (REWRITTEN.has(entry.name) && from.endsWith('moss-lantern')) continue;
    const src = path.join(from, entry.name), dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst);
    else if (entry.isFile()) await fs.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
    // symlinks and special files are not copied
  }
}

/**
 * Create the project and return {dir, id, name, template}. `dirArg` must be a full path whose parent exists and whose
 * last part does not exist yet or is an empty folder.
 */
export async function createProject({template = 'blank', dir: dirArg, name, id}, studioDir, options) {
  if (!TEMPLATES.includes(template)) throw problem(422, 'unknown_template', `Unknown template "${template}"`);
  const dir = normalizeProjectPath(dirArg, options);
  if (path.dirname(dir) === dir) throw problem(422, 'invalid_path', 'Choose a folder, not the root of the disk');
  const realStudio = await fs.realpath(studioDir);
  const inside = (a, b) => { const r = path.relative(a, b); return !r.startsWith('..') && !path.isAbsolute(r); };
  let realParent;
  try { realParent = await fs.realpath(path.dirname(dir)); } catch { throw problem(404, 'parent_missing', 'The folder that should hold the project does not exist'); }
  if (!(await fs.stat(realParent)).isDirectory()) throw problem(422, 'not_a_directory', 'The parent path is not a folder');
  const target = path.join(realParent, path.basename(dir));
  if (inside(realStudio, target)) throw problem(422, 'invalid_path', 'A project cannot be created inside the Pixel Kiln folder');
  if (await exists(target)) {
    if (!(await fs.stat(target)).isDirectory()) throw problem(409, 'dir_not_empty', 'A file already has that name');
    if ((await fs.readdir(target)).length) throw problem(409, 'dir_not_empty', 'That folder is not empty; choose a new or empty folder');
  }
  const projectName = (typeof name === 'string' && name.trim()) || path.basename(target);
  if (projectName.length > 80) throw problem(422, 'invalid_input', 'The name must be 1 to 80 characters');
  if (id !== undefined && id !== '' && !/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw problem(422, 'invalid_input', 'The id uses lowercase letters, digits, - and _');
  if (template === 'blank') {
    const r = await scaffold(target, studioDir, {name: projectName, id: id || undefined});
    return {dir: r.dir, id: r.id, name: r.name, template};
  }
  const source = path.join(studioDir, 'examples', 'moss-lantern');
  if (!(await exists(path.join(source, 'studio.project.json')))) throw problem(404, 'template_missing', 'The moss-lantern sample is not part of this copy of Pixel Kiln');
  await copyTree(source, target);
  const real = await fs.realpath(target);
  for (const [rel, body] of Object.entries(agentConfigs(real, studioDir))) {
    await fs.mkdir(path.dirname(path.join(real, rel)), {recursive: true});
    await fs.writeFile(path.join(real, rel), body, {flag: 'wx'});
  }
  const {baseSha, id: packId, settings} = await readSettings(real);
  if (name && name.trim() && name.trim() !== settings.name) await applySettings(real, {baseSha, changes: {name: name.trim()}});
  return {dir: real, id: packId, name: (name && name.trim()) || settings.name, template};
}
