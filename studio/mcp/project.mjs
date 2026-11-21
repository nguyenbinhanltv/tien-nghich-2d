// THE ONLY MODULE IN studio/mcp THAT READS PROJECT FILES.
//
// Today it reads the repo's existing manifests directly ("legacy-files" source). Lane A is adding a
// project pack (`studio.project.json`) plus studio/core readers; when that lands, switch
// `openProject` to build the same view from the pack and keep the method signatures below. Tools
// never see paths or raw JSON, only these methods, so the switch touches this file alone.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export class ProjectError extends Error {}

// Rules that exist only in prose/Python today (docs/ART_BIBLE.md, tools/scripts/qa_assets.py).
// Kept here as data so they can move into the project pack verbatim.
const OUTLINE_RULE = {
  widthPx: 1,
  appliesToCategories: ['player', 'mob', 'boss', 'weapon', 'prop', 'icon'],
  exemptCategories: ['tileset', 'ui', 'projectile', 'vfx'],
  note: 'Every silhouette-edge pixel of an applicable sprite must be the outline colour; 2x2 outline blocks are a warning.',
  source: 'docs/ART_BIBLE.md; tools/scripts/qa_assets.py (OUTLINE_CATEGORIES)',
};
const ALPHA_RULE = {
  values: [0, 255],
  transparentPixelRgb: [0, 0, 0],
  paletteOnly: true,
  note: 'Alpha is binary. RGB under alpha 0 must be 0,0,0. Every opaque pixel must be a palette colour.',
  source: 'docs/ART_BIBLE.md; tools/scripts/qa_assets.py (partial_alpha, dirty_transparent, off_palette)',
};
// Processed-frame key templates. Base keys come from the atlas packer (assets/atlases/AssetKeys.ts);
// Longtime keys come from the design manifests.
const BASE_KEY_GROUPS = {
  characters: 'player, mob, boss',
  tilesets: 'tileset',
  weapons: 'weapon',
  projectiles: 'projectile',
  props: 'prop',
  ui: 'ui, icon',
};

