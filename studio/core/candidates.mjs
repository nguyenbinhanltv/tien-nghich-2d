// Candidate runs: one request may yield several candidates for the same frames. Deterministic QA (the pixel gates) rejects the broken
// ones first; the survivors are stored as TAKES (new revisions, see store.mjs) and laid on one contact sheet. A candidate run never
// changes what is selected or in use: only a person picks one, in the Review tab (pickCandidate is called by that route alone;
// no MCP tool imports it).
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { decodeRgba } from './png.mjs';
import { assetGateOptions, findDefects } from './defects.mjs';
import { isShipped, milestones } from './assets.mjs';
import { problem } from './errors.mjs';
import { containedPath, sha256, withLock } from './fsutil.mjs';
import { readInside } from './files.mjs';
import { bareFrame } from './bareframe.mjs';
import { saveRevisions } from './revisions.mjs';
import { renderContactSheet } from './contact-sheet.mjs';
import { SUBMISSIONS_FILE, checkAddress, frameName, loadBytes, submitFrames, validateProvenance } from './submissions.mjs';

export const MAX_CANDIDATES = 6;
const invalid = message => { throw problem(422, 'invalid_input', message); };
const LABELS = 'ABCDEF';

/** The project's reference picture for an asset (pack `references`), as a project-relative path, or null. */
export function referenceFor(pack, assetId) {
  for (const ref of Object.values(pack.references ?? {})) if (typeof ref?.image === 'string' && ref.assets?.includes(assetId)) return ref.image;
  return null;
}

function judge(asset, options, loaded) {
  const [w, h] = asset.size;
  const frames = [];
  let errors = 0, warnings = 0;
  const reasons = [];
  for (const f of loaded) {
    let image = null, problemText = null;
    try { image = decodeRgba(f.bytes); } catch (error) { problemText = `not a readable PNG: ${error.message}`; }
    let found = {counts: {}, totals: {error: 0, warn: 0}};
    if (image && (image.width !== w || image.height !== h)) problemText = `canvas ${image.width}x${image.height} does not match ${w}x${h}`;
    else if (image) found = findDefects(image, options);
    const e = problemText ? 1 : found.totals.error;
    errors += e; warnings += found.totals.warn;
    if (e) reasons.push(`${f.name}: ${problemText ?? Object.entries(found.counts).map(([code, n]) => `${n} ${code}`).join(', ')}`);
    frames.push({name: f.name, errors: e, warnings: found.totals.warn, counts: found.counts, ...(problemText ? {problem: problemText} : {})});
  }
  return {errors, warnings, reasons, frames};
}

/**
 * Submit several candidates. candidates: [{label?, frames: [{clip, direction, n, file|pngBase64}], provenance?}]; every candidate covers the same frames.
 * `provenance` (shared) names the tool and source; a candidate's own provenance overrides fields (its own source hash and prompt).
 * Returns {accepted, run, candidates: [{label, verdict, reason?, revisions?}], ...}. With no survivor nothing is written.
 */
