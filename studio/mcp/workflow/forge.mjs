// The forge as the tools use it. A forge job is a pure function of a few small DOCUMENTS that live
// beside the asset's raw frames and are tracked by git:
//
//   <raw>/<id>/forge/sheets/<sha16>.png   the drawn sheet, written once, never changed
//   <raw>/<id>/forge/import.json          the TURNAROUND sheet (rig clips): which sheet, which layout, the verbatim prompt, who imported it
//   <raw>/<id>/forge/import.pose.json     the POSE sheet (clips from drawn key poses): same fields. One slot per kind of sheet,
//                                         so a character can have both; marks (process.json) are shared by both
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
export const DOCS = ['import', 'import.pose', 'process', 'rig', 'poseclips', 'patch'];

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

/** Which slot a layout belongs to: a sheet whose cells carry poses is a pose sheet, anything else a turnaround (rig). */
export const slotOfLayout = (layout) => ((layout?.cells ?? []).some((c) => c.pose) ? 'pose' : 'rig');
export const importName = (slot) => (slot === 'pose' ? 'import.pose' : 'import');
export const SLOTS = ['rig', 'pose'];

/** The import documents of an asset by slot. A legacy import.json that holds a pose sheet is read as the pose slot. */
export async function readImports(ws, asset) {
  const out = { rig: null, pose: null };
  // The dedicated pose file always wins; import.json is the turnaround, or a legacy pose sheet only when import.pose.json is absent.
  out.pose = await readDoc(ws, asset, 'import.pose');
  const main = await readDoc(ws, asset, 'import');
  if (main) { const slot = slotOfLayout(main.layout); if (slot === 'rig') out.rig = main; else if (!out.pose) out.pose = main; }
  return out;
}

/** Store an import in its slot. Returns the document it replaced (same slot), or null. */
export async function writeImport(ws, asset, doc, slot) {
  const current = await readImports(ws, asset);
  // A legacy import.json holding a pose sheet moves to its own file so the turnaround can take import.json.
  if (slot === 'rig' && current.pose && (await readDoc(ws, asset, 'import')) === null) { /* already under import.pose.json */ }
  else if (slot === 'rig' && current.pose && !(await readDoc(ws, asset, 'import.pose'))) await writeDoc(ws, asset, 'import.pose', current.pose);
  await writeDoc(ws, asset, importName(slot), doc);
  return current[slot];
}

async function runImport(ws, asset, settings, doc) {
  const bytes = await fs.readFile(containedPath(ws.root, doc.sheet.file));
  if (sha256(bytes) !== doc.sheet.sha256) throw new ToolError(`${doc.sheet.file} no longer matches its recorded hash; the stored sheet was altered.`);
  return importSheet({ layout: normalizeLayout(doc.layout), sheet: decodePng(bytes), sheetBytes: bytes, source: path.basename(doc.sheet.file),
    prompt: doc.prompt, profile: settings.profile, scaleOptions: doc.scaleOptions });
}

/**
 * Re-run every stored import and pixelise it with the stored marks (shared by both sheets). The cells of the two slots
 * are merged into one map (their ids never collide: facings against "<pose>_<facing>"); `slots` keeps each sheet's own
 * document and result so a step can credit frames to the sheet they came from. `doc` is the primary document (the
 * turnaround if there is one) for steps that need only one.
 */
