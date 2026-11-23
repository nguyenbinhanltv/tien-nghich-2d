// Proposes DRAFT hurtboxes from the alpha channel. A proposal for a human to look at, never an approval:
// every body is written with review {status: "draft-unreviewed", source: "alpha-auto"}, the build carries that status
// through, and `kiln-contract-check --strict` fails on it. Nothing here touches assets/.
//   node tools/draft-bodies.ts [--assets id,id] [--out dir]      default out: dist-content/drafts
// Rule (docs/KILN_GAME_CONTRACT.md section 2.4): the hurtbox is the bounding box of pixels with alpha >= 128 on frame 0 of
// `idle` (first available direction: east, then south), inset by 1 px on each side so the outline does not count as body.
// Attack boxes (hitboxes) are NOT proposed: they carry design intent.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSETS, GAME, loadDecoder, readJson, rel } from './lib/repo.ts';
import type { Rgba } from './lib/repo.ts';
import type { Box } from './lib/kiln-contract.ts';

export const ALPHA_THRESHOLD = 128;

/** Bounding box of pixels at or above the threshold, shrunk by `inset` on every side; null if empty or too small. */
export function alphaBox(img: Rgba, inset = 1, threshold = ALPHA_THRESHOLD): Box | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if ((img.pixels[(y * img.width + x) * 4 + 3] ?? 0) >= threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const box = { x: x0 + inset, y: y0 + inset, w: x1 - x0 + 1 - 2 * inset, h: y1 - y0 + 1 - 2 * inset };
  return box.w >= 1 && box.h >= 1 ? box : null;
}

function findDir(id: string): string | null {
  for (const sub of fs.readdirSync(path.join(ASSETS, 'processed'), { withFileTypes: true })) {
    const d = path.join(ASSETS, 'processed', sub.name, id);
    if (sub.isDirectory() && fs.existsSync(d)) return d;
  }
  return null;
}

export async function draftFor(id: string): Promise<{ body: Record<string, unknown> } | { skip: string }> {
  const dir = findDir(id);
  if (!dir) return { skip: 'no processed frames' };
  const decode = await loadDecoder();
  const frame = ['east', 'south'].map((d) => path.join(dir, `idle_${d}_0.png`)).find((f) => fs.existsSync(f));
  if (!frame) return { skip: 'no idle frame 0 (idle_east_0.png or idle_south_0.png)' };
  const img = decode(fs.readFileSync(frame));
  const hurtbox = alphaBox(img);
  if (!hurtbox) return { skip: 'idle frame 0 is empty or too small' };
  const anchorFile = path.join(dir, 'anchor.json');
  const anchor = fs.existsSync(anchorFile) ? readJson<{ anchor_px?: [number, number] }>(anchorFile).anchor_px : undefined;
  return { body: { frameSize: [img.width, img.height], pivot: anchor ?? [Math.floor(img.width / 2), img.height - 1], hurtbox,
    review: { status: 'draft-unreviewed', source: 'alpha-auto', note: `alpha >= ${ALPHA_THRESHOLD} bbox of ${rel(frame)}, inset 1 px` } } };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const flag = (n: string): string | undefined => { const i = argv.indexOf(n); return i < 0 ? undefined : argv[i + 1]; };
  const ids = (flag('--assets') ?? 'mob_blood_wolf,mob_blood_crow,mob_blood_corpse,mob_blood_pool_lurker,boss_ghost_king').split(',');
  const out = path.resolve(flag('--out') ?? path.join(GAME, 'dist-content/drafts'));
  fs.mkdirSync(out, { recursive: true });
  for (const id of ids) {
    const r = await draftFor(id);
    if ('skip' in r) { console.log(`${id}: skipped (${r.skip})`); continue; }
    fs.writeFileSync(path.join(out, `${id}.bodies.json`), `${JSON.stringify(r.body, null, 1)}\n`);
    console.log(`${id}: draft hurtbox ${JSON.stringify((r.body as { hurtbox: Box }).hurtbox)} (draft-unreviewed)`);
  }
  console.log(`Drafts are in ${path.relative(process.cwd(), out)}. They are proposals: a human reviews them, then copies approved ones to assets/bodies/.`);
}
