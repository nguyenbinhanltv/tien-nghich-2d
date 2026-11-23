// E2.1: proposes DRAFT hurtboxes, pivots and attack hitboxes for the owner-approved-art ids of the vertical slice.
// A proposal for a human to look at, never an approval: every body is written with review {status: "draft-unreviewed",
// source: "alpha-auto"}, the build carries that status through, and `kiln-contract-check --strict` fails on it. Nothing here touches assets/.
//   node tools/draft-bodies.ts [--assets id,id] [--out dir]     default: all ids of approval owner_vs_baseline_2026-11-23, out game/dist-content/drafts
//   node tools/draft-bodies.ts --write                          out game/content/hitbox (the tracked draft store the build also reads); skips ids that already
//                                                               have a file there unless --force, so a hand-edited or locked body is never overwritten.
// Rules (docs/KILN_GAME_CONTRACT.md 2.3, extended for the slice; see lib/hitbox-draft.ts):
//   mob/boss/player  hurtbox = alpha >= 128 bbox of idle frame 0 (east, else south), inset 1 px. Pivot = anchor.json anchor_px.
//   mob/boss         + attack hitboxes from the protruding part of the east attack frames (reach) or the lunge frame; not for the player (damage = projectile).
//   projectile       hurtbox = alpha bbox of flight frame 0, inset 1 px; pivot = centre.
//   prop             hurtbox = alpha bbox of the resting frame 0 (idle/closed/intact/locked), inset 1 px; pivot = bottom centre.
//   tileset, weapon, ui, icon, vfx: no body (reason in the report).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSETS, GAME, loadDecoder, readJson, rel } from './lib/repo.ts';
import type { Rgba } from './lib/repo.ts';
import { loadAssets } from './lib/assets.ts';
import type { AssetInfo } from './lib/assets.ts';
import type { Box } from './lib/kiln-contract.ts';
import { ALPHA_THRESHOLD, alphaBox, ATTACK_CLIP, bodyClass, clampBox, draftClipHits, NO_BODY_REASON } from './lib/hitbox-draft.ts';

export { ALPHA_THRESHOLD, alphaBox };
export const VS_APPROVAL = 'owner_vs_baseline_2026-11-23';

export interface DraftBody {
  frameSize: [number, number]; pivot: [number, number]; hurtbox: Box;
  review: { status: 'draft-unreviewed'; source: 'alpha-auto'; note: string };
  clips?: Record<string, { frames: Record<string, { hurtbox?: Box; hitboxes: ({ id: string } & Box)[] }> }>;
}
export type Draft = { body: DraftBody; hits: { clip: string; frame: number; how: string }[] } | { skip: string };

export function findDir(id: string): string | null {
  for (const sub of fs.readdirSync(path.join(ASSETS, 'processed'), { withFileTypes: true })) {
    const d = path.join(ASSETS, 'processed', sub.name, id);
    if (sub.isDirectory() && fs.existsSync(d)) return d;
  }
  return null;
}

/** The ids the owner approved art for in the vertical slice (read from the ledger, never hard-coded). */
export function vsIds(): string[] {
  const ledger = readJson<{ approvals: { id: string; assets?: Record<string, unknown> }[] }>(path.join(ASSETS, 'review/art_approvals.json'));
  const a = ledger.approvals.find((x) => x.id === VS_APPROVAL);
  if (!a?.assets) throw new Error(`${VS_APPROVAL} not found in assets/review/art_approvals.json`);
  return Object.keys(a.assets);
}

