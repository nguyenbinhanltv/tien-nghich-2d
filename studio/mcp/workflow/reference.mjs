// Style-locked entities: the pack names an approved image and a description paragraph for an asset (or a family of assets).
import { createHash } from 'node:crypto';
import { readInside } from '../../core/files.mjs';
import { ToolError } from '../registry.mjs';

/** {name, ...entry} of the locked reference that covers `assetId`, or null. */
export function referenceFor(pack, assetId) {
  for (const [name, r] of Object.entries(pack.references ?? {})) if (r.assets.includes(assetId)) return { ...r, name };
  return null;
}

/** The approved image's bytes, refusing a file that no longer matches the hash the pack locked. */
export async function referenceImage(ws, ref) {
  let bytes;
  try { bytes = await readInside(ws.root, ref.image); }
  catch { throw new ToolError(`The locked reference image ${ref.image} for ${ref.name} is missing. The pack (references.${ref.name}) names it; restore it or ask a human to change the pack.`); }
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (sha !== ref.sha256) throw new ToolError(`The locked reference image ${ref.image} changed: its sha256 is ${sha.slice(0, 12)}..., the pack locked ${ref.sha256.slice(0, 12)}.... A reference is changed only by a human, in the pack.`);
  return bytes;
}

/** The short record kept in provenance and import documents. */
export const referenceRecord = (ref, verbatim) => ({ name: ref.name, sha256: ref.sha256, descriptionSha256: createHash('sha256').update(ref.description).digest('hex'), verbatim });
