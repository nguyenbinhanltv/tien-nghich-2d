// The Kiln <-> game contract, as code: read what Kiln keeps per asset, compile the four game tables, check them.
// Spec: docs/KILN_GAME_CONTRACT.md. Schemas: game/schemas/*.schema.json.
//
// Sources (all optional today; the repository holds none, so every table compiles empty):
//   bodies       assets/bodies/<asset id>.bodies.json   (per-asset source, schema bodies.schema.json "body")
//                + Kiln's studio-metadata.json `hitbox` as the fallback default hurtbox
//   clip events  studio-metadata.json  clips.<clip>.{frameMs,events}      (Kiln, existing API)
//   tile shapes  studio-metadata.json  tiles.<sheet>.<n>.{shapes,animation} (Kiln, existing API)
//   audio        assets/audio_manifest.json
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { ASSETS, GAME, readJson, rel } from './repo.ts';
import type { AssetInfo } from './assets.ts';
import { check } from './schemas.ts';

export const DEFAULT_FRAME_MS = 100;
export const MIN_TELL_MS = 250;

export interface Box { x: number; y: number; w: number; h: number }
interface Sidecar { pivot?: [number, number]; hitbox?: Box; clips?: Record<string, { frameMs?: number[]; events?: { frame: number; name: string }[] }>; tiles?: Record<string, Record<string, { shapes?: unknown[]; animation?: unknown[] }>> }
export interface Compiled<T> { data: T; problems: string[]; warnings: string[] }

/** Every studio-metadata.json under assets/raw, keyed by the asset id (its parent directory's name). */
export function readSidecars(): Map<string, { file: string; data: Sidecar }> {
  const out = new Map<string, { file: string; data: Sidecar }>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'studio-metadata.json') out.set(path.basename(dir), { file: rel(p), data: readJson<Sidecar>(p) });
    }
  };
  const raw = path.join(ASSETS, 'raw');
  if (fs.existsSync(raw)) walk(raw);
  return out;
}

export function compileBodies(assets: Map<string, AssetInfo>, sidecars: Map<string, { file: string; data: Sidecar }>, dirs: string | string[] = [path.join(ASSETS, 'bodies'), path.join(GAME, 'content/hitbox')]): Compiled<{ schema: string; version: 1; bodies: Record<string, unknown> }> {
  const problems: string[] = [], warnings: string[] = [];
  const bodies: Record<string, unknown> = {};
  for (const dir of [dirs].flat()) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.bodies.json')).sort()) {
      const id = f.replace(/\.bodies\.json$/, '');
      const where = `${rel(path.join(dir, f))}`;
      let body: { frameSize: [number, number]; pivot: [number, number]; hurtbox: Box; clips?: Record<string, { frames: Record<string, { hurtbox?: Box; hitboxes?: Box[] }> }> };
      try { body = readJson(path.join(dir, f)); } catch (e) { problems.push(`${where}: not valid JSON (${(e as Error).message})`); continue; }
      const a = assets.get(id);
      if (!a) { problems.push(`${where}: unknown asset id ${id}`); continue; }
      // Folders are listed in precedence order: the first one holding an id wins (assets/bodies, the approved store, before the game/content/hitbox drafts).
      if (bodies[id]) { warnings.push(`${where}: ignored, ${id} already has a body from an earlier folder (delete this draft)`); continue; }
      const invalid = check('bodies.schema.json#/$defs/body', body, where);
      problems.push(...invalid);
      if (invalid.length) continue; // a body that failed its schema is never stored: later steps may rely on its shape
      if (a.size && (body.frameSize?.[0] !== a.size[0] || body.frameSize?.[1] !== a.size[1])) problems.push(`${where}: frameSize ${JSON.stringify(body.frameSize)} differs from the manifest size ${JSON.stringify(a.size)}`);
      const inside = (b: Box | undefined, at: string): void => {
        if (b && body.frameSize && (b.x + b.w > body.frameSize[0] || b.y + b.h > body.frameSize[1])) problems.push(`${where}: ${at} leaves the ${body.frameSize.join('x')} frame`);
      };
      inside(body.hurtbox, 'hurtbox');
      for (const [clip, c] of Object.entries(body.clips ?? {})) {
        const frames = a.clips[clip];
        if (frames === undefined) { problems.push(`${where}: ${id} has no clip ${clip}`); continue; }
        for (const [n, fb] of Object.entries(c.frames)) {
          if (Number(n) >= frames) problems.push(`${where}: clip ${clip} has ${frames} frames, no frame ${n}`);
          inside(fb.hurtbox, `${clip}[${n}].hurtbox`);
          fb.hitboxes?.forEach((h, i) => inside(h, `${clip}[${n}].hitboxes[${i}]`));
        }
      }
      bodies[id] = body;
    }
  }
  // Kiln's single hitbox is a default hurtbox, never an approval: it is only a fallback and is marked as such.
  for (const [id, s] of sidecars) {
    if (bodies[id] || !s.data.hitbox) continue;
    const a = assets.get(id);
    if (!a?.size) { warnings.push(`${s.file}: hitbox on unknown asset ${id}`); continue; }
    bodies[id] = { frameSize: a.size, pivot: s.data.pivot ?? [Math.floor(a.size[0] / 2), a.size[1] - 1], hurtbox: s.data.hitbox, review: { status: 'draft-unreviewed', source: 'hand', note: `from ${s.file} hitbox` } };
    const bad = check('bodies.schema.json#/$defs/body', bodies[id], `${s.file} (hitbox)`);
    problems.push(...bad);
    if (bad.length) delete bodies[id];
  }
  return { data: { schema: 'tien-nghich-2d.bodies', version: 1, bodies }, problems, warnings };
}

