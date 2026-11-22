// Saving a new revision of a frame. This is how an agent changes pixels that were submitted: the raw
// file stays as it was, the new pixels become revision N+1 in the revision store, and the revision
// starts pending like every revision. Nothing here can approve, reject or reopen anything: it passes no
// status, and the store gives a new revision the default status (pending).
import { bareFrame } from './review.mjs';

/**
 * Save several frames' new revisions all-or-nothing. items: [{key, baseline, png, baseRevision?, provenance?}] (`provenance`, a plain object saying where the pixels came from, is stored with the new revision; nothing else can ride along, so no save can carry a decision). The checks and the saves run in one
 * synchronous stretch (the store is synchronous), so no other save can land between them: if any frame's head is not the revision its
 * pixels were computed from, NOTHING is saved and the first such item is named in the error.
 */
export async function saveRevisions(ws, items) {
  if (!items.length) return [];
  const store = await ws.store();
  // One SQLite write transaction holds across every head check and every insert: a failure on any frame (a conflict, a database error) rolls back all of them.
  return store.transaction(() => {
    const heads = items.map(({key, baseline}) => store.operate(bareFrame(key), baseline, 'frame', {}).head);
    items.forEach(({key, baseRevision}, i) => {
      if (baseRevision !== undefined && baseRevision !== heads[i]) throw Object.assign(new Error('Reload the current revision'), {status: 409, code: 'revision_conflict', head: heads[i], key, index: i});
    });
    return items.map(({key, baseline, png, baseRevision, provenance}, i) => {
      const snap = store.operate(bareFrame(key), baseline, 'save', {baseRevision: baseRevision ?? heads[i], png, ...(provenance ? {metadata: {provenance}} : {})});
      return {revision: snap.revision, head: snap.head, changed: snap.head > heads[i], status: snap.status, previous: heads[i]};
    });
  });
}

/**
 * Save one frame's new revision (the original contract: `{key, baseline, png}`, optional `baseRevision`). Returns
 * {revision, head, changed, status, previous}. A save identical to the head is a no-op. It is saveRevisions with one item.
 */
export async function saveRevision(ws, item) {
  return (await saveRevisions(ws, [item]))[0];
}

/** The pixels of a frame's newest revision as PNG bytes, or null when it has no history. */
export async function headPng(ws, key, baseline) {
  const store = await ws.store();
  if (store.needsBaseline(key)) return null;
  return Buffer.from(store.operate(bareFrame(key), baseline, 'frame', {}).pngBase64, 'base64');
}