export async function pixelizedFor(ws, asset, settings, { only, poseClips } = {}) {
  const docs = await readImports(ws, asset);
  const slots = [];
  for (const slot of SLOTS) {
    if (!docs[slot] || (only && only !== slot)) continue;
    slots.push({ slot, doc: docs[slot], imported: await runImport(ws, asset, settings, docs[slot]) });
  }
  if (!slots.length) throw new ToolError(only && (docs.rig || docs.pose) ? `${asset.id} has no ${only === 'pose' ? 'pose sheet' : 'turnaround'} imported. Call studio_sheet_import with a ${only === 'pose' ? 'pose-sheet' : 'turnaround'} layout.` : `${asset.id} has no imported sheet. Call studio_sheet_import first.`);
  const processDoc = (await readDoc(ws, asset, 'process')) ?? { marks: [] };
  const marks = resolveMarks(processDoc.marks ?? [], settings.palette);
  const clips = poseClips ?? (await readDoc(ws, asset, 'poseclips')) ?? undefined; // the hold follows each clip's own keys and loop flag
  const cells = new Map(), records = [];
  for (const s of slots) {
    s.pixelized = pixelizeImport(s.imported, settings, { marks, hold: processDoc.hold, poseClips: clips });
    for (const [id, c] of s.pixelized.cells) {
      if (cells.has(id)) throw new ToolError(`the turnaround and the pose sheet both have a cell "${id}"; rename cells in one layout.`);
      cells.set(id, c);
    }
    records.push(s.pixelized.record);
  }
  const primary = slots[0];
  const pixelized = { cells, record: { ...primary.pixelized.record, cells: records.flatMap((r) => r.cells) } };
  return { doc: primary.doc, imported: primary.imported, slots, processDoc, pixelized };
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

/**
 * The document formats the forge tools take, in one compact block, so an agent does not have to read source to build them.
 * `bodyPlans` is the body-plan table of the shipped motion library (roles and what they need).
 */
export function formatsGuide(bodyPlans, { nativePx, pivotPx }) {
  return {
    rig: {
      use: 'studio_rig_bake rig (idle and small motions). Full reference: studio/forge/rig/README.md',
      shape: { schema: 'studio.rig', version: 1, id: '<asset id>', bodyPlan: Object.keys(bodyPlans).join(' | '), canvas: nativePx, pivot: pivotPx,
        facings: { '<facing>': { forward: '[dx,dy] unit screen direction of travel', parts: '[{id, role, cut:[[x,y]..], remove:[[x,y]..], joint?:[x,y], contact?:[x,y], phase?:0|1, swing?}] back to front, the body plate LAST (it has no polygons)',
          landmarks: '[{id, color:<palette id>, box:[x0,y0,x1,y1], follows?:<part id>, expect?:"absent"}] optional: asymmetric marks, judged by the mark-side gate', features: 'optional' },
        '<other facing>': { mirrorOf: '<facing>', swapColors: { '<id>': '<id>' } } } },
      rules: ['canvas and pivot must equal the profile above', 'coordinates are native pixels, zero-based from the top left of the PIXELISED figure (studio_process shows it); a box is half-open [x0,y0,x1,y1)',
        'cut lifts a part out of the sprite, remove clears it from the body plate; cut is normally a little larger than remove (the overlap hides gaps when the part moves)',
        'limb/leg parts need a contact pixel inside their cut; rotating roles (tail, head, ear, arm) need a joint'],
      bodyPlans: Object.fromEntries(Object.entries(bodyPlans).map(([name, plan]) => [name, Object.fromEntries(Object.entries(plan.roles ?? {}).map(([role, r]) => [role, [r.required ? 'required' : 'optional', r.contact ? 'needs contact' : null, r.rotates ? 'needs joint' : null].filter(Boolean).join(', ')]))])),
    },
    poseClips: {
      use: 'studio_rig_bake poseClips (locomotion from drawn key poses). The skeleton for the clip you asked for is in this result as poseClips.',
      shape: { schema: 'forge.poseclips', version: 1, clips: { '<clip>': { keys: ['<pose per frame>'], facings: ['<facing>'], loop: true,
        contacts: 'optional {<facing>: [[{id, xy:[x,y], planted:true}] per key]}: planted contacts TURN ON the foot-slide gate',
        landmarks: 'optional {<facing>: [{id, color, box}]}: turns ON the mark-side gate for this clip', qa: 'optional gate options for this clip, e.g. {flicker:{maxPixels:60}}',
        secondary: 'optional {template:"idle"}: rig motion layered on top (needs a rig)' } } },
      rules: ['the cell for key <pose> of facing <f> is the layout cell "<pose>_<f>" (they come from the pose sheet template)', 'keys needs exactly as many names as the clip has frames; a pose name may repeat (stand, step_a, stand, step_b)'],
    },
    twoSheets: 'A character may have both a turnaround (rig clips) and a pose sheet (pose clips): import each (they keep separate slots), then studio_rig_bake with rig AND poseClips in one call. Each frame is credited to the sheet it came from.',
  };
}
