/** Local bridge for the Python atlas tools. The HTTP server never invokes promotion. */
import { isDeepStrictEqual } from 'node:util';
import { loadCatalog } from './editor-catalog.mjs';

const [root,key,library,number] = process.argv.slice(2);
const catalog = await loadCatalog(root);
if (!key) {
  process.stdout.write(JSON.stringify(catalog.overlays));
} else {
  const frame = catalog.frames.get(key);
  if (!frame || frame.processed !== 'assets/processed/'+key+'.png') throw new Error('Unknown canonical frame');
  if (frame.publish.mode === 'none') throw new Error('This category cannot be published into the atlases yet: '+frame.publish.reason);
  const { revisionStore } = await import('./editor-store.mjs');
  const store = revisionStore(root, library);
  try {
    const baseline = await catalog.baseline(frame);
    const snapshot = revision => store.operate(frame, baseline, 'frame', {revision});
    const head = snapshot();
    if (head.revision !== Number(number)) throw new Error('Stale or missing revision; head is '+head.revision);
    if (head.status !== 'approved') throw new Error('Exact revision requires approval');
    const sourceStamp = store.origin(key);
    if (!sourceStamp) throw new Error('Legacy origin is unpinned; approve this revision again in the Inspector');
    const entry = {revision:head.revision,sourceStamp,pngBase64:head.pngBase64,metadata:head.metadata};
    catalog.validateOverlay(key,entry);
    const matchesShared = snap => baseline.toString('base64') === snap.pngBase64 &&
      isDeepStrictEqual(snap.metadata,frame.metadata);
    const previous = catalog.overlays[key];
    if (!matchesShared(snapshot(0)) && !(previous && previous.revision <= head.revision &&
        matchesShared(snapshot(previous.revision)))) throw new Error('Local history disagrees with shared inputs');
    process.stdout.write(JSON.stringify(entry));
  } finally { store.close(); }
}
