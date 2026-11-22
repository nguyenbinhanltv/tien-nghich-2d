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
      out.push({approvalId: id, assetId, approvedBy: by, kind: str(a.kind, 40) ?? 'owner_statement', scope: str(a.scope, 60) ?? null, covers: str(a.covers, 400) ?? null,
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
  const added = (await fs.readdir(path.join(root, rec.frameDir)).catch(() => [])).filter(f => f.endsWith('.png') && !known.has(f)).sort();
  let rawChanged = 0;
  for (const [file, expected] of rec.rawFiles) if ((await hashOf(root, file).catch(() => null)) !== expected) rawChanged++;
  return {assetId: rec.assetId, approvalId: rec.approvalId, approvedBy: rec.approvedBy, kind: rec.kind, scope: rec.scope, covers: rec.covers, recorded: rec.recorded,
    recordedBy: rec.recordedBy, evidence: rec.evidence, frames: rec.frames.length, matching: ok, changed, missing, rawFiles: rec.rawFiles.length, rawChanged,
    added: added.length, addedFiles: added.slice(0, 20),
    current: changed === 0 && missing === 0 && rawChanged === 0 && added.length === 0, changedKeys: changedKeys.slice(0, 20)};
}

export async function readArtApprovals(root, dir) {
  if (!dir) return [];
  try {
    const records = parseArtApprovals(await readJsonIfExists(root, `${dir.replace(/\/+$/, '')}/${artApprovalsFile}`));
    return await Promise.all(records.map(r => evaluateArtApproval(root, r)));
  } catch { return []; }
}
