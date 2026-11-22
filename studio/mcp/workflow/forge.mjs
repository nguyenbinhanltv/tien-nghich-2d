// The forge as the tools use it. A forge job is a pure function of a few small DOCUMENTS that live
// beside the asset's raw frames and are tracked by git:
//
//   <raw>/<id>/forge/sheets/<sha16>.png   the drawn sheet, written once, never changed
//   <raw>/<id>/forge/import.json          which sheet, which layout, the verbatim prompt, who imported it
//   <raw>/<id>/forge/process.json         marks (asymmetric colours kept through pixelisation)
//   <raw>/<id>/forge/rig.json             the part rig (rig clips)
//   <raw>/<id>/forge/poseclips.json       pose-sheet clips (drawn key poses)
//   <raw>/<id>/forge/patch.json           stored pixel operations, applied after every bake
//
// Nothing is cached between calls: import and pixelise are re-run from those files, so a step never
// depends on a scratch directory that a cleanup could remove, and the same documents always give the
// same frames. Intermediate images (previews, bake directories) go to the git-ignored work directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from '../registry.mjs';
import { containedPath, ensureDirInside, readTextIfExists, sha256, withLock, writeFileAtomic } from '../../core/fsutil.mjs';
import { decodePng, importSheet, normalizeLayout, pixelizeImport, resolveMarks, rigPalette, settingsFromPack } from '../../forge/index.mjs';

export const MAX_SHEET_BYTES = 16 * 1024 * 1024;
export const MAX_DOC_BYTES = 256 * 1024;
export const DOCS = ['import', 'process', 'rig', 'poseclips', 'patch'];

export const forgeDir = (asset) => `${asset.layout.rawDir}/forge`;
const docRel = (asset, name) => `${forgeDir(asset)}/${name}.json`;

/** Forge errors say what is wrong; show them as tool errors. Programming errors stay internal. */
export async function forgeCall(fn) {
  try { return await fn(); }
  catch (error) {
    if (error instanceof ToolError || error?.status || error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) throw error;
    throw new ToolError(error?.message ?? String(error));
  }
}

export async function readDoc(ws, asset, name) {
  const text = await readTextIfExists(containedPath(ws.root, docRel(asset, name)));
  if (text === null) return null;
  try { return JSON.parse(text); }
  catch { throw new ToolError(`${docRel(asset, name)} is not valid JSON; it was edited by hand. Fix or remove it.`); }
}

/** Write a tracked document atomically. Returns {rel, sha256}. */
export async function writeDoc(ws, asset, name, doc) {
  const text = JSON.stringify(doc, null, 2) + '\n';
  if (text.length > MAX_DOC_BYTES) throw new ToolError(`${name} document is ${text.length} bytes; the limit is ${MAX_DOC_BYTES}`);
  const rel = docRel(asset, name);
  await ensureDirInside(ws.root, forgeDir(asset));
  await withLock(path.join(ws.root, rel), () => writeFileAtomic(path.join(ws.root, rel), text));
  return { rel, sha256: sha256(text) };
}

/** Read, change and write a tracked document under its lock, so concurrent edits of different fields both survive. */
export async function updateDoc(ws, asset, name, change) {
  const rel = docRel(asset, name);
  await ensureDirInside(ws.root, forgeDir(asset));
  return withLock(path.join(ws.root, rel), async () => {
    const next = change(await readDoc(ws, asset, name));
    const text = JSON.stringify(next, null, 2) + '\n';
    if (text.length > MAX_DOC_BYTES) throw new ToolError(`${name} document is ${text.length} bytes; the limit is ${MAX_DOC_BYTES}`);
    await writeFileAtomic(path.join(ws.root, rel), text);
    return { rel, sha256: sha256(text) };
  });
}

