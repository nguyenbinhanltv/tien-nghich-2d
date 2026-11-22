// Authoring: submit native frames with mandatory provenance. Raw frames are written once and never
// changed; every submission is appended to a log with who (agent, session) and what (tool, prompt or
// generator, source hash); the pixel gates run first and a defective batch writes nothing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { decodeRgba } from './png.mjs';
import { assetGateOptions, findDefects } from './defects.mjs';
import { clipSpec, expectedFrames, isShipped, listFrames, milestones } from './assets.mjs';
import { problem } from './errors.mjs';
import { containedPath, ensureDirInside, readTextIfExists, sha256, withLock } from './fsutil.mjs';
import { readInside } from './files.mjs';

export const SUBMISSIONS_FILE = 'studio-submissions.jsonl';
const MAX_PNG_BYTES = 96 * 1024, MAX_BATCH_FRAMES = 128, MAX_BATCH_BYTES = 4 * 1024 * 1024;
const invalid = message => { throw problem(422, 'invalid_input', message); };

export async function readSubmissions(root, asset) {
  const dir = asset.layout?.rawDir;
  if (!dir) return [];
  const raw = await readTextIfExists(path.join(root, dir, SUBMISSIONS_FILE));
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); }
    catch { throw problem(500, 'corrupt_log', `${dir}/${SUBMISSIONS_FILE} line ${i + 1} is not valid JSON`); }
  });
}

/** Distinct {agent, session} pairs that submitted frames for the asset. */
export function authorsOf(records) {
  const seen = new Map();
  for (const r of records) seen.set(`${r.agent}\0${r.session}`, {agent: r.agent, session: r.session});
  return [...seen.values()];
}

/** One hash for the current frames of an asset at a stage: changes when any frame's pixels change. */
export async function contentHash(root, asset, stage) {
  const {frames} = await listFrames(root, asset, stage);
  if (!frames.length) return null;
  const parts = [];
  for (const f of frames) parts.push(`${f.rel}:${sha256(await readInside(root, f.rel))}`);
  return sha256(parts.join('\n'));
}

/** Provenance is mandatory: a tool, a prompt or a generator, and the hash of the source. */
export function validateProvenance(p, index) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) invalid('provenance is required');
  const out = {};
  if (typeof p.tool !== 'string' || !p.tool.trim() || p.tool.length > 200) invalid('provenance.tool is required (the image tool or program that made the pixels, 1-200 characters)');
  out.tool = p.tool.trim();
  const hasPrompt = typeof p.prompt === 'string' && p.prompt.trim(), hasGen = typeof p.generator === 'string' && p.generator.trim();
  if (!hasPrompt && !hasGen) invalid('provenance needs a prompt (what you asked the tool) or a generator (the project-relative path of the program)');
  if (hasPrompt) { if (p.prompt.length > 8000) invalid('provenance.prompt is too long (8000 characters)'); out.prompt = p.prompt; }
  if (hasGen) {
    if (p.generator.length > 300 || /\0|\.\.|^\//.test(p.generator)) invalid('provenance.generator must be a project-relative path');
    out.generator = p.generator.trim();
  }
  if (typeof p.sourceHash !== 'string' || !/^[0-9a-f]{64}$/.test(p.sourceHash)) invalid('provenance.sourceHash must be the lowercase sha256 (64 hex characters) of the source image, sheet or generator output the frames came from');
  out.sourceHash = p.sourceHash;
  if (p.rights !== undefined) { if (typeof p.rights !== 'string' || p.rights.length > 500) invalid('provenance.rights must be a string of at most 500 characters'); out.rights = p.rights; }
  if (p.parentIds !== undefined) {
    if (!Array.isArray(p.parentIds) || p.parentIds.length > 16) invalid('provenance.parentIds must be a list of at most 16 asset ids');
    for (const id of p.parentIds) if (!index.assets.has(id)) invalid(`provenance.parentIds: "${id}" is not a known asset id`);
    out.parentIds = p.parentIds;
  }
  if (p.notes !== undefined) { if (typeof p.notes !== 'string' || p.notes.length > 2000) invalid('provenance.notes must be a string of at most 2000 characters'); out.notes = p.notes; }
  return out;
}

function frameName(f) { return `${f.clip}_${f.direction}_${f.n}`; }

