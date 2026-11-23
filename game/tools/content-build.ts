// content-build: Kiln's output + the game's tables -> dist-content/, the pack the game loads.
//   node tools/content-build.ts [--check] [--profile mobile|web] [--chunks core,abode] [--out dir]
// --check validates everything and writes nothing. Without it the pack is written deterministically
// (no timestamps) and listed, with sha256s, in content.manifest.json; the game refuses a pack that does not match its manifest.
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, GAME, REPO, readJson, rel, sha256 } from './lib/repo.ts';
import { check } from './lib/schemas.ts';
import { loadAssets } from './lib/assets.ts';
import { crossCheck, loadTables, semanticCheck } from './lib/tables.ts';
import { encounterProblems, type Encounter } from '../src/sim/ai/boss.ts';
import { loadLayouts, validateAll, type RoomRow } from './lib/rooms.ts';
import { verifyLocks } from './lib/hitbox-edit.ts';
import { compileAudioEvents, compileBodies, compileClipEvents, compileTileShapes, readSidecars, verifyApprovals } from './lib/kiln-contract.ts';

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
const checkOnly = argv.includes('--check');
const profile = (flag('--profile') ?? 'mobile') as 'mobile' | 'web';
if (profile !== 'mobile' && profile !== 'web') throw new Error('--profile must be mobile or web');
const chunks = (flag('--chunks') ?? 'core,abode').split(',');
const out = path.resolve(flag('--out') ?? path.join(GAME, 'dist-content'));

const problems: string[] = [], warnings: string[] = [];
const files = new Map<string, Buffer>(); // path inside the pack -> bytes
const put = (name: string, data: unknown): void => { files.set(name, Buffer.from(`${JSON.stringify(data, null, 1)}\n`)); };

const assets = loadAssets(profile);
const sidecars = readSidecars();
const { tables, problems: tableProblems } = loadTables();
problems.push(...tableProblems);
const locale = { vi: readJson<Record<string, string>>(path.join(GAME, 'content/locale/vi.json')), en: readJson<Record<string, string>>(path.join(GAME, 'content/locale/en.json')) };
for (const k of Object.keys(locale.vi)) if (!(k in locale.en)) problems.push(`locale/en.json: missing key ${k}`);
for (const k of Object.keys(locale.en)) if (!(k in locale.vi)) problems.push(`locale/vi.json: missing key ${k}`);
for (const k of ['mob_blood_wolf', 'boss_ghost_king']) { // names are canon: they must equal the art manifest's names
  const n = assets.get(k)?.name;
  if (n && (locale.vi[k] !== n.vi || locale.en[k] !== n.en)) problems.push(`locale: ${k} differs from the manifest name`);
}
problems.push(...crossCheck(tables, assets, locale));
for (const [id, e] of Object.entries(tables.encounters)) problems.push(...encounterProblems(e as Encounter, new Set(tables.mobs.map((m) => String(m.id)))).map((m) => `encounters/${id}.yaml: ${m}`));
problems.push(...validateAll(tables.rooms as unknown as RoomRow[]));

const bodies = compileBodies(assets, sidecars), events = compileClipEvents(assets, sidecars), shapes = compileTileShapes(assets, sidecars), audio = compileAudioEvents(assets);
for (const c of [bodies, events, shapes, audio]) { problems.push(...c.problems); warnings.push(...c.warnings); }
const semantic = semanticCheck(tables, bodies.data.bodies);
problems.push(...semantic.errors); warnings.push(...semantic.warnings);
const approvals = verifyApprovals(bodies.data.bodies);
problems.push(...approvals.problems, ...verifyLocks());
// A draft is never shipped as approved: the build carries the status through, and the game's loader must treat anything but owner-approved as a placeholder.

