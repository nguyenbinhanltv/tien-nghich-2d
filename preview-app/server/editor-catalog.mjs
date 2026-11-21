import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { normalizePng } from './editor-png.mjs';

export function problem(status, code, message, head) {
  return Object.assign(new Error(message), {status, code, head});
}

async function readInside(root, relative) {
  const real = await fs.realpath(path.join(root, relative));
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) {
    throw problem(500, 'catalog_error', 'Catalog input is outside the library');
  }
  return fs.readFile(real);
}

export async function loadCatalog(root) {
  root = await fs.realpath(root);
  const json = async file => JSON.parse(await readInside(root, file));
  const manifest = await json('assets/manifest.json');
  const palette = new Set((await json('tools/generators/palette.json')).colors.map(c => parseInt(c.hex.slice(1), 16)));
  const frames = new Map();
  function add(key, assetId, category, size, source, processed, metadata) {
    if (!/^[a-z0-9_]+$/.test(assetId) || frames.has(key)) throw new Error('Invalid editor catalog');
    const [width, height] = size;
    frames.set(key, {info: {key, assetId, category, width, height, sourceUrl:'/'+source, processedUrl:'/'+processed,
      editableFields:Object.keys(metadata)}, metadata, processed});
  }
  for (const a of manifest.assets.filter(a => a.category === 'ui')) {
    for (const [clip, {frames: count}] of Object.entries(a.animations)) {
      for (let n=0; n<count; n++) {
        const key = 'ui/'+a.id+'/'+clip+'_none_'+n;
        add(key, a.id, 'ui', a.size, a.output_path+a.id+'_'+clip+'_'+n+'.png', 'assets/processed/'+key+'.png',
          {pivot:a.size.map(v=>Math.floor(v/2))});
      }
    }
  }
  const effects = (await json(manifest.delivery.vfx_index)).effects;
  for (const effect of effects) {
    const desc = await json(effect.descriptor);
    for (const [n, frame] of desc.frames.entries()) {
      add('vfx/'+effect.id+'_'+n, effect.id, 'vfx', desc.frame_size, desc.spec, frame.key,
        {pivot: desc.anchor, durationMs: frame.duration_ms});
    }
  }
  let overlays = {};
  try { overlays = await json('assets/approved-frames.json'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!overlays || Array.isArray(overlays) || typeof overlays !== 'object') throw new Error('Invalid approved frame map');
  async function original(frame) {
    const {width, height} = frame.info;
    const bytes = await readInside(root, frame.processed);
    const png = normalizePng(bytes, width, height, palette);
    const source = await readInside(root, frame.info.sourceUrl.slice(1));
    if (frame.info.category === 'ui' && !normalizePng(source,width,height,palette).equals(png))
      throw new Error('UI source and processed frame disagree');
    const digest = data => createHash('sha256').update(data).digest('hex');
    const sourceDigest = digest(frame.info.category === 'vfx' ? JSON.stringify(JSON.parse(source)) : source);
    frame.sourceStamp = digest(JSON.stringify([frame.info.key,width,height,frame.info.sourceUrl,
      frame.processed,digest(bytes),sourceDigest,frame.originalMetadata]));
    return png;
  }
  for (const frame of frames.values()) frame.originalMetadata = frame.metadata;
  function validateOverlay(key, entry) {
    const frame = frames.get(key);
    if (!frame || !entry || !isDeepStrictEqual(Object.keys(entry).sort(),['metadata','pngBase64','revision','sourceStamp']) ||
        !Number.isSafeInteger(entry.revision) || entry.revision < 0 || entry.sourceStamp !== frame.sourceStamp)
      throw new Error('Unrecognized or stale approved frame: '+key);
    const m = entry.metadata;
    if (!m || !isDeepStrictEqual(Object.keys(m).sort(),[...frame.info.editableFields].sort()) ||
        !Array.isArray(m.pivot) || m.pivot.length !== 2 || !m.pivot.every(Number.isInteger) ||
        m.pivot[0]<0 || m.pivot[0]>=frame.info.width || m.pivot[1]<0 || m.pivot[1]>=frame.info.height ||
        ('durationMs' in m && (!Number.isInteger(m.durationMs) || m.durationMs<1 || m.durationMs>60000)))
      throw new Error('Invalid approved metadata: '+key);
    const bytes = Buffer.from(entry.pngBase64,'base64');
    if (bytes.toString('base64') !== entry.pngBase64) throw new Error('Invalid approved PNG encoding');
    return normalizePng(bytes,frame.info.width,frame.info.height,palette);
  }
  for (const [key, entry] of Object.entries(overlays)) {
    const frame = frames.get(key);
    if (!frame) throw new Error('Unknown approved frame: '+key);
    await original(frame);
    frame.approvedPng = validateOverlay(key, entry);
    frame.metadata = entry.metadata;
  }
  return {frames,palette,overlays,validateOverlay,async baseline(frame) {
    const png = await original(frame);
    if (frame.approvedPng) validateOverlay(frame.info.key, overlays[frame.info.key]);
    return frame.approvedPng ?? png;
  }};
}
