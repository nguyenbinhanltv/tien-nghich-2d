// THE ASSET INDEXER: turns the manifests the pack names (catalog.sources) into the asset records
// studio/core works on. It knows the manifest FORMATS (asset-manifest, design-manifest, vfx-index,
// audio-plan) and nothing about any project: ids, key prefixes, which categories carry an outline,
// the plan-id pattern and where frames are keyed all come from the pack (catalog.categories and the
// source options idPattern, idHint, keyBase, frameKeys). studio/core/tests/literals.test.mjs
// enforces that no project literal appears here.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson } from '../core/files.mjs';
import { fillTemplate } from '../core/pack.mjs';
import { readPlans } from '../core/plans.mjs';

const atlasDirs = base => ({web: `${base}/web`, mobile: `${base}/mobile`});

/** Where studio-created planned entries are stored: beside the design manifest. */
const plansFileOf = design => path.posix.join(path.posix.dirname(design.file), 'studio_plans.json');

const DEFAULT_PLAN_ID = {pattern: '^[a-z0-9]+(?:_[a-z0-9]+)*$', hint: 'some_name'};

function spriteLayout({id, processedDir, keyBase, keyTemplate, nameStyle = 'sprite', studioRawDir}) {
  return {nameStyle, processedDir, studioRawDir, keyOf: (clip, direction, n) => keyTemplate
    ? fillTemplate(keyTemplate, {id, clip, direction, n}) : `${keyBase}/${id}/${clip}_${direction}_${n}`};
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
  // A source names the directory keys it uses: `processed` (and `raw`); atlases default to the processed key.
  const dirsOf = source => ({processed: source.processed ? pack.directories.processed[source.processed] : undefined, raw: source.raw ? pack.directories.raw[source.raw] : null,
    atlas: atlasDirs(pack.directories.atlases[source.atlases ?? source.processed ?? Object.keys(pack.directories.atlases)[0]] ?? '')});
  // Category conventions from the pack: processed group, atlas key prefix, outline, empty frames allowed.
  const categories = pack.catalog.categories ?? {};
  const outlineOf = category => categories[category]?.outline === true;
  const emptyOkOf = category => categories[category]?.emptyOk === true;

  const core = byKind('asset-manifest');
  if (core) {
    info.sources[core.id] = core;
    const data = await readJson(root, core.file);
    for (const a of data.assets) {
      const group = categories[a.category]?.group ?? a.category;
      const keyBase = categories[a.category]?.keyPrefix ?? group;
      const processedDir = `${dirsOf(core).processed}/${group}/${a.id}`;
      const size = Array.isArray(a.size) ? a.size : (a.tile_size ? [a.tile_size, a.tile_size] : null);
      put({
        id: a.id, source: core.id, sourceId: core.id, manifest: core.file, category: a.category,
        name: a.name?.en ?? a.name ?? a.id, readiness: a.readiness ?? 'unknown', brief: a.description ?? '',
        assignedAgent: a.assigned_agent, size, pivot: null, directions: a.directions ?? ['none'],
        clips: clipsOf(a.animations), outline: outlineOf(a.category), emptyOk: emptyOkOf(a.category),
        spec: {output_path: a.output_path, palette_refs: a.palette_refs, status: a.status, frame_roles: a.frame_roles},
        layout: {...spriteLayout({id: a.id, processedDir, keyBase}), rawDir: a.output_path?.replace(/\/$/, ''),
          atlas: dirsOf(core).atlas},
      });
    }
  }

  const design = byKind('design-manifest');
  if (design) {
    info.sources[design.id] = design;
    const data = await readJson(root, design.file);
    info.profiles = data.profiles; info.chunks = data.chunks; info.defaults = data.defaults; info.mobile = data.mobile;
    // A studio plan may carry an inline spec instead of naming a manifest profile (a VFX, a one-off).
    const inlineProfile = c => ({category: c.category, native_px: c.size, pivot_px: c.pivot, directions: c.directions ?? ['none'],
      clips: Object.fromEntries(Object.entries(c.clips).map(([n, v]) => [n, [v.frames, v.frameMs]]))});
    // A design manifest only DESIGNS: its default readiness is "planned". When the project packs the chunks
    // (budget.manifest, one chunk-manifest per chunk group) an asset named there is packed, so the index says so.
    const packedIds = new Set();
    if (design.budget?.manifest) for (const chunk of Object.keys(data.chunks ?? {})) {
      const cm = await readJson(root, fillTemplate(design.budget.manifest, {chunk})).catch(() => null);
      for (const id of cm?.asset_ids ?? []) packedIds.add(id);
    }
    const designRecord = (a, origin) => {
      const p = a.custom ? inlineProfile(a.custom) : data.profiles[a.profile];
      if (!p) throw new Error(`${design.id} asset ${a.id} names unknown profile ${a.profile}`);
      const rawDir = fillTemplate(data.defaults.source, {id: a.id}).replace(/\/$/, '');
      return {
        id: a.id, source: design.id, sourceId: design.id, manifest: design.file, origin, category: p.category,
        profile: a.custom ? 'custom' : a.profile, name: a.id, readiness: a.readiness ?? (packedIds.has(a.id) ? 'packed' : data.defaults.readiness), brief: a.brief,
        chunk: a.chunk_group, phase: a.phase, method: a.method, dependencies: a.dependencies ?? [],
        assignedAgent: p.assigned_agent, size: p.native_px, pivot: p.pivot_px, directions: p.directions,
        clips: Object.fromEntries(Object.entries(p.clips).map(([c, [frames, frameMs]]) => [c, {frames, frameMs}])),
        outline: outlineOf(p.category), emptyOk: emptyOkOf(p.category), spec: {},
        layout: {...spriteLayout({id: a.id, processedDir: `${dirsOf(design).processed}/${a.id}`, keyBase: design.keyBase ?? design.id, keyTemplate: design.frameKeys?.sprites ? pack.frameKeys[design.frameKeys.sprites] : undefined,
          studioRawDir: `${rawDir}/frames`}), rawDir, atlas: dirsOf(design).atlas},
      };
    };
    for (const a of data.assets) put(designRecord(a, 'manifest'));
    // Planned entries created through the studio live beside the design manifest, which is a locked
    // contract (a project check may pin its totals). A human promotes them into it in a reviewed change.
    info.plansFile = plansFileOf(design);
    info.planId = design.idPattern ? {pattern: design.idPattern, hint: design.idHint ?? DEFAULT_PLAN_ID.hint} : DEFAULT_PLAN_ID;
    for (const a of (await readPlans(root, info.plansFile)).entries) put(designRecord(a, 'studio-plan'));
    const effectsPath = design.effects ?? 'vfx.entries';
    const entries = effectsPath.split('.').reduce((v, k) => v?.[k], data) ?? [];
    for (const e of entries) {
      put({
        id: e.id, source: `${design.id}-vfx`, sourceId: design.id, manifest: design.file, category: 'vfx', name: e.id,
        readiness: e.status, brief: e.event ?? '', chunk: e.chunk_group, method: e.method, dependencies: e.related ?? [],
        size: e.native_px ?? null, pivot: e.pivot_px ?? null, directions: ['none'], clips: null, outline: false, emptyOk: true,
        spec: {modes: e.modes, reads: e.reads, why_new: e.why_new},
        layout: {nameStyle: 'palette', processedDir: `${dirsOf(design).processed}/${e.id}`, atlas: dirsOf(design).atlas,
          keyOf: (clip, palette, n) => design.frameKeys?.effects
            ? fillTemplate(pack.frameKeys[design.frameKeys.effects], {id: e.id, clip, palette, n})
            : `${design.keyBase ?? design.id}/${e.id}/${clip}_${palette}_${n}`},
      });
    }
  }

  const vfx = byKind('vfx-index');
  if (vfx) {
    info.sources[vfx.id] = vfx;
    const data = await readJson(root, vfx.file);
    // Same atlas the catalog reads: this source's own `atlas.dir`, else its atlases/processed directory key.
    const vfxAtlas = vfx.atlas ? {...dirsOf(vfx).atlas, web: vfx.atlas.dir} : dirsOf(vfx).atlas;
    for (const e of data.effects) {
      put({
        id: e.id, source: vfx.id, sourceId: vfx.id, manifest: vfx.file, category: 'vfx', name: e.id, readiness: 'packed',
        brief: '', size: e.frame_size, pivot: e.anchor, directions: ['none'], clips: {play: {frames: e.frame_count, loop: e.loop}},
        outline: false, emptyOk: true, spec: {fps: e.fps, total_ms: e.total_ms, descriptor: e.descriptor},
        layout: {nameStyle: 'vfx-flat', processedDir: vfx.processed ? path.posix.join(dirsOf(vfx).processed, vfx.processedSubdir ?? '') : path.posix.dirname(vfx.file), flatPrefix: e.id, atlas: vfxAtlas,
          keyOf: (clip, direction, n) => fillTemplate(pack.frameKeys[vfx.atlas?.frameKey ?? 'vfx'], {id: e.id, n})},
      });
    }
  }

  const audio = byKind('audio-plan');
  if (audio) {
    info.sources[audio.id] = audio;
    const data = await readJson(root, audio.file);
    const ids = new Set();
    const addAudio = (id, category, group) => {
      if (ids.has(id) || assets.has(id)) return;
      ids.add(id);
      put({id, source: audio.id, sourceId: audio.id, manifest: audio.file, category, name: id, readiness: data.status ?? 'planned',
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
