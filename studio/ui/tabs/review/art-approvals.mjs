// Approvals of ART that a human gave outside the studio's own review form (in chat), from a tracked, hash-tied
// project record (`art_approvals.json` in the pack's `directories.approvals`). The tab reads it, never writes it.
//
//   {"schema_version": 1, "approvals": [{"id", "approved_by", "kind"?, "scope"?, "covers"?, "recorded"?, "recorded_by"?,
//     "assets": {"<assetId>": {"frame_dir": "<project-relative dir>", "frames": {"<frame key>": "<sha256 of <frame_dir>/<last key segment>.png>"},
//                              "raw_files"?: {"<path>": "<sha256>"}}},
//     "evidence": {"quote"?, "source"?}}]}
//
// A frame is covered only while its file still hashes to the recorded sha256; anything else is `changed` or `missing`.
import { readJsonIfExists } from '../../../core/files.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHasher } from './hashes.mjs';

// its own cache: the record covers hundreds of frames and must not push the audio masters out of theirs
const hashOf = createHasher(1024);

/**
 * PNG file names (relative to `dir`, recursive) under a project directory, or null when the inventory cannot be trusted:
 * the directory's real path must stay inside the project root, and symlinks inside it are not followed.
 */
export async function pngInventory(root, dir) {
  try {
    const realRoot = await fs.realpath(root), real = await fs.realpath(path.join(root, dir));
    const rel = path.relative(realRoot, real);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
    const out = [];
    const visit = async (abs, prefix) => {
      for (const e of await fs.readdir(abs, {withFileTypes: true})) {
        if (e.isDirectory()) await visit(path.join(abs, e.name), prefix + e.name + '/');
        else if (e.isFile() && e.name.endsWith('.png')) out.push(prefix + e.name);
      }
    };
    await visit(real, '');
    return out.sort();
  } catch { return null; }
}

export const artApprovalsFile = 'art_approvals.json';
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);
const sha = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const dirOk = v => typeof v === 'string' && v.length < 200 && !v.startsWith('/') && !v.includes('..') && !v.includes('\\');
const keyOk = v => /^[A-Za-z0-9_.\/-]{1,200}$/.test(v) && !v.includes('..');

/** [{approvalId, assetId, approvedBy, kind, scope, covers, recorded, recordedBy, evidence, frameDir, frames: [[key, sha]], rawFiles: [[path, sha]]}]; malformed parts are ignored. */
export function parseArtApprovals(data) {
  const out = [];
  for (const a of Array.isArray(data?.approvals) ? data.approvals : []) {
    const id = str(a?.id, 80), by = str(a?.approved_by, 80);
    if (!id || !by || !a.assets || typeof a.assets !== 'object') continue;
    for (const [assetId, info] of Object.entries(a.assets)) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(assetId) || !dirOk(info?.frame_dir)) continue;
      const frames = Object.entries(info.frames ?? {}).filter(([k, v]) => keyOk(k) && sha(v));
      if (!frames.length) continue;
      const rawFiles = Object.entries(info.raw_files ?? {}).filter(([k, v]) => dirOk(k) && sha(v));
      const rawDir = dirOk(info.raw_dir) ? info.raw_dir : null;
      // optional: the asset owns only the files `<frame_prefix>_<n>.png` of a directory shared by several assets (the core effects)
      const framePrefix = typeof info.frame_prefix === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(info.frame_prefix) ? info.frame_prefix : null;
      out.push({approvalId: id, assetId, rawDir, framePrefix, approvedBy: by, kind: str(a.kind, 40) ?? 'owner_statement', scope: str(a.scope, 60) ?? null, covers: str(a.covers, 400) ?? null,
        recorded: str(a.recorded, 40) ?? null, recordedBy: str(a.recorded_by, 200) ?? null,
        evidence: {quote: str(a.evidence?.quote, 400), source: str(a.evidence?.source, 200)}, frameDir: info.frame_dir, frames, rawFiles});
    }
  }
  return out;
}

/** Compare every recorded hash with the file now; `current` is true only when nothing changed or went missing. */
export async function evaluateArtApproval(root, rec) {
  let ok = 0, changed = 0, missing = 0;
  const changedKeys = [];
  for (const [key, expected] of rec.frames) {
    const file = `${rec.frameDir}/${key.split('/').at(-1)}.png`;
    const now = await hashOf(root, file).catch(() => null);
    if (now === null) { missing++; changedKeys.push(key); } else if (now === expected) ok++; else { changed++; changedKeys.push(key); }
  }
  // a frame added to the asset's directory is not covered either: compare the inventory with the record
  const known = new Set(rec.frames.map(([k]) => `${k.split('/').at(-1)}.png`));
  const listed = await pngInventory(root, rec.frameDir);
  const mine = rec.framePrefix ? new RegExp(`^${rec.framePrefix.replace(/[.]/g, '\\.')}_\\d+\\.png$`) : null;
  const added = (listed ?? []).filter(f => (!mine || mine.test(f)) && !known.has(f)).map(f => `${rec.frameDir}/${f}`);
  let unverified = listed === null;
  // the same for the raw files of a character: anything under its raw directory that the record does not list
  if (rec.rawDir) {
    const rawKnown = new Set(rec.rawFiles.map(([p]) => p));
    const rawListed = await pngInventory(root, rec.rawDir);
    if (rawListed === null) unverified = true; else added.push(...rawListed.map(f => `${rec.rawDir}/${f}`).filter(p => !rawKnown.has(p)));
  }
  let rawChanged = 0;
  for (const [file, expected] of rec.rawFiles) if ((await hashOf(root, file).catch(() => null)) !== expected) rawChanged++;
  return {assetId: rec.assetId, approvalId: rec.approvalId, approvedBy: rec.approvedBy, kind: rec.kind, scope: rec.scope, covers: rec.covers, recorded: rec.recorded,
    recordedBy: rec.recordedBy, evidence: rec.evidence, frames: rec.frames.length, matching: ok, changed, missing, rawFiles: rec.rawFiles.length, rawChanged,
    added: added.length, addedFiles: added.slice(0, 20), unverified,
    current: changed === 0 && missing === 0 && rawChanged === 0 && added.length === 0 && !unverified, changedKeys: changedKeys.slice(0, 20)};
}

export async function readArtApprovals(root, dir) {
  if (!dir) return [];
  try {
    const records = parseArtApprovals(await readJsonIfExists(root, `${dir.replace(/\/+$/, '')}/${artApprovalsFile}`));
    return await Promise.all(records.map(r => evaluateArtApproval(root, r)));
  } catch { return []; }
}