async function loadBytes(root, f) {
  if ((f.pngBase64 === undefined) === (f.file === undefined)) invalid(`frame ${frameName(f)}: give exactly one of pngBase64 or file`);
  let bytes;
  if (f.file !== undefined) {
    const abs = containedPath(root, f.file);
    // Size first, following links: a huge file must be refused before it is read into memory.
    try {
      const st = await fs.stat(abs);
      if (!st.isFile()) invalid(`frame ${frameName(f)}: ${f.file} is not a regular file`);
      if (st.size > MAX_PNG_BYTES) invalid(`frame ${frameName(f)}: ${f.file} is ${st.size} bytes; the limit is ${MAX_PNG_BYTES}`);
    } catch (error) { if (error.status) throw error; /* ENOENT and the like are reported just below */ }
    try { bytes = await readInside(root, f.file); }
    catch (error) {
      if (error.code === 'ENOENT') throw invalid(`frame ${frameName(f)}: file not found: ${f.file}`);
      throw problem(422, 'unreadable_file', `frame ${frameName(f)}: cannot read ${f.file} (${error.message})`);
    }
  } else {
    bytes = Buffer.from(f.pngBase64, 'base64');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.pngBase64) || bytes.toString('base64') !== f.pngBase64) invalid(`frame ${frameName(f)}: pngBase64 is not canonical base64`);
  }
  if (bytes.length > MAX_PNG_BYTES) invalid(`frame ${frameName(f)}: PNG is ${bytes.length} bytes; the limit is ${MAX_PNG_BYTES}`);
  return bytes;
}

function checkAddress(asset, f) {
  const spec = clipSpec(asset, f.clip);
  if (!spec) invalid(`${asset.id} has no clip "${f.clip}". Clips: ${Object.keys(asset.clips ?? {}).join(', ')}`);
  if (!asset.directions.includes(f.direction)) invalid(`${asset.id} has no direction "${f.direction}". Directions: ${asset.directions.join(', ')}`);
  if (!Number.isInteger(f.n) || f.n < 0 || f.n >= spec.frames) invalid(`clip ${f.clip} has ${spec.frames} frames; n must be 0 to ${spec.frames - 1}, got ${f.n}`);
}

/**
 * Submit frames for a design-manifest asset.
 * frames: [{clip, direction, n, pngBase64 | file}]; provenance as validateProvenance.
 * Returns {accepted, report}. A batch with any error-severity defect is not written at all.
 */