/** Store a drawn sheet by content hash. Written once; identical content is a no-op. */
export async function storeSheet(ws, asset, bytes) {
  const hash = sha256(bytes);
  const rel = `${forgeDir(asset)}/sheets/${hash.slice(0, 16)}.png`;
  await ensureDirInside(ws.root, `${forgeDir(asset)}/sheets`);
  try { await fs.writeFile(containedPath(ws.root, rel), bytes, { flag: 'wx', mode: 0o644 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (sha256(await fs.readFile(containedPath(ws.root, rel))) !== hash) throw new ToolError(`${rel} exists with different bytes (a hash-prefix collision or tampering); nothing was written.`);
  }
  return { rel, sha256: hash };
}

/** Forge settings for an asset: its manifest profile, or the sizes and clips of a custom plan. */
export async function settingsFor(snap, ws, asset) {
  if (!asset.layout?.studioRawDir) throw new ToolError(`${asset.id} (${asset.source}) is not open for forge work; only design-manifest assets are.`);
  const settings = await settingsFromPack(snap.pack, ws.root, asset.profile && asset.profile !== 'custom'
    ? asset.profile
    : { name: asset.id, nativePx: asset.size, pivotPx: asset.pivot ?? [Math.floor(asset.size[0] / 2), asset.size[1] - 3], directions: asset.directions });
  settings.profile.clips ??= Object.fromEntries(Object.entries(asset.clips ?? {}).map(([c, v]) => [c, [v.frames, v.frameMs ?? 100]]));
  settings.profile.directions ??= asset.directions;
  return { settings, palette: rigPalette(settings) };
}

/** Re-run the import from the tracked sheet and layout. Null when no sheet has been imported yet. */
export async function importedFor(ws, asset, settings) {
  const doc = await readDoc(ws, asset, 'import');
  if (!doc) return null;
  const bytes = await fs.readFile(containedPath(ws.root, doc.sheet.file));
  if (sha256(bytes) !== doc.sheet.sha256) throw new ToolError(`${doc.sheet.file} no longer matches its recorded hash; the stored sheet was altered.`);
  const imported = importSheet({ layout: normalizeLayout(doc.layout), sheet: decodePng(bytes), sheetBytes: bytes, source: path.basename(doc.sheet.file),
    prompt: doc.prompt, profile: settings.profile, scaleOptions: doc.scaleOptions });
  return { doc, imported };
}

/** Import, then pixelise with the stored marks. */
export async function pixelizedFor(ws, asset, settings, { poseClips } = {}) {
  const base = await importedFor(ws, asset, settings);
  if (!base) throw new ToolError(`${asset.id} has no imported sheet. Call studio_sheet_import first.`);
  const processDoc = (await readDoc(ws, asset, 'process')) ?? { marks: [] };
  const pixelized = pixelizeImport(base.imported, settings, { marks: resolveMarks(processDoc.marks ?? [], settings.palette), hold: processDoc.hold, poseClips: poseClips ?? (await readDoc(ws, asset, 'poseclips')) ?? undefined });
  return { ...base, processDoc, pixelized };
}

/** Where scratch output for an asset goes (git-ignored, safe to delete). */
export const workDir = (ws, asset, ...parts) => path.join(ws.libraryDir(), 'work', asset.id, ...parts);

/**
 * A private scratch directory for ONE call (<work>/<asset>/<kind>/<unique>), so overlapping calls on the same asset
 * (background jobs, several sessions) never delete or read each other's output. Directories of earlier calls stay
 * (a result points at its own review images) and are pruned once older than ten minutes.
 */
export async function callDir(ws, asset, kind) {
  const parent = workDir(ws, asset, kind);
  await fs.mkdir(parent, { recursive: true });
  const now = Date.now();
  for (const e of await fs.readdir(parent, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    const full = path.join(parent, e.name);
    const st = await fs.stat(full).catch(() => null);
    if (st && now - st.mtimeMs > 10 * 60 * 1000) await fs.rm(full, { recursive: true, force: true }).catch(() => {});
  }
  return fs.mkdtemp(path.join(parent, 'call-'));
}

/** Project-relative path when inside the project, else absolute. */
export const shown = (ws, abs) => { const rel = path.relative(ws.root, abs); return rel.startsWith('..') || path.isAbsolute(rel) ? abs : rel; };

/** `<clip>_<direction>_<n>` -> {clip, direction, n}, or null. */
export function parseFrameName(name) {
  const m = /^(?<clip>[a-z0-9]+(?:_[a-z0-9]+)*)_(?<direction>south|east|north|west|none|f\d+)_(?<n>\d+)$/.exec(name);
  return m ? { clip: m.groups.clip, direction: m.groups.direction, n: Number(m.groups.n) } : null;
}

/** Default pose names for a locomotion clip of `count` keys (contact/passing alternate by side). */
export function defaultPoseNames(count) {
  if (count === 4) return ['contact_a', 'passing_a', 'contact_b', 'passing_b'];
  if (count === 6) return ['contact_a', 'down_a', 'passing_a', 'contact_b', 'down_b', 'passing_b'];
  return Array.from({ length: count }, (_, i) => `key_${i}`);
}

/**
 * Which route fits a clip. The bake-off (docs/FORGE_BAKEOFF.md) decided: drawn key poses from a pose sheet
 * for locomotion, the rig for idle and other small motion, pixel patches to keep asymmetric marks, and a
 * plain sheet cell for a single static frame. `archetype` is the motion template's archetype, if there is one.
 */
export function routeFor(clip, frames, archetype) {
  if (frames === 1) return { route: 'sheet', why: 'a single frame: draw it on the sheet and pixelise it' };
  if (archetype === 'locomote') return { route: 'pose-sheet', why: 'locomotion: draw key poses on a pose sheet (fuller stride, visible weight shift); give them to studio_rig_bake as poseClips, optionally with secondary motion' };
  if (archetype === 'idle') return { route: 'rig', why: 'idle: a rig with a motion template keeps identity stable; use studio_frame_patch to keep asymmetric marks' };
  if (archetype) return { route: 'rig', why: `a ${archetype} motion: bake it from the rig; if it must look drawn, use a pose sheet instead` };
  return { route: 'pose-sheet', why: 'no motion template for this clip: draw its key poses on a pose sheet' };
}
