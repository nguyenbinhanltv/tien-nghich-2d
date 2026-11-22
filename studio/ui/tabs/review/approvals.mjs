// Listening approvals that predate the studio, from a tracked project record next to the audio masters
// (`listening_approvals.json` in the audio-plan source's `evidence.masters` directory). The tab reads it,
// never writes it, and shows it as "approved before the studio", distinct from a sign-off made here.
//
//   {"schema_version": 1, "approvals": [{"id", "approved_by", "recorded": "<date as recorded>" | null,
//     "assets": {"<assetId>": {"master_sha256"?: "<64 hex>"}} | ["<assetId>", ...],
//     "evidence": {"quote"?, "source"?, "pr"?}}]}
//
// An asset entry with `master_sha256` covers only that master; without it, whatever master exists.
import { readJsonIfExists } from '../../../core/files.mjs';

export const approvalsFile = 'listening_approvals.json';
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : undefined);

/** {assetId: {approvalId, approvedBy, recorded, evidence, content?}} from the record; malformed parts are ignored. */
export function parseApprovals(data) {
  const out = {};
  for (const a of Array.isArray(data?.approvals) ? data.approvals : []) {
    const id = str(a?.id, 80), by = str(a?.approved_by, 80);
    if (!id || !by) continue;
    const list = Array.isArray(a.assets) ? Object.fromEntries(a.assets.map(x => [x, {}])) : a.assets && typeof a.assets === 'object' ? a.assets : {};
    for (const [asset, info] of Object.entries(list)) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(asset)) continue;
      const sha = info?.master_sha256;
      out[asset] = {approvalId: id, approvedBy: by, recorded: str(a.recorded, 40) ?? null,
        evidence: {quote: str(a.evidence?.quote, 400), source: str(a.evidence?.source, 200), pr: str(a.evidence?.pr, 200)},
        ...(typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha) ? {content: sha} : {})};
    }
  }
  return out;
}

export async function readApprovals(root, mastersDir) {
  if (!mastersDir) return {};
  try { return parseApprovals(await readJsonIfExists(root, `${mastersDir.replace(/\/+$/, '')}/${approvalsFile}`)); }
  catch { return {}; }
}