export async function submitCandidates({ws, pack, palette, index, asset, candidates, provenance, note = null, reference, caller, dryRun = false}) {
  const root = ws.root;
  if (!asset.layout?.studioRawDir) throw problem(422, 'unsupported', `${asset.id} (${asset.source}) is not open for frame submission; only design-manifest assets are.`);
  if (isShipped(await milestones(root, asset))) throw problem(409, 'already_processed', `${asset.id} already has processed or packed frames. New work on it goes through revisions, not submission.`);
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > MAX_CANDIDATES) invalid(`candidates must hold 1 to ${MAX_CANDIDATES} candidates`);
  const shared = validateProvenance(provenance, index);
  const labels = candidates.map((c, i) => (typeof c?.label === 'string' && c.label.trim() ? c.label.trim() : LABELS[i]));
  if (labels.some(l => l.length > 24 || !/^[A-Za-z0-9 _.-]+$/.test(l)) || new Set(labels).size !== labels.length) invalid('candidate labels must be unique, 1 to 24 letters, digits, space, dot, dash or underscore');
  if (reference !== undefined && (typeof reference !== 'string' || reference.length > 300 || /\0|\.\.|^\//.test(reference))) invalid('reference must be a project-relative path');
  const ref = reference ?? referenceFor(pack, asset.id);

  const options = assetGateOptions(pack, palette, asset, 'warn');
  let names = null;
  const loaded = [];
  for (const [i, c] of candidates.entries()) {
    if (!c || !Array.isArray(c.frames) || !c.frames.length || c.frames.length > 128) invalid(`candidate ${labels[i]}: frames must hold 1 to 128 frames`);
    const seen = new Set(), mine = [];
    let total = 0;
    for (const f of c.frames) {
      checkAddress(asset, f);
      const name = frameName(f);
      if (seen.has(name)) invalid(`candidate ${labels[i]}: frame ${name} appears twice`);
      seen.add(name);
      const bytes = await loadBytes(root, f);
      total += bytes.length;
      if (total > 4 * 1024 * 1024) invalid(`candidate ${labels[i]} is larger than 4 MiB`);
      mine.push({...f, name, bytes});
    }
    const sig = [...seen].sort().join('\n');
    if (names !== null && sig !== names) invalid(`candidate ${labels[i]} covers different frames than candidate ${labels[0]}: every candidate must cover the same frames`);
    names = sig;
    loaded.push(mine);
  }

  const verdicts = loaded.map((frames, i) => {
    const j = judge(asset, options, frames);
    return {label: labels[i], frames, judged: j, ok: j.errors === 0};
  });
  const survivors = verdicts.filter(v => v.ok);
  const summary = () => verdicts.map(v => ({label: v.label, verdict: v.ok ? 'survivor' : 'rejected', ...(v.ok ? {} : {reason: v.judged.reasons.slice(0, 6).join('; ')}), errors: v.judged.errors, warnings: v.judged.warnings}));
  const generations = candidates.length;
  const base = {generations, candidates: summary(), reference: ref ?? null};
  if (!survivors.length) return {accepted: false, ...base, message: 'Every candidate failed the pixel gates, so nothing was stored. The reasons are listed per candidate; make new candidates.'};

  const dir = asset.layout.studioRawDir;
  const rawOf = name => `${dir}/${name}.png`;
  const fileNames = [...new Set(survivors[0].frames.map(f => f.name))];
  const existing = new Map();
  for (const name of fileNames) {
    try { existing.set(name, await readInside(root, rawOf(name))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (existing.size && existing.size !== fileNames.length) throw problem(409, 'frame_exists', `Some of these frames are already submitted and some are not (${existing.size} of ${fileNames.length}). Submit the missing frames first, then add candidates as takes.`);
  const fresh = existing.size === 0;
  if (dryRun) return {accepted: true, dryRun: true, ...base, wouldStore: survivors.map(v => v.label), wouldWriteRaw: fresh ? fileNames.map(rawOf) : [], note: 'Nothing was written. Survivors would become takes; nothing selected or in use changes.'};

  const run = 'cand-' + randomBytes(4).toString('hex');
  const store = await ws.store();
  const revisions = new Map();
  const provOf = v => ({...shared, ...validateProvenance({...shared, ...(candidates[labels.indexOf(v.label)].provenance ?? {})}, index)});
  let rest = survivors;
  if (fresh) {
    const [first] = survivors;
    const result = await submitFrames({ws, pack, palette, index, asset, frames: candidates[labels.indexOf(first.label)].frames, provenance: provOf(first), caller});
    if (!result.accepted) return {accepted: false, ...base, message: result.report.message, report: result.report};
    revisions.set(first.label, Object.fromEntries(first.frames.map(f => [asset.layout.keyOf(f.clip, f.direction, f.n), 0])));
    rest = survivors.slice(1);
  }
  const lines = [];
  for (const v of rest) {
    const items = v.frames.map(f => ({key: asset.layout.keyOf(f.clip, f.direction, f.n), baseline: existing.get(f.name) ?? f.bytes, png: f.bytes}));
    const saved = await saveRevisions(ws, items);
    revisions.set(v.label, Object.fromEntries(items.map((it, i) => [it.key, saved[i].revision])));
    lines.push(JSON.stringify({at: new Date().toISOString(), agent: caller.agent, session: caller.session, kind: 'take', run, label: v.label, ...provOf(v),
      frames: v.frames.map((f, i) => ({name: f.name, file: rawOf(f.name), sha256: sha256(f.bytes), revision: saved[i].revision, width: asset.size[0], height: asset.size[1]}))}));
  }
  if (lines.length) await withLock(path.join(root, asset.layout.rawDir, SUBMISSIONS_FILE), () => fs.appendFile(containedPath(root, `${asset.layout.rawDir}/${SUBMISSIONS_FILE}`), lines.join('\n') + '\n'));
  (await ws.db()).addCandidateRun({run, asset: asset.id, agent: caller.agent, session: caller.session, note: note ? String(note).slice(0, 600) : null, reference: ref ?? null, generations, tool: shared.tool,
    candidates: verdicts.map(v => ({label: v.label, verdict: v.ok ? 'survivor' : 'rejected', reason: v.ok ? null : v.judged.reasons.slice(0, 6).join('; '), revisions: revisions.get(v.label) ?? null,
      qa: {errors: v.judged.errors, warnings: v.judged.warnings}}))});
  return {accepted: true, run, ...base, candidates: base.candidates.map(c => ({...c, ...(revisions.has(c.label) ? {revisions: revisions.get(c.label)} : {})})),
    status: 'Nothing selected and nothing in use changed. A person picks one candidate in the Review tab.', next: ['studio_review_request to ask the person to pick (it names the run)']};
}

/** What a human sees of runs: each with its candidates and the pick, if any. */
export async function listRuns(ws, filter = {}) { return (await ws.db()).candidateRuns(filter); }

/** One contact sheet of a run's survivors (one row per candidate, one cell per frame). The reference picture is shown beside it by the caller. */
export async function runSheet(ws, run, {scale = 4} = {}) {
  const [r] = (await ws.db()).candidateRuns({run});
  if (!r) throw problem(404, 'unknown_run', `No candidate run ${run}`);
  const store = await ws.store();
  const cells = [];
  for (const c of r.candidates.filter(x => x.verdict === 'survivor' && x.revisions)) {
    let i = 0;
    for (const [key, revision] of Object.entries(c.revisions).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const snap = store.operate(bareFrame(key), Buffer.alloc(0), 'frame', {revision});
      cells.push({clip: c.label, direction: '', n: i++, image: decodeRgba(Buffer.from(snap.pngBase64, 'base64')), defects: [], errors: 0, warnings: 0});
    }
  }
  if (!cells.length) throw problem(409, 'no_survivors', 'This run has no surviving candidate');
  return {run: r, sheet: renderContactSheet(cells, {scale, overlay: false})};
}

/**
 * A person's pick: the chosen candidate's takes become the SELECTED take of each of its frames. Nothing is written to any game file,
 * so "in use" is unchanged; no status is written. Called by the Review tab's route only.
 */
export async function pickCandidate(ws, run, label) {
  const [r] = (await ws.db()).candidateRuns({run});
  if (!r) throw problem(404, 'unknown_run', `No candidate run ${run}`);
  const c = r.candidates.find(x => x.label === label);
  if (!c) throw problem(404, 'unknown_candidate', `Run ${run} has no candidate ${label}`);
  if (c.verdict !== 'survivor' || !c.revisions) throw problem(409, 'rejected_candidate', `Candidate ${label} failed the pixel gates and cannot be picked`);
  const store = await ws.store();
  store.transaction(() => { for (const [key, revision] of Object.entries(c.revisions)) store.operate(bareFrame(key), Buffer.alloc(0), 'select', {revision}); });
  (await ws.db()).recordPick({run, label});
  return {run, label, selected: c.revisions, note: 'Selected only. The files the project uses did not change; that is a separate step.'};
}
