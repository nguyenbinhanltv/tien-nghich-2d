// The art-bible version stamp (C4). The project's drawing rules (the palette, the outline and alpha rule, the size classes and the
// figure proportions) are hashed into one short version. New work records the version it was made under; when the rules change,
// every stamped asset made under an older version counts as stale. This only COUNTS: nothing is regenerated unless a person asks,
// and an asset with no stamp (made before stamps existed, approved or not) is reported as unstamped, never as stale, and its
// records are never rewritten (an approval is tied to the bytes of the files, which a stamp never touches).
import { createHash } from 'node:crypto';
import { readTextIfExists } from './fsutil.mjs';
import path from 'node:path';
import { SUBMISSIONS_FILE } from './submissions.mjs';

const canonical = v => (Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));
const short = v => createHash('sha256').update(canonical(v)).digest('hex').slice(0, 12);

/** {version, parts}: `version` changes when any part changes; `parts` says which part. `palette` is parsePalette()'s result. */
export function rulesVersion(pack, palette) {
  const parts = {
    palette: short([...palette.colors].sort((a, b) => a - b)),
    outline: short({outline: pack.rules?.outline ?? null, alpha: pack.rules?.alpha ?? null, paletteOutline: palette.outline ?? null}),
    sizeClasses: short(pack.sizeClasses ?? null),
    proportions: short(pack.figures ?? null),
  };
  return {version: 'rules-' + short(parts), parts};
}

/** What a new record carries. */
export const stampOf = (pack, palette) => { const {version, parts} = rulesVersion(pack, palette); return {version, parts}; };

/** Which parts changed between two stamps (names). */
export const changedParts = (then, now) => Object.keys(now).filter(k => then?.[k] !== now[k]);

/**
 * Count the assets by stamp: current (stamped under today's rules), stale (stamped under an older version) and unstamped.
 * The latest stamped submission record of an asset decides. Read-only.
 */
export async function rulesReport({root, pack, palette, index}) {
  const now = rulesVersion(pack, palette);
  const assets = [];
  for (const asset of index.assets.values()) {
    const rawDir = asset.layout?.rawDir;
    let stamp = null;
    if (rawDir) {
      const text = await readTextIfExists(path.join(root, rawDir, SUBMISSIONS_FILE)).catch(() => null);
      for (const line of (text ?? '').split('\n').filter(Boolean)) {
        try { const r = JSON.parse(line); if (r.rules?.version) stamp = r.rules; } catch { /* a corrupt line is reported by the submissions reader */ }
      }
    }
    assets.push({id: asset.id, state: !stamp ? 'unstamped' : stamp.version === now.version ? 'current' : 'stale', version: stamp?.version ?? null,
      ...(stamp && stamp.version !== now.version ? {changed: changedParts(stamp.parts, now.parts)} : {})});
  }
  const count = state => assets.filter(a => a.state === state).length;
  return {version: now.version, parts: now.parts, total: assets.length, current: count('current'), stale: count('stale'), unstamped: count('unstamped'),
    staleAssets: assets.filter(a => a.state === 'stale').map(a => a.id), assets,
    note: 'Stale means the asset was stamped under an older version of the rules. Nothing is regenerated unless a person asks. Unstamped assets were made before stamps existed; they are not stale and their records are untouched.'};
}
