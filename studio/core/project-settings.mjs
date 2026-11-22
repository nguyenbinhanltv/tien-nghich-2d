// Read and change the settings of one project that a person edits in the Projects screen: the name, the
// subtitle and mark, the theme colours, the size classes, the licence profile and the quota.
// A change goes through the same checks as loading a pack (`validatePack`, the schema plus the cross-field rules) and
// is written in one atomic step. The pack as it was is kept first as a revision record under the project's revisions
// directory, so nothing is lost. `licenceProfile` and `quota` are decisions of the project's owner: a change to
// either is refused unless the caller says the owner decided it, and the record says so.
import fs from 'node:fs/promises';
import path from 'node:path';
import { problem } from './errors.mjs';
import { ensureDirInside, sha256, withLock, writeFileAtomic } from './fsutil.mjs';
import { packFileName, validatePack } from './pack.mjs';

export const OWNER_FIELDS = ['licenceProfile', 'quota'];
export const SETTING_FIELDS = ['name', 'mark', 'subtitle', 'theme', 'sizeClasses', ...OWNER_FIELDS];

const get = (obj, keys) => keys.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
/** Where each setting lives in the pack. */
const PLACES = {
  name: ['name'], mark: ['ui', 'brand', 'mark'], subtitle: ['ui', 'brand', 'subtitle'], theme: ['ui', 'theme'],
  sizeClasses: ['sizeClasses'], licenceProfile: ['ui', 'tabs', 'atlas', 'ledger', 'licenceProfile'], quota: ['ui', 'tabs', 'jobs', 'quota'],
};

function put(obj, keys, value) {
  let at = obj;
  for (const key of keys.slice(0, -1)) {
    if (!at[key] || typeof at[key] !== 'object' || Array.isArray(at[key])) at[key] = {};
    at = at[key];
  }
  const last = keys[keys.length - 1];
  if (value === null) delete at[last]; else at[last] = value;
}

async function readPack(root) {
  const text = await fs.readFile(path.join(root, packFileName), 'utf8');
  return {text, sha: sha256(text), pack: JSON.parse(text)};
}

/** The current settings, the hash of the pack file they came from (send it back with a change) and the palette to choose colours from. */
export async function readSettings(root) {
  const {sha, pack} = await readPack(root);
  let palette = [];
  try { palette = (JSON.parse(await fs.readFile(path.join(root, pack.palette.file), 'utf8')).colors ?? []).map(c => ({id: c.id, hex: c.hex})); } catch { /* a half-built project: the colour list is just empty */ }
  const settings = Object.fromEntries(SETTING_FIELDS.map(f => [f, get(pack, PLACES[f]) ?? null]));
  return {baseSha: sha, id: pack.id, settings, palette, ownerFields: OWNER_FIELDS};
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Apply `changes` ({field: value}; value null removes an optional field) to the pack of `root`.
 * `baseSha` must be the hash from `readSettings` (a pack edited meanwhile is refused). Returns {changed, baseSha, revision}.
 */
export function applySettings(root, {baseSha, changes, ownerDecision = false, now = () => new Date()}) {
  return withLock(path.join(root, packFileName), async () => {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) throw problem(422, 'invalid_input', 'Send the settings to change');
    const unknown = Object.keys(changes).filter(k => !SETTING_FIELDS.includes(k));
    if (unknown.length) throw problem(422, 'invalid_input', `Not a setting that can be changed here: ${unknown.join(', ')}`);
    const {sha, pack} = await readPack(root);
    if (baseSha !== sha) throw problem(409, 'stale_pack', 'The project file changed since you opened the settings; reload them and try again');
    const next = structuredClone(pack);
    const changed = [];
    for (const [field, value] of Object.entries(changes)) {
      if (sameJson(value, get(pack, PLACES[field]))) continue;
      if (field === 'name' && (typeof value !== 'string' || !value.trim() || value.length > 80)) throw problem(422, 'invalid_input', 'The name must be 1 to 80 characters');
      if (value === null && !['subtitle', 'licenceProfile', 'quota'].includes(field)) throw problem(422, 'invalid_input', `${field} cannot be removed`);
      put(next, PLACES[field], typeof value === 'string' ? value.trim() : value);
      changed.push(field);
    }
    if (!changed.length) return {changed, baseSha: sha, revision: null};
    const owner = changed.filter(f => OWNER_FIELDS.includes(f));
    if (owner.length && ownerDecision !== true)
      throw problem(403, 'owner_decision_required', `${owner.join(' and ')} ${owner.length > 1 ? 'are decisions' : 'is a decision'} of the project's owner; confirm that the owner decided it`);
    const issues = validatePack(next);
    if (!issues.length && changed.includes('theme')) {
      const ids = new Set((await readSettings(root)).palette.map(c => c.id));
      for (const [role, id] of Object.entries(next.ui?.theme ?? {})) if (ids.size && !ids.has(id)) issues.push(`ui.theme.${role}: "${id}" is not a colour of the palette`);
    }
    if (issues.length) throw Object.assign(problem(422, 'invalid_pack', 'These settings do not match the project schema'), {issues});
    // The revision record first: if it cannot be written the pack stays as it was.
    const at = now().toISOString();
    const dir = await ensureDirInside(root, `${pack.directories.revisions}/pack-settings`);
    const name = `${at.replace(/[:.]/g, '-')}-${sha.slice(0, 8)}.json`;
    await writeFileAtomic(path.join(dir, name), JSON.stringify({schema: 'pixel-kiln.pack-revision', version: 1, at, previousSha: sha, changed, ownerDecision: owner.length ? true : undefined, previous: pack}, null, 2) + '\n');
    const text = JSON.stringify(next, null, 2) + '\n';
    await writeFileAtomic(path.join(root, packFileName), text);
    return {changed, baseSha: sha256(text), revision: `${pack.directories.revisions}/pack-settings/${name}`};
  });
}