export function compileClipEvents(assets: Map<string, AssetInfo>, sidecars: Map<string, { file: string; data: Sidecar }>): Compiled<{ schema: string; version: 1; clips: Record<string, Record<string, unknown>> }> {
  const problems: string[] = [], warnings: string[] = [];
  const clips: Record<string, Record<string, unknown>> = {};
  for (const [id, s] of sidecars) {
    const a = assets.get(id);
    for (const [name, c] of Object.entries(s.data.clips ?? {})) {
      if (!c.events?.length) continue;
      if (!a) { problems.push(`${s.file}: events on unknown asset ${id}`); break; }
      const count = a.clips[name];
      if (count === undefined) { problems.push(`${s.file}: ${id} has no clip ${name}`); continue; }
      const late = c.events.filter((e) => e.frame >= count);
      if (late.length) { problems.push(`${s.file}: ${id}/${name} has ${count} frames, events on frame ${late.map((e) => e.frame).join(', ')} are out of range`); continue; }
      const metaMs = c.frameMs && c.frameMs.length === count;
      const frameMs = metaMs ? c.frameMs! : Array<number>(count).fill(DEFAULT_FRAME_MS);
      if (!metaMs) warnings.push(`${s.file}: ${id}/${name} has events but no frameMs; timed with the ${DEFAULT_FRAME_MS} ms default`);
      const start = (frame: number): number => frameMs.slice(0, frame).reduce((t, v) => t + v, 0);
      (clips[id] ??= {})[name] = { frameMs, totalMs: frameMs.reduce((t, v) => t + v, 0), frameMsSource: metaMs ? 'metadata' : 'default',
        events: [...c.events].sort((p, q) => p.frame - q.frame).map((e) => ({ frame: e.frame, name: e.name, atMs: start(e.frame) })) };
    }
  }
  const data = { schema: 'tien-nghich-2d.clip-events', version: 1 as const, clips };
  problems.push(...check('clip-events.schema.json', data, 'clip-events'));
  return { data, problems, warnings };
}

export function compileTileShapes(assets: Map<string, AssetInfo>, sidecars: Map<string, { file: string; data: Sidecar }>): Compiled<{ schema: string; version: 1; tilesets: Record<string, unknown> }> {
  const problems: string[] = [], warnings: string[] = [];
  const tilesets: Record<string, unknown> = {};
  for (const [id, s] of sidecars) {
    if (!s.data.tiles) continue;
    const a = assets.get(id);
    if (!a || a.category !== 'tileset' || !a.size) { problems.push(`${s.file}: tile data on ${id}, which is not a tileset in the manifests`); continue; }
    tilesets[id] = { tileSize: a.size, sheets: s.data.tiles };
  }
  const data = { schema: 'tien-nghich-2d.tile-shapes', version: 1 as const, tilesets };
  problems.push(...check('tile-shapes.schema.json', data, 'tile-shapes'));
  return { data, problems, warnings };
}

interface AudioManifest { core: { bgm: string[]; combat: string[]; progression_ui: string[] }; extensions: Record<string, { bgm: string[]; sfx: string[] }>; families: Record<string, Record<string, string>>; asset_groups: Record<string, string[]>; fusions: Record<string, { parents: [string, string]; shot: string }>; modes: Record<string, { events: Record<string, string> }> }

