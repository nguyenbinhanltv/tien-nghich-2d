// Planned-asset records created through the studio. They sit in a JSON file BESIDE the design
// manifest (the indexer says where: index.info.plansFile), never inside it: that manifest is a locked
// contract. There is no delete here on purpose; removing a plan is a human edit.
import path from 'node:path';
import { milestones, isShipped } from './assets.mjs';
import { readJson } from './files.mjs';
import { problem } from './errors.mjs';
import { sha256, withLock, writeFileAtomic } from './fsutil.mjs';
import { parseCsv } from './csv.mjs';

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

const DIRECTIONS = ['none', 'south', 'west', 'north', 'east'];

/** An inline profile for an asset that fits no manifest profile (a VFX, a one-off): size, pivot, directions, clips. */
function validateCustom(custom, index) {
  const ok = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!custom || typeof custom !== 'object' || Array.isArray(custom) || Object.keys(custom).some(k => !['category', 'size', 'pivot', 'directions', 'clips'].includes(k))) invalid('custom may only contain category, size, pivot, directions and clips');
  const categories = new Set([...index.assets.values()].map(a => a.category));
  categories.add('vfx');
  if (!categories.has(custom.category)) invalid(`custom.category "${custom.category}" is not known. Choose one of: ${[...categories].sort().join(', ')}`);
  if (!Array.isArray(custom.size) || custom.size.length !== 2 || !custom.size.every(v => ok(v, 4, 256))) invalid('custom.size must be [width, height], integers 4 to 256');
  if (!Array.isArray(custom.pivot) || custom.pivot.length !== 2 || !ok(custom.pivot[0], 0, custom.size[0] - 1) || !ok(custom.pivot[1], 0, custom.size[1] - 1)) invalid('custom.pivot must be [x, y] inside custom.size');
  const dirs = custom.directions ?? ['none'];
  if (!Array.isArray(dirs) || !dirs.length || dirs.length > 4 || new Set(dirs).size !== dirs.length || dirs.some(d => !DIRECTIONS.includes(d))) invalid(`custom.directions must be 1 to 4 distinct values of ${DIRECTIONS.join(', ')}`);
  const clips = custom.clips;
  if (!clips || typeof clips !== 'object' || Array.isArray(clips) || !Object.keys(clips).length || Object.keys(clips).length > 8) invalid('custom.clips must name 1 to 8 clips');
  for (const [name, c] of Object.entries(clips)) {
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(name)) invalid(`custom clip name "${name}" must be lower_snake_case`);
    if (!c || typeof c !== 'object' || Object.keys(c).some(k => !['frames', 'frameMs'].includes(k)) || !ok(c.frames, 1, 64) || !ok(c.frameMs, 1, 60000)) invalid(`custom.clips.${name} must be {frames: 1-64, frameMs: 1-60000}`);
  }
}

function validateFields(fields, index, selfId) {
  if ('custom' in fields) validateCustom(fields.custom, index);
  const {profiles, chunks} = index.info;
  // 'later' and 'new_source' are what a plan gets when it names none, so they are always valid (a project with no assets yet has no other).
  const phases = new Set(['later']), methods = new Set(['new_source']);
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

const CONTEXT_LIMITS = {keys: 24, value: 300};

/** Free-form notes from a spreadsheet's unmapped columns: short strings under short names. */
function validateContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context) || Object.keys(context).length > CONTEXT_LIMITS.keys) invalid(`context must be an object of at most ${CONTEXT_LIMITS.keys} entries`);
  for (const [k, v] of Object.entries(context)) {
    if (!k || k.length > 60 || typeof v !== 'string' || v.length > CONTEXT_LIMITS.value) invalid(`context "${k.slice(0, 20)}" must be a string of at most ${CONTEXT_LIMITS.value} characters under a name of at most 60`);
  }
}

/** Validate a new entry and build it (no I/O). Throws a 422 problem that says what is wrong. */
function buildCreate(index, id, fields, stamp) {
  const rule = index.info.planId;
  if (!new RegExp(rule.pattern).test(id) || id.length > 64) invalid(`id must look like ${rule.hint} (lowercase words joined by underscores, at most 64 characters)`);
  if (index.assets.has(id)) throw problem(409, 'id_taken', `An asset "${id}" already exists`);
  for (const f of ['chunk_group', 'brief']) if (!(f in fields)) invalid(`create needs ${f}`);
  if (('profile' in fields) === ('custom' in fields)) invalid('create needs exactly one of profile (a manifest profile: size, pivot and clips come from it) or custom (an inline size, pivot and clips)');
  const merged = {...('profile' in fields ? {profile: fields.profile} : {custom: fields.custom}), chunk_group: fields.chunk_group, phase: fields.phase ?? 'later',
    method: fields.method ?? 'new_source', brief: fields.brief, dependencies: fields.dependencies ?? []};
  validateFields(merged, index, id);
  if ('context' in fields) { validateContext(fields.context); if (Object.keys(fields.context).length) merged.context = fields.context; }
  return {id, ...merged, studio: {createdBy: stamp}};
}

