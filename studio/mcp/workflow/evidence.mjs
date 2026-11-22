// Evidence expires. A QA result, an independent check and a review request are tied to the hashes of what they looked at:
// the frames, the source sheets, and the contact sheet the checker was shown. Changing any of them marks the evidence stale,
// and it must be gathered again. Everything here is a pure comparison of recorded and current hashes.
import { readImports } from './forge.mjs';

/** The hashes of what an asset is made of now: frames (given), sheets (forge imports), and the contact sheet a session last looked at. */
export async function gather(ws, asset, { stage, content, session = null }) {
  const evidence = { stage, frames: content };
  if (asset.layout?.studioRawDir) {
    const docs = await readImports(ws, asset);
    const sheets = Object.fromEntries(Object.entries(docs).filter(([, d]) => d).map(([slot, d]) => [slot, d.sheet.sha256.slice(0, 16)]));
    if (Object.keys(sheets).length) evidence.sheets = sheets;
  }
  if (session) {
    const look = (await ws.db()).lastLook(asset.id, session);
    if (look && look.content === content) evidence.contact = { image: look.image, frames: look.content };
  }
  return evidence;
}

/** Why recorded evidence no longer holds against `now` (empty when it is current). Legacy evidence (no record) is judged on frames alone by the caller. */
export function staleReasons(recorded, now) {
  if (!recorded) return [];
  const out = [];
  if (recorded.frames !== undefined && recorded.frames !== now.frames) out.push({ what: 'frames', why: 'the frames changed after this was recorded' });
  if (recorded.sheets) {
    for (const slot of new Set([...Object.keys(recorded.sheets), ...Object.keys(now.sheets ?? {})])) {
      if (recorded.sheets[slot] !== now.sheets?.[slot]) out.push({ what: `${slot} sheet`, why: `the ${slot} source sheet changed (${recorded.sheets[slot] ?? 'none'} then, ${now.sheets?.[slot] ?? 'none'} now)` });
    }
  }
  if (recorded.contact && recorded.contact.frames !== now.frames) out.push({ what: 'contact sheet', why: 'the contact sheet that was looked at shows frames that have changed' });
  return out;
}

export const evidenceView = (recorded, now) => {
  const stale = staleReasons(recorded, now);
  return { recorded: recorded ?? null, current: stale.length === 0, ...(stale.length ? { stale } : {}) };
};
