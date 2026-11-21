// The editable frame catalog: the frames the editor may change, built from the pack's
// `editable` groups. Frames can carry an approved overlay file named by the pack.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizePng } from './png.mjs';
import { readInside, readJson } from './files.mjs';
import { fillTemplate, parsePalette } from './pack.mjs';
import { catalogSource, framesByDirectory } from './catalog.mjs';

export async function loadEditableCatalog(pack, root) {
  root = await fs.realpath(root);
  const palette = parsePalette(await readJson(root, pack.palette.file)).colors;
  const frames = new Map();
  const atlasPublish = {mode: 'atlas'};
  let publish = atlasPublish;
  function add(kind, key, assetId, category, size, source, processed, metadata) {
    if (!/^[a-z0-9_]+$/.test(assetId) || frames.has(key)) throw new Error('Invalid editor catalog: ' + key);
    const [width, height] = size;
    // Frames that cannot be published carry the reason; atlas-publishable frames keep the original info shape.
    frames.set(key, {kind, publish, info: {key, assetId, category, width, height, sourceUrl:'/'+source, processedUrl:'/'+processed,
      editableFields:Object.keys(metadata), ...(publish.mode === 'none' ? {publish} : {})}, metadata, processed});
  }
  async function pngSize(file) {
    const handle = await fs.open(await fs.realpath(path.join(root, file)), 'r');
    try {
      const head = Buffer.alloc(24);
      await handle.read(head, 0, 24, 0);
      return [head.readUInt32BE(16), head.readUInt32BE(20)];
    } finally { await handle.close(); }
  }

  const sourceFile = id => pack.catalog.sources.find(s => s.id === id).file;
  for (const group of pack.editable.groups) {
    // A data root that lacks a source manifest (a trimmed project copy) simply has none of its frames.
    const data = await readJson(root, sourceFile(group.source)).catch(error => {
      if (error.code === 'ENOENT' && group.kind === 'processed-frames') return null;
      throw error;
    });
    if (!data) continue;
    const template = group.frameKey ? pack.frameKeys[group.frameKey] : undefined;
    publish = group.publish ?? atlasPublish;
    if (group.kind === 'processed-frames') {
      const source = pack.catalog.sources.find(s => s.id === group.source);
      const dir = pack.directories.processed[source.processed];
      const entries = (await catalogSource(pack, root, source)).assets;
      const files = await framesByDirectory(root, dir);
      const members = new Set([group.source, group.source + '_effects']);
      for (const entry of entries.filter(a => members.has(a.source) && (!group.categories || group.categories.includes(a.category)))) {
        const list = (files.get(entry.id) ?? []).sort((a, b) => a.localeCompare(b, 'en', {numeric: true}));
        if (!list.length) continue;
        const record = (entry.source.endsWith('_effects') ? data.vfx?.entries : data.assets)?.find(a => a.id === entry.id);
        let pivot;
        const rule = group.pivot ?? {from: 'center'};
        if (rule.from === 'file') {
          const anchor = await readJson(root, path.posix.dirname(list[0]) + '/' + rule.file).catch(() => undefined);
          pivot = anchor?.[rule.field];
        } else if (rule.from === 'profile') pivot = record?.[rule.field] ?? data.profiles?.[record?.profile]?.[rule.field];
        for (const file of list) {
          const relative = file.slice(dir.length + 1).replace(/\.png$/, '');
          const [head, ...rest] = relative.split('/');
          const key = (group.keyPrefix ?? '') + [group.keyMap?.[head] ?? head, ...rest].join('/');
          const size = await pngSize(file);
          const point = Array.isArray(pivot) && pivot.length === 2 && pivot.every(Number.isInteger) &&
            pivot[0] >= 0 && pivot[0] < size[0] && pivot[1] >= 0 && pivot[1] < size[1] ? pivot : size.map(v => Math.floor(v / 2));
          add(group.kind, key, entry.id, entry.category, size, file, file, {pivot: point});
        }
      }
    } else if (group.kind === 'asset-animations') {
      for (const a of data.assets.filter(a => a.category === group.category)) {
        for (const [clip, {frames: count}] of Object.entries(a.animations)) {
          for (let n=0; n<count; n++) {
            const key = fillTemplate(template, {id:a.id, clip, n});
            add(group.kind, key, a.id, group.category, a.size,
              fillTemplate(group.raw, {output_path:a.output_path, id:a.id, clip, n}),
              fillTemplate(group.processed, {key}), {pivot:a.size.map(v=>Math.floor(v/2))});
          }
        }
      }
    } else {
      for (const effect of data.effects) {
        const desc = await readJson(root, effect.descriptor);
        for (const [n, frame] of desc.frames.entries()) {
          add(group.kind, fillTemplate(template, {id:effect.id, n}), effect.id, group.category, desc.frame_size, desc.spec, frame.key,
            {pivot: desc.anchor, durationMs: frame.duration_ms});
        }
      }
    }
  }
  let overlays = {};
  try { overlays = await readJson(root, pack.editable.overlay); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!overlays || Array.isArray(overlays) || typeof overlays !== 'object') throw new Error('Invalid approved frame map');
  async function original(frame) {
    const {width, height} = frame.info;
    const bytes = await readInside(root, frame.processed);
    const png = normalizePng(bytes, width, height, palette);
    const source = await readInside(root, frame.info.sourceUrl.slice(1));
    if (frame.kind === 'asset-animations' && !normalizePng(source,width,height,palette).equals(png))
      throw new Error('UI source and processed frame disagree');
    const digest = data => createHash('sha256').update(data).digest('hex');
    const sourceDigest = digest(frame.kind === 'vfx-descriptor' ? JSON.stringify(JSON.parse(source)) : source);
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
    if (frame.publish.mode === 'none') throw new Error('Frame cannot be published: '+key+' ('+frame.publish.reason+')');
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