export async function draftFor(id: string, info?: AssetInfo): Promise<Draft> {
  info ??= loadAssets('mobile').get(id);
  if (!info) return { skip: fs.existsSync(path.join(ASSETS, 'processed/vfx', `${id}.json`)) ? NO_BODY_REASON.vfx! : 'not in the art manifests' };
  const cls = bodyClass(info.category);
  if (cls === 'none') return { skip: NO_BODY_REASON[info.category] ?? `category ${info.category} has no body` };
  const dir = findDir(id);
  if (!dir) return { skip: 'no processed frames' };
  const decode = await loadDecoder();
  const load = (file: string): Rgba | null => { const p = path.join(dir, file); return fs.existsSync(p) ? decode(fs.readFileSync(p)) : null; };
  const dirs = cls === 'actor' || cls === 'player' ? ['east', 'south'] : ['none'];
  // The resting state: idle for actors, flight for projectiles, and the first of idle/closed/intact/locked a prop has (chest, jar, door).
  const idleName = cls === 'projectile' ? 'flight' : (['idle', 'closed', 'intact', 'locked'].find((c) => c in info.clips) ?? 'idle');
  const pick = dirs.map((d) => ({ d, img: load(`${idleName}_${d}_0.png`) })).find((x) => x.img);
  if (!pick?.img) return { skip: `no ${idleName} frame 0` };
  const img = pick.img;
  const hurtbox = alphaBox(img);
  if (!hurtbox) return { skip: `${idleName} frame 0 is empty or too small` };
  const anchorFile = path.join(dir, 'anchor.json');
  const anchor = fs.existsSync(anchorFile) ? readJson<{ anchor_px?: [number, number] }>(anchorFile).anchor_px : undefined;
  const pivot: [number, number] = anchor ?? (cls === 'projectile' ? [img.width >> 1, img.height >> 1] : [img.width >> 1, img.height - 1]);
  const body: DraftBody = { frameSize: [img.width, img.height], pivot, hurtbox,
    review: { status: 'draft-unreviewed', source: 'alpha-auto', note: `alpha >= ${ALPHA_THRESHOLD} bbox of ${idleName}_${pick.d}_0, inset 1 px` } };
  const hits: { clip: string; frame: number; how: string }[] = [];
  if (cls === 'actor') {
    const bodyFull = alphaBox(img, 0)!;
    for (const [clip, count] of Object.entries(info.clips)) {
      if (!ATTACK_CLIP.test(clip)) continue;
      const frames: Rgba[] = [];
      for (let n = 0; n < count; n++) { const f = load(`${clip}_east_${n}.png`); if (f) frames.push(f); }
      if (frames.length !== count) continue; // missing east frames: say nothing rather than guess
      for (const h of draftClipHits(frames, bodyFull, clip)) {
        ((body.clips ??= {})[clip] ??= { frames: {} }).frames[String(h.frame)] = { hitboxes: [{ id: h.id, ...clampBox(h.box, img.width, img.height) }] };
        hits.push({ clip, frame: h.frame, how: h.how });
      }
    }
    if (hits.length) body.review.note += `; attack hitboxes guessed from east attack frames (${[...new Set(hits.map((h) => h.how))].join('/')}), no clip events exist yet`;
  }
  return { body, hits };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const flag = (n: string): string | undefined => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
  const write = argv.includes('--write'), force = argv.includes('--force');
  const ids = flag('--assets')?.split(',') ?? vsIds();
  const out = path.resolve(flag('--out') ?? (write ? path.join(GAME, 'content/hitbox') : path.join(GAME, 'dist-content/drafts')));
  fs.mkdirSync(out, { recursive: true });
  const assets = loadAssets('mobile');
  let wrote = 0, kept = 0, skipped = 0;
  for (const id of ids) {
    const r = await draftFor(id, assets.get(id));
    if ('skip' in r) { skipped++; console.log(`${id}: no body (${r.skip})`); continue; }
    const file = path.join(out, `${id}.bodies.json`);
    if (write && fs.existsSync(file) && !force) { kept++; console.log(`${id}: kept existing ${rel(file)}`); continue; }
    fs.writeFileSync(file, `${JSON.stringify(r.body, null, 1)}\n`);
    wrote++;
    console.log(`${id}: draft hurtbox ${JSON.stringify(r.body.hurtbox)}, ${r.hits.length} hitbox frame(s) (draft-unreviewed)`);
  }
  console.log(`${wrote} written, ${kept} kept, ${skipped} without a body, in ${path.relative(process.cwd(), out)}. Proposals only: the owner reviews them.`);
}