/** Plan section 4.3: asset -> its family's events; a fusion takes the first parent's release and the second parent's impact. */
export function compileAudioEvents(assets: Map<string, AssetInfo>): Compiled<{ schema: string; version: 1; events: Record<string, Record<string, string>>; modes: Record<string, Record<string, string>>; silent: string[] }> {
  const m = readJson<AudioManifest>(path.join(ASSETS, 'audio_manifest.json'));
  const problems: string[] = [], warnings: string[] = [];
  const cues = new Set([...m.core.bgm, ...m.core.combat, ...m.core.progression_ui, ...Object.values(m.extensions).flatMap((e) => [...e.bgm, ...e.sfx])]);
  const events: Record<string, Record<string, string>> = {};
  const silent: string[] = [];
  for (const [group, ids] of Object.entries(m.asset_groups)) {
    if (group === 'silent') { silent.push(...ids); continue; }
    const fam = m.families[group];
    if (!fam) { problems.push(`audio_manifest: asset group ${group} has no family`); continue; }
    for (const id of ids) events[id] = { ...fam };
  }
  for (const [id, f] of Object.entries(m.fusions)) {
    const [a, b] = f.parents;
    const release = events[a]?.release, impact = events[b]?.impact;
    if (!release || !impact) { problems.push(`audio_manifest: fusion ${id} needs the release of ${a} and the impact of ${b}`); continue; }
    events[id] = { release, impact };
    events[f.shot] = { release, impact };
  }
  for (const [id, ev] of Object.entries(events)) for (const [k, cue] of Object.entries(ev)) if (!cues.has(cue)) problems.push(`audio_manifest: ${id}.${k} -> ${cue} is not a cue the manifest declares`);
  const modes = Object.fromEntries(Object.entries(m.modes).map(([k, v]) => [k, v.events]));
  for (const [mode, ev] of Object.entries(modes)) for (const [k, cue] of Object.entries(ev)) if (!cues.has(cue)) problems.push(`audio_manifest: mode ${mode}.${k} -> ${cue} is not a declared cue`);
  const covered = new Set([...Object.keys(events), ...silent]);
  const missing = [...assets.values()].filter((a) => a.source === 'core' || a.source === 'longtime').map((a) => a.id).filter((id) => !covered.has(id));
  if (missing.length) warnings.push(`${missing.length} art ids have neither an audio group nor "silent" (first: ${missing.slice(0, 5).join(', ')})`);
  const data = { schema: 'tien-nghich-2d.audio-events', version: 1 as const, events, modes, silent: [...new Set(silent)].sort() };
  problems.push(...check('audio-events.schema.json', data, 'audio-events'));
  return { data, problems, warnings };
}

/** Contract lint (plan 5.3 item 4): a tell shorter than 250 ms, a tell with no later hit, an attack clip with no hitbox. */
export function lintClips(clipEvents: Compiled<{ clips: Record<string, Record<string, unknown>> }>['data'], attackClips: { asset: string; clip: string }[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  type Ev = { name: string; atMs: number };
  for (const { asset, clip } of attackClips) {
    const c = clipEvents.clips[asset]?.[clip] as { events: Ev[] } | undefined;
    if (!c) { warnings.push(`${asset}/${clip}: attack clip has no tell/hit events`); continue; }
    const tell = c.events.find((e) => e.name === 'tell'), hit = c.events.find((e) => e.name === 'hit');
    if (!tell || !hit) { warnings.push(`${asset}/${clip}: needs a tell and a hit event`); continue; }
    if (hit.atMs - tell.atMs < MIN_TELL_MS) errors.push(`${asset}/${clip}: tell lasts ${hit.atMs - tell.atMs} ms before the hit; the floor is ${MIN_TELL_MS} ms`);
  }
  return { errors, warnings };
}

const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);

/** What an owner approval binds to: the body without its `review` block, so editing a box voids the approval. */
export const bodyDigest = (body: Record<string, unknown>): string => {
  const rest = Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'review'));
  return crypto.createHash('sha256').update(canon(rest)).digest('hex');
};

/** A body may only say owner-approved if assets/review/body_approvals.json (written by a human in Studio, never by a tool) holds a matching digest. */
export function verifyApprovals(bodies: Record<string, unknown>, file = path.join(ASSETS, 'review/body_approvals.json')): { problems: string[]; approved: number; unreviewed: string[] } {
  const problems: string[] = [], unreviewed: string[] = [];
  let approved = 0;
  const ledger = fs.existsSync(file) ? readJson<{ approvals?: Record<string, { digests?: Record<string, string> }> }>(file) : { approvals: {} };
  for (const [id, b] of Object.entries(bodies)) {
    const body = b as { review: { status: string; approvalRef?: string } };
    if (body.review.status !== 'owner-approved') { unreviewed.push(id); continue; }
    const want = ledger.approvals?.[body.review.approvalRef ?? '']?.digests?.[id];
    if (!want) problems.push(`${id}: says owner-approved but ${rel(file)} has no entry ${body.review.approvalRef} for it`);
    else if (want !== bodyDigest(body as Record<string, unknown>)) problems.push(`${id}: the boxes changed after the owner approved them (digest mismatch)`);
    else approved++;
  }
  return { problems, approved, unreviewed };
}
