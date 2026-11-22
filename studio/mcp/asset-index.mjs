// THE PROJECT ADAPTER: how this project's manifests become the asset records studio/core works on.
// Everything Tien Nghich specific lives here: which categories carry an outline, how processed frames
// are grouped and keyed, the Longtime id prefix, where the design manifest keeps its templates.
// studio/core never names any of it (studio/core/tests/literals.test.mjs enforces that); when the
// project pack can describe these conventions, this file shrinks to reading them from the pack.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../core/files.mjs';
import { fillTemplate } from '../core/pack.mjs';
import { readPlans } from '../core/plans.mjs';

// Categories whose silhouette must carry the outline colour. Union of tools/scripts/qa_assets.py
// and qa_longtime.py; tileset, projectile, ui and vfx glows are exempt.
const OUTLINE_CATEGORIES = new Set(['player', 'mob', 'boss', 'pet', 'npc', 'facility', 'weapon', 'tower', 'icon', 'prop']);

const GROUP_OF_CATEGORY = {player: 'players', mob: 'mobs', boss: 'bosses', tileset: 'tilesets', weapon: 'weapons',
  projectile: 'projectiles', prop: 'props', icon: 'icons', ui: 'ui'};
// Atlas key prefix per processed group (assets/atlases/AssetKeys.ts).
const KEY_PREFIX = {players: 'characters', mobs: 'characters', bosses: 'characters', tilesets: 'tilesets',
  weapons: 'weapons', projectiles: 'projectiles', props: 'props', icons: 'ui', ui: 'ui'};

// Categories whose frames may be empty (an effect fades to nothing).
const EMPTY_OK_CATEGORIES = new Set(['vfx']);

const atlasDirs = base => ({web: `${base}/web`, mobile: `${base}/mobile`});

/** Where studio-created planned entries are stored: beside the design manifest. */
const plansFileOf = design => path.posix.join(path.posix.dirname(design.file), 'studio_plans.json');

const PLAN_ID = {pattern: '^lt_[a-z0-9]+(?:_[a-z0-9]+)*$', hint: 'lt_some_name'};

function spriteLayout({id, processedDir, keyBase, nameStyle = 'sprite', studioRawDir}) {
  return {nameStyle, processedDir, studioRawDir, keyOf: (clip, direction, n) => `${keyBase}/${id}/${clip}_${direction}_${n}`};
}

function clipsOf(animations) {
  if (!animations || Array.isArray(animations) || typeof animations !== 'object') return null;
  return Object.fromEntries(Object.entries(animations).map(([clip, v]) => [clip, {frames: v.frames, ...(v.loop !== undefined ? {loop: v.loop} : {})}]));
}