/** "idle:4@120; walk:6@100" -> {idle: {frames: 4, frameMs: 120}, walk: {...}}. A missing @ms means 120. */
export function parseClips(text) {
  const clips = {};
  for (const part of String(text).split(/[;|]/).map(p => p.trim()).filter(Boolean)) {
    const m = /^([a-z][a-z0-9_]*)\s*[:=x]\s*(\d+)\s*(?:@\s*(\d+))?$/i.exec(part);
    if (!m) throw problem(422, 'invalid_input', `clips: "${part}" does not look like name:frames@ms (for example idle:4@120)`);
    clips[m[1].toLowerCase()] = {frames: Number(m[2]), frameMs: m[3] ? Number(m[3]) : 120};
  }
  return clips;
}

export const IMPORT_LIMITS = {rows: 500, bytes: 256 * 1024};
const MAPPED = ['id', 'category', 'size', 'clips', 'brief', 'chunk'];

/** The column that most likely holds each field, by header name. Only a suggestion: the person confirms it. */
export function suggestMapping(headers) {
  const words = {id: ['id', 'asset id', 'asset_id', 'key'], category: ['category', 'type', 'kind'], size: ['size class', 'size_class', 'size', 'profile', 'class'],
    clips: ['clips', 'animations', 'anims'], brief: ['brief', 'description', 'notes', 'note'], chunk: ['chunk', 'chunk_group', 'group', 'zone']};
  const lower = headers.map(h => h.toLowerCase());
  const out = {};
  for (const [field, names] of Object.entries(words)) {
    const at = lower.findIndex(h => names.includes(h));
    if (at >= 0 && !Object.values(out).includes(headers[at])) out[field] = headers[at];
  }
  return out;
}

/**
 * Plan a spreadsheet import: which rows would be created and which skipped, and why. Existing ids (in
 * a manifest or already planned) and repeats inside the file are skipped, never overwritten.
 * mapping: {id, brief, chunk?, category?, size?, clips?} -> column headers. defaults: {chunk?, phase?, method?}.
 * Columns that are not mapped travel with the entry as `context`.
 */
export function planRows({csv, mapping = {}, defaults = {}, index, existing = new Set()}) {
  const {headers, rows} = csv;
  for (const [field, column] of Object.entries(mapping)) {
    if (!MAPPED.includes(field)) invalid(`mapping: "${field}" is not a field (use ${MAPPED.join(', ')})`);
    if (column && !headers.includes(column)) invalid(`mapping: the file has no column "${column}"`);
  }
  for (const field of ['id', 'brief']) if (!mapping[field]) invalid(`mapping needs a column for ${field}`);
  if (rows.length > IMPORT_LIMITS.rows) invalid(`the file has ${rows.length} rows; the limit is ${IMPORT_LIMITS.rows}`);
  const at = Object.fromEntries(Object.entries(mapping).filter(([, c]) => c).map(([f, c]) => [f, headers.indexOf(c)]));
  const mappedColumns = new Set(Object.values(at));
  const seen = new Set();
  const stamp = {agent: 'studio-ui', session: 'spreadsheet-import', at: new Date().toISOString()};
  return rows.map(({line, cells}) => {
    const cell = f => (f in at ? cells[at[f]] : '');
    const id = cell('id');
    const out = {line, id, action: 'skip', reason: null, entry: null};
    try {
      if (!id) invalid('the id cell is empty');
      if (existing.has(id) || index.assets.has(id)) { out.reason = 'exists'; out.message = `"${id}" already exists; existing ids are never overwritten`; return out; }
      if (seen.has(id)) { out.reason = 'repeated'; out.message = `"${id}" appears earlier in this file`; return out; }
      seen.add(id);
      const context = {};
      headers.forEach((name, i) => { if (!mappedColumns.has(i) && cells[i]) context[name.slice(0, 60)] = cells[i].slice(0, CONTEXT_LIMITS.value); });
      const fields = {chunk_group: cell('chunk') || defaults.chunk, brief: cell('brief'), phase: defaults.phase, method: defaults.method, context};
      if (!fields.chunk_group) invalid('no chunk: map a chunk column or choose a default chunk');
      for (const k of ['phase', 'method']) if (fields[k] === undefined) delete fields[k];
      const size = cell('size');
      if (Object.hasOwn(index.info.profiles, size)) fields.profile = size;
      else {
        const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(size);
        if (!m) invalid(size ? `size class "${size}" is neither one of ${Object.keys(index.info.profiles).join(', ')} nor a WxH size such as 32x32` : 'the size class cell is empty');
        const [w, h] = [Number(m[1]), Number(m[2])];
        const clips = cell('clips');
        if (!clips) invalid('a WxH size needs clips (for example idle:4@120)');
        fields.custom = {category: cell('category'), size: [w, h], pivot: [Math.floor(w / 2), h - 1], clips: parseClips(clips)};
      }
      if (fields.profile && cell('category')) context.category = cell('category'); // the profile decides the category; the cell stays as a note
      out.entry = buildCreate(index, id, fields, stamp);
      out.action = 'create';
    } catch (error) {
      if (!error.status) throw error;
      out.reason = out.reason ?? 'invalid'; out.message = error.message;
    }
    return out;
  });
}

