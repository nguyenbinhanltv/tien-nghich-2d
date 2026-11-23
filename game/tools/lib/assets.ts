// The asset index the game build needs, read from the two design manifests. Readiness mirrors the Studio rule:
// an entry is packed when its chunk-manifest lists it (assets/atlases_longtime/<profile>/<chunk>/chunk-manifest.json).
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, readJson } from './repo.ts';

export interface AssetInfo {
  id: string;
  category: string;
  source: 'core' | 'longtime';
  readiness: string;
  size: [number, number] | null;
  directions: string[];
  clips: Record<string, number>; // clip -> frame count
  chunk: string | null;
  name: { vi: string; en: string } | null;
}

interface CoreAsset { id: string; readiness: string; category: string; size: [number, number]; directions: string[]; animations?: Record<string, { frames: number }>; name?: { vi: string; en: string }; sheets?: Record<string, unknown>; }
interface LtAsset { id: string; profile: string; chunk_group: string }
interface LtManifest { profiles: Record<string, { category: string; native_px: [number, number] | number; directions?: string[]; clips: Record<string, [number, number]> }>; assets: LtAsset[]; defaults: { readiness: string } }

export function loadAssets(profile: 'mobile' | 'web' = 'mobile'): Map<string, AssetInfo> {
  const out = new Map<string, AssetInfo>();
  const core = readJson<{ assets: CoreAsset[] }>(path.join(ASSETS, 'manifest.json'));
  for (const a of core.assets) {
    out.set(a.id, { id: a.id, category: a.category, source: 'core', readiness: a.readiness, size: a.size, directions: a.directions ?? [], chunk: null, name: a.name ?? null,
      clips: Object.fromEntries(Object.entries(a.animations ?? {}).map(([c, v]) => [c, v.frames])) });
  }
  const lt = readJson<LtManifest>(path.join(ASSETS, 'manifest_longtime.json'));
  const packed = new Set<string>();
  for (const chunk of new Set(lt.assets.map((a) => a.chunk_group))) {
    const f = path.join(ASSETS, 'atlases_longtime', profile, chunk, 'chunk-manifest.json');
    if (fs.existsSync(f)) for (const id of readJson<{ asset_ids: string[] }>(f).asset_ids) packed.add(id);
  }
  for (const a of lt.assets) {
    const p = lt.profiles[a.profile];
    if (!p) continue;
    const px = Array.isArray(p.native_px) ? p.native_px : [p.native_px, p.native_px];
    out.set(a.id, { id: a.id, category: p.category, source: 'longtime', readiness: packed.has(a.id) ? 'packed' : lt.defaults.readiness, size: [px[0]!, px[1]!], directions: p.directions ?? [], chunk: a.chunk_group, name: null,
      clips: Object.fromEntries(Object.entries(p.clips).map(([c, v]) => [c, v[0]])) });
  }
  return out;
}