/** Build the index. `root` is the project data directory, `pack` the validated pack. */
export async function loadAssetIndex(pack, root) {
  root = await fs.realpath(root);
  const byKind = kind => pack.catalog.sources.find(s => s.kind === kind);
  const assets = new Map();
  const put = record => {
    if (assets.has(record.id)) throw new Error(`Duplicate asset id ${record.id} (${assets.get(record.id).sourceId} and ${record.sourceId})`);
    assets.set(record.id, record);
  };
  const info = {profiles: {}, chunks: {}, defaults: {}, sources: {}};

  const core = byKind('asset-manifest');
  if (core) {
    info.sources.core = core;
    const data = await readJson(root, core.file);
    for (const a of data.assets) {
      const group = GROUP_OF_CATEGORY[a.category];
      const isUi = a.category === 'ui';
      const keyBase = isUi ? 'ui' : KEY_PREFIX[group] ?? group;
      const processedDir = `${pack.directories.processed.core}/${group}/${a.id}`;
      const size = Array.isArray(a.size) ? a.size : (a.tile_size ? [a.tile_size, a.tile_size] : null);
      put({
        id: a.id, source: 'core', sourceId: core.id, manifest: core.file, category: a.category,
        name: a.name?.en ?? a.name ?? a.id, readiness: a.readiness ?? 'unknown', brief: a.description ?? '',
        assignedAgent: a.assigned_agent, size, pivot: null, directions: a.directions ?? ['none'],
        clips: clipsOf(a.animations), outline: OUTLINE_CATEGORIES.has(a.category), emptyOk: EMPTY_OK_CATEGORIES.has(a.category),
        spec: {output_path: a.output_path, palette_refs: a.palette_refs, status: a.status, frame_roles: a.frame_roles},
        layout: {...spriteLayout({id: a.id, processedDir, keyBase}), rawDir: a.output_path?.replace(/\/$/, ''),
          atlas: atlasDirs(pack.directories.atlases.core)},
      });
    }
  }

  const design = byKind('design-manifest');
  if (design) {
    info.sources.longtime = design;
    const data = await readJson(root, design.file);
    info.profiles = data.profiles; info.chunks = data.chunks; info.defaults = data.defaults; info.mobile = data.mobile;
    // A studio plan may carry an inline spec instead of naming a manifest profile (a VFX, a one-off).
    const inlineProfile = c => ({category: c.category, native_px: c.size, pivot_px: c.pivot, directions: c.directions ?? ['none'],
      clips: Object.fromEntries(Object.entries(c.clips).map(([n, v]) => [n, [v.frames, v.frameMs]]))});
    const longtimeRecord = (a, origin) => {
      const p = a.custom ? inlineProfile(a.custom) : data.profiles[a.profile];
      if (!p) throw new Error(`Longtime asset ${a.id} names unknown profile ${a.profile}`);
      const rawDir = fillTemplate(data.defaults.source, {id: a.id}).replace(/\/$/, '');
      return {
        id: a.id, source: 'longtime', sourceId: design.id, manifest: design.file, origin, category: p.category,
        profile: a.custom ? 'custom' : a.profile, name: a.id, readiness: a.readiness ?? data.defaults.readiness, brief: a.brief,
        chunk: a.chunk_group, phase: a.phase, method: a.method, dependencies: a.dependencies ?? [],
        assignedAgent: p.assigned_agent, size: p.native_px, pivot: p.pivot_px, directions: p.directions,
        clips: Object.fromEntries(Object.entries(p.clips).map(([c, [frames, frameMs]]) => [c, {frames, frameMs}])),
        outline: OUTLINE_CATEGORIES.has(p.category), emptyOk: EMPTY_OK_CATEGORIES.has(p.category), spec: {},
        layout: {...spriteLayout({id: a.id, processedDir: `${pack.directories.processed.longtime}/${a.id}`, keyBase: 'longtime',
          studioRawDir: `${rawDir}/frames`}), rawDir, atlas: atlasDirs(pack.directories.atlases.longtime)},
      };
    };
    for (const a of data.assets) put(longtimeRecord(a, 'manifest'));
    // Planned entries created through the studio live beside the design manifest, which is a locked
    // contract (check_longtime.py pins its totals). A human promotes them into it in a reviewed change.
    info.plansFile = plansFileOf(design);
    info.planId = PLAN_ID;
    for (const a of (await readPlans(root, info.plansFile)).entries) put(longtimeRecord(a, 'studio-plan'));
    const effectsPath = design.effects ?? 'vfx.entries';
    const entries = effectsPath.split('.').reduce((v, k) => v?.[k], data) ?? [];
    for (const e of entries) {
      put({
        id: e.id, source: 'longtime-vfx', sourceId: design.id, manifest: design.file, category: 'vfx', name: e.id,
        readiness: e.status, brief: e.event ?? '', chunk: e.chunk_group, method: e.method, dependencies: e.related ?? [],
        size: e.native_px ?? null, pivot: e.pivot_px ?? null, directions: ['none'], clips: null, outline: false, emptyOk: true,
        spec: {modes: e.modes, reads: e.reads, why_new: e.why_new},
        layout: {nameStyle: 'palette', processedDir: `${pack.directories.processed.longtime}/${e.id}`, atlas: atlasDirs(pack.directories.atlases.longtime),
          keyOf: (clip, palette, n) => `longtime/${e.id}/${clip}_${palette}_${n}`},
      });
    }
  }

  const vfx = byKind('vfx-index');
  if (vfx) {
    info.sources.vfx = vfx;
    const data = await readJson(root, vfx.file);
    for (const e of data.effects) {
      put({
        id: e.id, source: 'vfx', sourceId: vfx.id, manifest: vfx.file, category: 'vfx', name: e.id, readiness: 'packed',
        brief: '', size: e.frame_size, pivot: e.anchor, directions: ['none'], clips: {play: {frames: e.frame_count, loop: e.loop}},
        outline: false, emptyOk: true, spec: {fps: e.fps, total_ms: e.total_ms, descriptor: e.descriptor},
        layout: {nameStyle: 'vfx-flat', processedDir: `${pack.directories.processed.core}/vfx`, flatPrefix: e.id, atlas: atlasDirs(pack.directories.atlases.core),
          keyOf: (clip, direction, n) => fillTemplate(pack.frameKeys.vfx, {id: e.id, n})},
      });
    }
  }

  const audio = byKind('audio-plan');
  if (audio) {
    info.sources.audio = audio;
    const data = await readJson(root, audio.file);
    const ids = new Set();
    const addAudio = (id, category, group) => {
      if (ids.has(id) || assets.has(id)) return;
      ids.add(id);
      put({id, source: 'audio', sourceId: audio.id, manifest: audio.file, category, name: id, readiness: data.status ?? 'planned',
        brief: '', group, size: null, pivot: null, directions: [], clips: null, outline: false, spec: {}, layout: null,
        // Candidates made through the studio live beside the audio plan, never in the delivered audio directories.
        audio: {dir: path.posix.join(path.posix.dirname(audio.file), 'studio_audio', id)}});
    };
    for (const [category, list] of Object.entries(data.core ?? {}))
      if (Array.isArray(list)) list.filter(x => typeof x === 'string').forEach(id => addAudio(id, category, 'core'));
    for (const [group, node] of Object.entries(data.extensions ?? {}))
      for (const [category, list] of Object.entries(node ?? {}))
        if (Array.isArray(list)) list.filter(x => typeof x === 'string').forEach(id => addAudio(id, category, group));
  }
  return {assets, info, root};
}