put('tables.json', { mobs: tables.mobs, bosses: tables.bosses, rooms: tables.rooms });
for (const [id, e] of Object.entries(tables.encounters)) put(`encounters/${id}.json`, e);
for (const [id, layout] of loadLayouts()) put(`rooms/${id}.json`, layout);
put('locale/vi.json', locale.vi); put('locale/en.json', locale.en);
put('bodies.json', bodies.data); put('clip_events.json', events.data); put('tile_shapes.json', shapes.data); put('audio_events.json', audio.data);
put('assets.json', { schema: 'tien-nghich-2d.game-assets', version: 1, profile, assets: [...assets.values()].map(({ id, category, source, readiness, size, directions, clips, chunk }) => ({ id, category, source, readiness, size, directions, clips, chunk })) });
const vfx = readJson<{ effects: Record<string, unknown>[] }>(path.join(ASSETS, 'processed/vfx/vfx_index.json'));
put('vfx.json', { schema: 'tien-nghich-2d.game-vfx', version: 1, effects: vfx.effects.map(({ id, frame_size, anchor, fps, loop, frame_count, total_ms, tags, events: ev }) => ({ id, frame_size, anchor, fps, loop, frame_count, total_ms, tags, events: ev })) });

// Atlases: the permanent core, plus the Longtime chunks the slice needs. Each page is checked against its json and, for chunks, the chunk-manifest hashes.
const atlasPages: { chunk: string; image: string; json: string; frames: number }[] = [];
const pageFrames = (jsonFile: string): number => Object.keys(readJson<{ frames: object }>(jsonFile).frames).length;
for (const chunk of chunks) {
  const dir = chunk === 'core' ? path.join(ASSETS, 'atlases', profile) : path.join(ASSETS, 'atlases_longtime', profile, chunk);
  if (!fs.existsSync(dir)) { problems.push(`atlas chunk ${chunk}: ${rel(dir)} does not exist`); continue; }
  const jsons = fs.readdirSync(dir).filter((n) => /^atlas-\d+\.json$/.test(n)).sort();
  const cm = chunk === 'core' ? null : readJson<{ frame_count: number; pages: { json: string; image: string; json_sha256: string; png_sha256: string; frames: number }[] }>(path.join(dir, 'chunk-manifest.json'));
  let total = 0;
  for (const j of jsons) {
    const image = j.replace('.json', '.png');
    if (!fs.existsSync(path.join(dir, image))) { problems.push(`atlas ${chunk}/${j}: ${image} is missing`); continue; }
    const jb = fs.readFileSync(path.join(dir, j)), pb = fs.readFileSync(path.join(dir, image));
    const frames = pageFrames(path.join(dir, j));
    total += frames;
    const rec = cm?.pages.find((p) => p.json === j);
    if (cm && (!rec || rec.json_sha256 !== sha256(jb) || rec.png_sha256 !== sha256(pb))) problems.push(`atlas ${chunk}/${j}: does not match chunk-manifest.json`);
    files.set(`atlas/${chunk}/${j}`, jb); files.set(`atlas/${chunk}/${image}`, pb);
    atlasPages.push({ chunk, image: `atlas/${chunk}/${image}`, json: `atlas/${chunk}/${j}`, frames });
  }
  if (cm && total !== cm.frame_count) problems.push(`atlas ${chunk}: pages hold ${total} frames, chunk-manifest says ${cm.frame_count}`);
}
put('atlases.json', { schema: 'tien-nghich-2d.game-atlases', version: 1, profile, pages: atlasPages });

const listing = Object.fromEntries([...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([n, b]) => [n, { sha256: sha256(b), bytes: b.length }]));
const manifest = { schema: 'tien-nghich-2d.content-manifest', version: 1, profile, chunks, files: listing, contentHash: sha256(JSON.stringify(listing)) };
problems.push(...check('content-manifest.schema.json', manifest, 'content.manifest.json'));

for (const w of warnings) console.log(`warning: ${w}`);
if (problems.length) { for (const p of problems) console.error(`ERROR: ${p}`); console.error(`content-build FAILED: ${problems.length} problem(s)`); process.exit(1); }
const mib = (Object.values(listing).reduce((n, f) => n + f.bytes, 0) / 1048576).toFixed(1);
if (checkOnly) { console.log(`content-build --check OK: ${files.size} files, ${mib} MiB, ${atlasPages.length} atlas pages (${profile}; ${chunks.join(', ')}), hash ${manifest.contentHash.slice(0, 12)}`); process.exit(0); }
fs.rmSync(out, { recursive: true, force: true });
for (const [n, b] of files) { fs.mkdirSync(path.dirname(path.join(out, n)), { recursive: true }); fs.writeFileSync(path.join(out, n), b); }
fs.writeFileSync(path.join(out, 'content.manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`content-build wrote ${files.size + 1} files (${mib} MiB) to ${path.relative(REPO, out)}, hash ${manifest.contentHash.slice(0, 12)}`);