const tally = (items, keyFn) => {
  const out = {};
  for (const it of items) {
    const k = keyFn(it) ?? 'unknown';
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

export function openProject(rootArg) {
  const root = resolve(rootArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new ProjectError(`project path is not a directory: ${root}`);

  const readJson = (rel) => {
    const p = join(root, rel);
    if (!existsSync(p)) throw new ProjectError(`missing ${rel} under ${root} (is --project the repo root?)`);
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      throw new ProjectError(`${rel} is not valid JSON: ${e.message}`);
    }
  };

  // Manifests are re-read on every call so a long-lived server never reports stale counts. The
  // first load happens in openProject, so a bad project root still fails fast at startup.
  const load = () => {
    const base = readJson('assets/manifest.json');
    const longtime = readJson('assets/manifest_longtime.json');
    const audio = readJson('assets/audio_manifest.json');
    const audioCounts = {};
    const walk = (o, path) => {
      for (const [k, v] of Object.entries(o ?? {})) {
        const p = [...path, k];
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) audioCounts[p.join('.')] = v.length;
        else if (v && typeof v === 'object' && p.length < 3) walk(v, p);
      }
    };
    walk(audio.core, ['core']);
    walk(audio.extensions, ['extensions']);
    return {
      base,
      longtime,
      audio,
      audioCounts,
      paletteFile: readJson('tools/generators/palette.json'),
    };
  };
  load();
  const packPath = join(root, 'studio.project.json');

  return {
    root,
    source: 'legacy-files',

    pack() {
      // Lane A's pack: reported, not consumed yet.
      return { path: 'studio.project.json', present: existsSync(packPath), consumed: false };
    },

    palette() {
      const { base, longtime, audio, audioCounts, paletteFile } = load();
      const colors = paletteFile.colors.map((c) => ({ id: c.id, hex: c.hex, group: c.group }));
      return {
        name: paletteFile.name,
        version: paletteFile.version,
        outline: { id: paletteFile.outline_id, hex: paletteFile.outline },
        count: colors.length,
        colors,
        source: 'tools/generators/palette.json',
      };
    },

    sizeClasses() {
      const { base, longtime, audio, audioCounts, paletteFile } = load();
      const profiles = {};
      for (const [name, p] of Object.entries(longtime.profiles)) {
        profiles[name] = {
          category: p.category,
          nativePx: p.native_px,
          pivotPx: p.pivot_px,
          directions: p.directions,
          clips: Object.fromEntries(Object.entries(p.clips).map(([c, [frames, ms]]) => [c, { frames, frameMs: ms }])),
        };
      }
      const baseSizes = {};
      for (const a of base.assets) {
        if (!Array.isArray(a.size)) continue;
        const set = (baseSizes[a.category] ??= new Set());
        set.add(a.size.join('x'));
      }
      return {
        longtimeProfiles: profiles,
        baseManifestSizes: Object.fromEntries(Object.entries(baseSizes).map(([k, v]) => [k, [...v].sort()])),
        mobileAtlas: longtime.mobile,
        source: 'assets/manifest_longtime.json (profiles, mobile); assets/manifest.json (assets[].size)',
      };
    },

    rules() {
      const { base, longtime, audio, audioCounts, paletteFile } = load();
      return { outline: { id: paletteFile.outline_id, hex: paletteFile.outline, ...OUTLINE_RULE }, alpha: ALPHA_RULE };
    },

    frameKeys() {
      const { base, longtime, audio, audioCounts, paletteFile } = load();
      const ui = base.delivery?.ui_export;
      return [
        ...Object.entries(BASE_KEY_GROUPS).map(([group, cats]) => ({
          scope: `base:${cats}`,
          key: `${group}/{id}/{clip}_{direction}_{n}`,
          source: 'assets/atlases/AssetKeys.ts (generated by tools/scripts/pack_atlases.py)',
        })),
        { scope: 'base:vfx', key: 'vfx/{id}_{n}', source: 'assets/atlases/AssetKeys.ts' },
        ...(ui ? [{ scope: 'base:ui (processed path)', key: ui.atlas_key, processed: ui.processed, source: 'assets/manifest.json delivery.ui_export' }] : []),
        {
          scope: 'longtime:sprites',
          key: longtime.defaults.key,
          raw: longtime.defaults.source,
          processed: longtime.defaults.processed,
          atlasExport: longtime.defaults.export,
          source: 'assets/manifest_longtime.json defaults',
        },
        {
          scope: 'longtime:vfx',
          key: longtime.vfx.paths.key,
          raw: longtime.vfx.paths.source,
          processed: longtime.vfx.paths.processed,
          note: '{palette} replaces {direction}; "base" when an ID has one colour set. Indices start at 0.',
          source: 'assets/manifest_longtime.json vfx.paths; docs/LONGTIME_VFX.md',
        },
        {
          scope: 'frame-file-name',
          pattern: '^(?P<anim>[a-z0-9]+(_[a-z0-9]+)*)_(?P<dir>south|east|north|west|none|f\\d+)_(?P<n>\\d+)$',
          note: 'Directions: south, east, north, west, none (single-view assets), fN (tile frame variants).',
          source: 'tools/scripts/qa_assets.py (NAME_RE)',
        },
      ];
    },

    assetCounts() {
      const { base, longtime, audio, audioCounts, paletteFile } = load();
      const readinessDefault = longtime.defaults.readiness;
      const profileCategory = (a) => longtime.profiles[a.profile]?.category ?? a.profile;
      return {
        base: {
          manifest: 'assets/manifest.json',
          total: base.assets.length,
          byCategory: tally(base.assets, (a) => a.category),
          byReadiness: tally(base.assets, (a) => a.readiness),
          byAssignedAgent: tally(base.assets, (a) => a.assigned_agent),
        },
        longtime: {
          manifest: 'assets/manifest_longtime.json',
          total: longtime.assets.length,
          byCategory: tally(longtime.assets, profileCategory),
          byReadiness: tally(longtime.assets, (a) => a.readiness ?? readinessDefault),
          byChunk: tally(longtime.assets, (a) => a.chunk_group),
          vfx: { total: longtime.vfx.entries.length, byStatus: tally(longtime.vfx.entries, (e) => e.status) },
        },
        audio: { manifest: 'assets/audio_manifest.json', idsByGroup: audioCounts, idTotal: Object.values(audioCounts).reduce((a, b) => a + b, 0) },
      };
    },

    manifests() {
      const { base, longtime, audio, audioCounts, paletteFile } = load();
      return [
        { path: 'assets/manifest.json', schema: base.schema, version: base.version },
        { path: 'assets/manifest_longtime.json', schema: longtime.schema, version: longtime.version },
        { path: 'assets/audio_manifest.json', schema: audio.schema_version, version: audio.schema_version },
      ];
    },
  };
}