export async function submitFrames({ws, pack, palette, index, asset, frames, provenance, caller, dryRun = false}) {
  const root = ws.root;
  if (!asset.layout?.studioRawDir) throw problem(422, 'unsupported', `${asset.id} (${asset.source}) is not open for frame submission; only design-manifest assets are. Shipped frames change through reviewed revisions.`);
  const m = await milestones(root, asset);
  if (isShipped(m)) throw problem(409, 'already_processed', `${asset.id} already has processed or packed frames (${m.processed.found} processed). New work on it goes through revisions, not raw submission.`);
  if (!Array.isArray(frames) || !frames.length || frames.length > MAX_BATCH_FRAMES) invalid(`frames must hold 1 to ${MAX_BATCH_FRAMES} frames`);
  // One provenance for the batch, or a list of {frames: [names], ...provenance}: frames made from different sources
  // (two sheets) still go in ONE all-or-nothing submission, each credited to its own source.
  const grouped = Array.isArray(provenance);
  const provs = grouped ? provenance.map(({frames: names, ...rest}) => ({names, prov: validateProvenance(rest, index)})) : [{names: null, prov: validateProvenance(provenance, index)}];
  const prov = provs[0].prov;
  if (grouped) {
    const claimed = provs.flatMap(g => g.names ?? []);
    if (!provs.length || new Set(claimed).size !== claimed.length) invalid('provenance groups must each name their frames, and no frame may be in two groups');
  }

  const seen = new Set(), loaded = [];
  let total = 0;
  for (const f of frames) {
    checkAddress(asset, f);
    const name = frameName(f);
    if (seen.has(name)) invalid(`frame ${name} appears twice in this batch`);
    seen.add(name);
    const bytes = await loadBytes(root, f);
    total += bytes.length;
    if (total > MAX_BATCH_BYTES) invalid('batch is larger than 4 MiB; submit it in parts');
    loaded.push({...f, name, bytes});
  }

  const options = assetGateOptions(pack, palette, asset, 'warn');
  const [w, h] = asset.size;
  const report = {asset: asset.id, dryRun, frames: [], written: [], unchanged: []};
  let rejected = false;
  for (const f of loaded) {
    let image;
    try { image = decodeRgba(f.bytes); }
    catch (error) { image = null; f.problem = `not a readable PNG: ${error.message}`; }
    let found = {defects: [], counts: {}, totals: {error: 0, warn: 0}};
    if (image) {
      if (image.width !== w || image.height !== h) f.problem = `canvas ${image.width}x${image.height} does not match the ${asset.profile} profile (${w}x${h})`;
      else found = findDefects(image, options);
    }
    const errors = f.problem ? 1 : found.totals.error;
    if (errors) rejected = true;
    report.frames.push({name: f.name, key: asset.layout.keyOf(f.clip, f.direction, f.n), sha256: sha256(f.bytes),
      ...(f.problem ? {problem: f.problem} : {}), errors, warnings: found.totals.warn, counts: found.counts, defects: found.defects.slice(0, 60)});
  }
  if (rejected) {
    report.accepted = false;
    report.message = 'Nothing was written. Fix the defects below (coordinates are x, y from the top-left of the frame) and submit again; use dryRun to check without writing.';
    return {accepted: false, report};
  }

  const dir = asset.layout.studioRawDir;
  const plan = [];
  for (const f of loaded) {
    const rel = `${dir}/${f.name}.png`;
    let existing = null;
    try { existing = await readInside(root, rel); }
    catch (error) {
      if (error.code === 'EISDIR') throw problem(409, 'frame_exists', `${rel} exists and is not a regular file; nothing was written. Ask a human to clear it.`);
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing && sha256(existing) !== sha256(f.bytes)) {
      throw problem(409, 'frame_exists', `${rel} already exists with different pixels. Raw frames are immutable; to change a submitted frame use a revision (frame_patch) or ask a human to remove it.`);
    }
    plan.push({f, rel, exists: !!existing});
  }
  report.accepted = true;
  if (dryRun) {
    report.wouldWrite = plan.filter(p => !p.exists).map(p => p.rel);
    report.unchanged = plan.filter(p => p.exists).map(p => p.rel);
    return {accepted: true, report};
  }

  const logFile = path.join(root, asset.layout.rawDir, SUBMISSIONS_FILE);
  return withLock(logFile, async () => {
    const created = [];
    try {
      await ensureDirInside(root, dir);
      for (const p of plan) {
        if (p.exists) { report.unchanged.push(p.rel); continue; }
        await fs.writeFile(containedPath(root, p.rel), p.f.bytes, {flag: 'wx', mode: 0o644}); // wx: never overwrite
        created.push(p.rel);
        report.written.push(p.rel);
      }
      const store = await ws.store();
      const meta = (f) => ({pivot: asset.pivot ?? [Math.floor(w / 2), Math.floor(h / 2)], durationMs: clipSpec(asset, f.clip).frameMs});
      for (const p of plan) {
        const {f} = p;
        const key = asset.layout.keyOf(f.clip, f.direction, f.n);
        if (!store.needsBaseline(key)) continue; // lineage exists from an earlier run
        const frame = {kind: 'studio', info: {key, assetId: asset.id, category: asset.category, width: w, height: h, sourceUrl: '/' + p.rel,
          processedUrl: '/' + p.rel, editableFields: ['pivot', 'durationMs']}, metadata: meta(f)};
        // Revision 0 is the submission. The store treats revision 0 as approved by default, so say
        // 'pending' explicitly: an agent submission starts unreviewed, and only a human can change that.
        store.operate(frame, f.bytes, 'review', {revision: 0, status: 'pending'});
      }
      const lines = [];
      for (const g of provs) {
        const mine = g.names ? plan.filter(p => g.names.includes(p.f.name)) : plan;
        if (!mine.length) continue;
        const record = {at: new Date().toISOString(), agent: caller.agent, session: caller.session, kind: 'frames', ...g.prov,
          frames: mine.map(p => ({name: p.f.name, file: p.rel, sha256: sha256(p.f.bytes), width: w, height: h, created: !p.exists})),
          gates: {errors: 0, warnings: report.frames.reduce((n, x) => n + x.warnings, 0)}};
        // A resubmission that wrote nothing adds no provenance: the pixels' origin is the first record.
        if (mine.some(p => !p.exists)) lines.push(JSON.stringify(record));
      }
      if (lines.length) await fs.appendFile(logFile, lines.join('\n') + '\n');
    } catch (error) {
      for (const rel of created) await fs.rm(containedPath(root, rel), {force: true});
      throw error;
    }
    const after = await milestones(root, asset);
    report.provenance = {tool: prov.tool, agent: caller.agent, session: caller.session, sourceHash: prov.sourceHash};
    report.progress = {submitted: (await listFrames(root, asset, 'raw')).frames.length, expected: expectedFrames(asset).length, source: after.source};
    report.status = 'pending';
    report.next = ['studio_qa_run (from a different session for the independent check)', 'studio_preview_render to look at the frames', 'studio_review_request once checked'];
    return {accepted: true, report};
  });
}
