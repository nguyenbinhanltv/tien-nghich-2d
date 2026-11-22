// Saving a new revision of a frame. This is how an agent changes pixels that were submitted: the raw
// file stays as it was, the new pixels become revision N+1 in the revision store, and the revision
// starts pending like every revision. Nothing here can approve, reject or reopen anything: it passes no
// status, and the store gives a new revision the default status (pending).
import { bareFrame } from './review.mjs';

/**
 * `key`: the frame key; `baseline`: bytes of the frame as submitted (used only if the key has no history yet);
 * `png`: the new pixels as PNG bytes. Returns {revision, head, changed, status}. A save identical to the head is a no-op.
 */
export async function saveRevision(ws, {key, baseline, png}) {
  const store = await ws.store();
  const head = store.operate(bareFrame(key), baseline, 'frame', {});
  const snap = store.operate(bareFrame(key), baseline, 'save', {baseRevision: head.head, png});
  return {revision: snap.revision, head: snap.head, changed: snap.head > head.head, status: snap.status, previous: head.head};
}

/** The pixels of a frame's newest revision as PNG bytes, or null when it has no history. */
export async function headPng(ws, key, baseline) {
  const store = await ws.store();
  if (store.needsBaseline(key)) return null;
  return Buffer.from(store.operate(bareFrame(key), baseline, 'frame', {}).pngBase64, 'base64');
}
