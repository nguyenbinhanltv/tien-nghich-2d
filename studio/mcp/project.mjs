// THE ONLY MODULE IN studio/mcp THAT READS PROJECT FILES.
//
// The project is described by its pack (`studio.project.json`, loaded and validated by studio/core).
// Every data file this module reads (palette, catalog sources) is named by the pack, not hard-coded
// here. Tools never see paths or raw JSON, only a snapshot's methods.
//
// `openProject(root).snapshot()` loads the pack and files ONCE and returns a consistent view; a tool
// takes one snapshot per call, so all sections of a response come from the same moment and nothing
// is cached across calls (a long-lived server never reports stale counts).

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { lintThresholds } from '../core/clips.mjs';
import { loadPackSync, packFileName } from '../core/pack.mjs';
import { openWorkspace } from '../core/workspace.mjs';
import { loadAssetIndex } from './asset-index.mjs';
import { ToolError } from './registry.mjs';

// A ToolError so a missing or half-written file reaches the model as an actionable isError result
// ("<manifest> is not valid JSON: ...") instead of a generic "failed unexpectedly".
export class ProjectError extends ToolError {}

const tally = (items, keyFn) => {
  const out = {};
  for (const it of items) {
    const k = keyFn(it) ?? 'unknown';
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

export function openProject(rootArg, { libraryDir } = {}) {
  let root = resolve(rootArg);
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new ProjectError(`project path is not a directory: ${root}`);
  root = realpathSync(root);   // a project reached through a symlink must not look like it escapes itself

  const readJson = (rel) => {
    const p = join(root, rel);
    if (!existsSync(p)) throw new ProjectError(`missing ${rel} under ${root} (named by ${packFileName}; is --project the repo root?)`);
    try {
      return JSON.parse(readFileSync(p, 'utf8'));
    } catch (e) {
      throw new ProjectError(`${rel} is not valid JSON: ${e.message}`);
    }
  };

  const loadPack = () => {
    if (!existsSync(join(root, packFileName))) throw new ProjectError(`missing ${packFileName} under ${root} (is --project the repo root?)`);
    try {
      // verifyFiles:false: this server reads only some of the files the pack names, and reports a
      // missing one by name when it actually needs it.
      return loadPackSync(root, packFileName, { verifyFiles: false });
    } catch (e) {
      throw new ProjectError(e.code === 'invalid_pack' ? e.message : `${packFileName} could not be loaded: ${e.message}`);
    }
  };

  const snapshot = () => {
    const pack = loadPack();
    // Every source kind is optional: a project may have no core manifest, no design manifest or no audio.
    const source = (kind) => pack.catalog.sources.find((x) => x.kind === kind);
    const coreSrc = source('asset-manifest');
    const designSrc = source('design-manifest');
    const audioSrc = source('audio-plan');
    const base = coreSrc ? readJson(coreSrc.file) : { assets: [] };
    const design = designSrc ? readJson(designSrc.file) : { profiles: {}, assets: [], defaults: {} };
    const effectsOf = (d) => (designSrc?.effects ?? 'vfx.entries').split('.').reduce((v, k) => v?.[k], d) ?? [];
    const audio = audioSrc ? readJson(audioSrc.file) : {};
    const paletteFile = readJson(pack.palette.file);

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

    const packRef = `${packFileName}`;
    return {
      root,
      source: 'project-pack',

      pack() {
        return { path: packFileName, present: true, consumed: true, id: pack.id, name: pack.name, version: pack.version };
      },

      /** The fixed review rubric the pack defines (criteria and the confidence below which a pass counts as unknown), or null. */
      rubric() {
        return pack.rubric ? { criteria: pack.rubric.criteria, minConfidence: pack.rubric.minConfidence ?? 0.5, how: 'Fill one row per criterion for studio_qa_run or studio_review_request: {id, observation, result: pass|fail|unknown, confidence: 0-1, evidence: [{file or frame, region: {x,y,w,h}}]}. Unknown is never a pass; a failed mandatory criterion fails the rubric; it is evidence, never an approval.' } : null;
      },

      /** Clip roles and lint thresholds (pack.motion with the studio defaults filled in). */
      motion() {
        return { roles: pack.motion?.roles ?? {}, lint: lintThresholds(pack), measured: pack.motion?.measured ?? null };
      },

      palette() {
        const colors = paletteFile.colors.map((c) => ({ id: c.id, hex: c.hex, group: c.group }));
        return {
          name: paletteFile.name,
          version: paletteFile.version,
          outline: { id: paletteFile.outline_id, hex: paletteFile.outline },
          count: colors.length,
          colors,
          source: pack.palette.file,
        };
      },

      sizeClasses() {
        const profiles = {};
        for (const [name, p] of Object.entries(design.profiles)) {
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
          (baseSizes[a.category] ??= new Set()).add(a.size.join('x'));
        }
        return {
          packClasses: pack.sizeClasses,
          atlasProfiles: pack.atlasProfiles,
          [`${designSrc?.id ?? 'design'}Profiles`]: profiles,
          baseManifestSizes: Object.fromEntries(Object.entries(baseSizes).map(([k, v]) => [k, [...v].sort()])),
          mobileAtlas: design.mobile,
          source: [`${packRef} (sizeClasses, atlasProfiles)`, designSrc && `${designSrc.file} (profiles, mobile)`, coreSrc && `${coreSrc.file} (assets[].size)`].filter(Boolean).join('; '),
        };
      },

      rules() {
        const o = pack.rules.outline;
        const hex = o.color === 'palette' ? paletteFile.outline : o.color;
        return {
          outline: {
            id: o.color === 'palette' ? paletteFile.outline_id : undefined,
            hex,
            mode: o.mode,
            borderIsEdge: o.borderIsEdge,
            ...(pack.info?.outline ?? {}),
          },
          alpha: { mode: pack.rules.alpha, ...(pack.info?.alpha ?? {}) },
          packSource: `${packRef} rules`,
        };
      },

      frameKeys() {
        const k = pack.frameKeys;
        const out = [];
        const used = new Set();
        const scopes = pack.info?.frameKeyScopes ?? [];
        for (const sc of scopes.filter((x) => x.pattern === undefined)) {
          const template = sc.frameKey ? k[sc.frameKey] : sc.key;
          if (sc.frameKey) used.add(sc.frameKey);
          if (!template) continue;
          const processed = sc.processedFrom ? sc.processedFrom.split('.').reduce((v, key) => v?.[key], base) : undefined;
          out.push({ scope: sc.scope, key: template, ...(processed ? { processed } : {}), source: sc.source ?? `${packRef} frameKeys.${sc.frameKey}` });
        }
        if (designSrc?.frameKeys?.sprites && k[designSrc.frameKeys.sprites]) {
          const d = design.defaults;
          used.add(designSrc.frameKeys.sprites);
          out.push({ scope: `${designSrc.id}:sprites`, key: k[designSrc.frameKeys.sprites], raw: d.source, processed: d.processed, atlasExport: d.export, source: `${packRef} frameKeys.${designSrc.frameKeys.sprites}; ${designSrc.file} defaults` });
        }
        if (designSrc?.frameKeys?.effects && k[designSrc.frameKeys.effects]) {
          const v = design.vfx?.paths ?? {};
          used.add(designSrc.frameKeys.effects);
          out.push({
            scope: `${designSrc.id}:vfx`, key: k[designSrc.frameKeys.effects], raw: v.source, processed: v.processed,
            note: '{palette} replaces {direction}; "base" when an ID has one colour set. Indices start at 0.',
            source: `${packRef} frameKeys.${designSrc.frameKeys.effects}; ${designSrc.file} vfx.paths`,
          });
        }
        for (const [name, key] of Object.entries(k)) {
          if (!used.has(name)) out.push({ scope: `pack:${name}`, key, source: `${packRef} frameKeys.${name}` });
        }
        for (const sc of scopes.filter((x) => x.pattern !== undefined)) out.push({ scope: sc.scope, pattern: sc.pattern, note: sc.note, source: sc.source });
        return out;
      },

      assetCounts() {
        const readinessDefault = design.defaults.readiness;
        const profileCategory = (a) => design.profiles[a.profile]?.category ?? a.profile;
        const effects = effectsOf(design);
        const out = {};
        if (coreSrc) out.base = {
          manifest: coreSrc.file,
          total: base.assets.length,
          byCategory: tally(base.assets, (a) => a.category),
          byReadiness: tally(base.assets, (a) => a.readiness),
          byAssignedAgent: tally(base.assets, (a) => a.assigned_agent),
        };
        if (designSrc) out[designSrc.id] = {
          manifest: designSrc.file,
          total: design.assets.length,
          byCategory: tally(design.assets, profileCategory),
          byReadiness: tally(design.assets, (a) => a.readiness ?? readinessDefault),
          byChunk: tally(design.assets, (a) => a.chunk_group),
          vfx: { total: effects.length, byStatus: tally(effects, (e) => e.status) },
        };
        if (audioSrc) out.audio = { manifest: audioSrc.file, idsByGroup: audioCounts, idTotal: Object.values(audioCounts).reduce((a, b) => a + b, 0) };
        return out;
      },

      manifests() {
        return [
          ...(coreSrc ? [{ path: coreSrc.file, schema: base.schema, version: base.version }] : []),
          ...(designSrc ? [{ path: designSrc.file, schema: design.schema, version: design.version }] : []),
          ...(audioSrc ? [{ path: audioSrc.file, schema: audio.schema_version, version: audio.schema_version }] : []),
          { path: packFileName, schema: pack.schema, version: pack.version }, // appended: earlier entries keep their positions
        ];
      },
    };
  };

  snapshot(); // fail fast at startup: a bad project root is clearer on stderr than at the first call
  // The workspace is the studio core's view of the same directory (pack, palette, asset index, revision
  // store, studio database). It is built lazily, so a read-only project_info never opens SQLite.
  let workspace;
  /** Name and id of the project, from the pack alone (the MCP handshake announces them). */
  const identity = () => { const { id, name } = loadPack(); return { id, name }; };
  // Only the pack is read (no manifests), so initialize can send the project's rules cheaply.
  const agentGuidance = () => { try { return loadPack().agentGuidance ?? null; } catch { return null; } };
  return { root, source: 'project-pack', snapshot, identity, agentGuidance, get workspace() { return workspace ??= openWorkspace(root, { libraryDir, indexer: loadAssetIndex }); }, close() { workspace?.close(); } };
}
