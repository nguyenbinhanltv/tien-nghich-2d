import fs from 'node:fs/promises';
import path from 'node:path';
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
  return {frames, palette, async baseline(frame) {
    const {width, height} = frame.info;
    return normalizePng(await readInside(root, frame.processed), width, height, palette);
  }};
}