/**
 * Import a spreadsheet of planned assets into the plan store. dryRun returns the plan and writes nothing;
 * otherwise the rows that would be created are written in ONE atomic write, under the same lock planAsset uses.
 */
export async function planImport({root, index, csvText, mapping, defaults, dryRun = true, caller}) {
  if (!index.info.plansFile) throw problem(422, 'unsupported', 'This project has no design manifest to plan against');
  if (typeof csvText !== 'string' || !csvText.trim()) invalid('csv is empty');
  if (Buffer.byteLength(csvText) > IMPORT_LIMITS.bytes) invalid(`the file is larger than ${IMPORT_LIMITS.bytes} bytes`);
  let csv;
  try { csv = parseCsv(csvText); } catch (error) { invalid(error.message); }
  const file = path.join(root, index.info.plansFile);
  const run = async () => {
    const current = await readPlans(root, index.info.plansFile);
    const results = planRows({csv, mapping, defaults, index, existing: new Set(current.entries.map(e => e.id))});
    const create = results.filter(r => r.action === 'create');
    const summary = {create: create.length, skip: results.length - create.length};
    if (!dryRun && create.length) {
      const stamp = {agent: caller?.agent ?? 'studio-ui', session: caller?.session ?? 'spreadsheet-import', at: new Date().toISOString()};
      for (const r of create) { r.entry.studio.createdBy = stamp; current.entries.push(r.entry); }
      await writeFileAtomic(file, JSON.stringify({schema: PLANS_SCHEMA, version: 1, entries: current.entries}, null, 2) + '\n');
    }
    return {dryRun, headers: csv.headers, delimiter: csv.delimiter, rows: results, summary, written: !dryRun && create.length > 0, file: index.info.plansFile};
  };
  return dryRun ? run() : withLock(file, run);
}

/**
 * op 'create': {id, profile, chunk_group, brief, phase?, method?, dependencies?}
 * op 'edit':   {id, etag, ...any of profile, chunk_group, brief, phase, method, dependencies}
 * Returns {entry, etag, created}. Edits need the etag from the last read (optimistic concurrency).
 */
export async function planAsset({root, index, caller, op, id, etag, dryRun = false, ...fields}) {
  if (!index.info.plansFile) throw problem(422, 'unsupported', 'This project has no design manifest to plan against');
  const file = path.join(root, index.info.plansFile);
  return withLock(file, async () => {
    // Re-read inside the lock: the index passed in may predate a concurrent write.
    const current = await readPlans(root, index.info.plansFile);
    const at = current.entries.findIndex(e => e.id === id);
    const stamp = {agent: caller.agent, session: caller.session, at: new Date().toISOString()};
    let entry, created = false, before = null;
    if (op === 'create') {
      if (at >= 0) throw problem(409, 'id_taken', `An asset "${id}" already exists`);
      entry = buildCreate(index, id, fields, stamp);
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
      before = old;
      if (!etag) invalid('edit needs the etag from studio_asset_get (it proves you saw the current entry)');
      if (etag !== planEtag(old)) throw problem(409, 'etag_mismatch', `"${id}" changed since you read it; call studio_asset_get again`);
      const record = index.assets.get(id);
      const m = record && await milestones(root, record);
      if (isShipped(m)) throw problem(409, 'not_planned', `"${id}" already has processed or packed frames, so it is no longer a planned entry`);
      const next = {...old};
      if (('profile' in fields || 'custom' in fields) && m.source.files) invalid('The profile or custom spec cannot change once frames have been submitted');
      for (const f of ['profile', 'custom', 'chunk_group', 'brief', 'phase', 'method', 'dependencies']) if (f in fields) next[f] = fields[f];
      if ('profile' in fields) delete next.custom;
      if ('custom' in fields) delete next.profile;
      if (('profile' in next) === ('custom' in next)) invalid('an entry has exactly one of profile or custom');
      validateFields(next, index, id);
      next.studio = {...old.studio, updatedBy: stamp};
      current.entries[at] = entry = next;
    }
    if (dryRun) return {dryRun: true, entry, before, created, file: index.info.plansFile};
    const out = {schema: PLANS_SCHEMA, version: 1, entries: current.entries};
    await writeFileAtomic(file, JSON.stringify(out, null, 2) + '\n');
    return {entry, etag: planEtag(entry), created, file: index.info.plansFile};
  });
}

/** What a planned entry may name in this project: chunks, profiles, categories, phases, methods. */
export function planOptions(index) {
  const phases = new Set(), methods = new Set(), categories = new Set(['vfx']);
  for (const a of index.assets.values()) { categories.add(a.category); if (a.profile !== undefined) { phases.add(a.phase); methods.add(a.method); } }
  phases.add('later'); methods.add('new_source');
  const sort = set => [...set].filter(Boolean).sort();
  return {chunks: Object.keys(index.info.chunks ?? {}), profiles: Object.keys(index.info.profiles ?? {}), categories: sort(categories), phases: sort(phases), methods: sort(methods),
    idHint: index.info.planId?.hint ?? null, limits: IMPORT_LIMITS};
}
