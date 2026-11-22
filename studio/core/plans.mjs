// Planned-asset records created through the studio. They sit in a JSON file BESIDE the design
// manifest (the indexer says where: index.info.plansFile), never inside it: that manifest is a locked
// contract. There is no delete here on purpose; removing a plan is a human edit.
import path from 'node:path';
import { milestones, isShipped } from './assets.mjs';
import { readJson } from './files.mjs';
import { problem } from './errors.mjs';
import { sha256, withLock, writeFileAtomic } from './fsutil.mjs';

export const PLANS_SCHEMA = 'studio.plans';

export async function readPlans(root, rel) {
  try {
    const data = await readJson(root, rel);
    if (data?.schema !== PLANS_SCHEMA || !Array.isArray(data.entries)) throw new Error(`${rel} is not a studio plans file`);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') return {schema: PLANS_SCHEMA, version: 1, entries: []};
    throw error;
  }
}

const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export const planEtag = entry => sha256(JSON.stringify(entry));
const invalid = message => { throw problem(422, 'invalid_input', message); };

function validateFields(fields, index, selfId) {
  const {profiles, chunks} = index.info;
  const phases = new Set(), methods = new Set();
  for (const a of index.assets.values()) { if (a.profile !== undefined) { phases.add(a.phase); methods.add(a.method); } }
  if ('profile' in fields && !Object.hasOwn(profiles, fields.profile)) invalid(`Unknown profile "${fields.profile}". Choose one of: ${Object.keys(profiles).join(', ')}`);
  if ('chunk_group' in fields && !Object.hasOwn(chunks, fields.chunk_group)) invalid(`Unknown chunk "${fields.chunk_group}". Choose one of: ${Object.keys(chunks).join(', ')}`);
  if ('phase' in fields && !phases.has(fields.phase)) invalid(`Unknown phase "${fields.phase}". Choose one of: ${[...phases].join(', ')}`);
  if ('method' in fields && !methods.has(fields.method)) invalid(`Unknown method "${fields.method}". Choose one of: ${[...methods].join(', ')}`);
  if ('brief' in fields && !text(fields.brief, 400)) invalid('brief must be 1 to 400 characters');
  if ('dependencies' in fields) {
    if (!Array.isArray(fields.dependencies) || fields.dependencies.length > 16) invalid('dependencies must be a list of at most 16 asset ids');
    for (const d of fields.dependencies) {
      if (d === selfId) invalid('An asset cannot depend on itself');
      if (!index.assets.has(d)) invalid(`Dependency "${d}" is not a known asset id`);
    }
  }
}

/**
 * op 'create': {id, profile, chunk_group, brief, phase?, method?, dependencies?}
 * op 'edit':   {id, etag, ...any of profile, chunk_group, brief, phase, method, dependencies}
 * Returns {entry, etag, created}. Edits need the etag from the last read (optimistic concurrency).
 */
export async function planAsset({root, index, caller, op, id, etag, ...fields}) {
  if (!index.info.plansFile) throw problem(422, 'unsupported', 'This project has no design manifest to plan against');
  const file = path.join(root, index.info.plansFile);
  return withLock(file, async () => {
    // Re-read inside the lock: the index passed in may predate a concurrent write.
    const current = await readPlans(root, index.info.plansFile);
    const at = current.entries.findIndex(e => e.id === id);
    const stamp = {agent: caller.agent, session: caller.session, at: new Date().toISOString()};
    let entry, created = false;
    if (op === 'create') {
      const rule = index.info.planId;
      if (!new RegExp(rule.pattern).test(id) || id.length > 64) invalid(`id must look like ${rule.hint} (lowercase words joined by underscores, at most 64 characters)`);
      if (index.assets.has(id) || at >= 0) throw problem(409, 'id_taken', `An asset "${id}" already exists`);
      for (const f of ['profile', 'chunk_group', 'brief']) if (!(f in fields)) invalid(`create needs ${f}`);
      const merged = {profile: fields.profile, chunk_group: fields.chunk_group, phase: fields.phase ?? 'later',
        method: fields.method ?? 'new_source', brief: fields.brief, dependencies: fields.dependencies ?? []};
      validateFields(merged, index, id);
      entry = {id, ...merged, studio: {createdBy: stamp}};
      current.entries.push(entry);
      created = true;
    } else {
      if (at < 0) {
        const known = index.assets.get(id);
        throw problem(known ? 403 : 404, known ? 'not_editable' : 'unknown_asset',
          known ? `"${id}" comes from ${known.manifest}, a locked manifest; only entries created with studio_asset_plan can be edited here`
            : `No planned entry "${id}"`);
      }
      const old = current.entries[at];
      if (!etag) invalid('edit needs the etag from studio_asset_get (it proves you saw the current entry)');
      if (etag !== planEtag(old)) throw problem(409, 'etag_mismatch', `"${id}" changed since you read it; call studio_asset_get again`);
      const record = index.assets.get(id);
      const m = record && await milestones(root, record);
      if (isShipped(m)) throw problem(409, 'not_planned', `"${id}" already has processed or packed frames, so it is no longer a planned entry`);
      const next = {...old};
      for (const f of ['profile', 'chunk_group', 'brief', 'phase', 'method', 'dependencies']) if (f in fields) next[f] = fields[f];
      if (next.profile !== old.profile && m.source.files) invalid('The profile cannot change once frames have been submitted');
      validateFields(next, index, id);
      next.studio = {...old.studio, updatedBy: stamp};
      current.entries[at] = entry = next;
    }
    const out = {schema: PLANS_SCHEMA, version: 1, entries: current.entries};
    await writeFileAtomic(file, JSON.stringify(out, null, 2) + '\n');
    return {entry, etag: planEtag(entry), created, file: index.info.plansFile};
  });
}
