// E2.2: edit and lock the draft bodies in game/content/hitbox. A lock is NOT an approval (see lib/hitbox-edit.ts).
//   node tools/hitbox.ts show <id>
//   node tools/hitbox.ts set-hurtbox <id> x y w h [clip frame]     (clip+frame: override for that frame)
//   node tools/hitbox.ts set-pivot <id> x y
//   node tools/hitbox.ts set-hit <id> <clip> <frame> <hitId> x y w h
//   node tools/hitbox.ts rm-hit <id> <clip> <frame> <hitId>
//   node tools/hitbox.ts lock <id> | unlock <id> | status | check
// Add --dir <folder> to work on another folder (tests). Edits mark the body source "hand", status stays draft-unreviewed.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { loadAssets } from './lib/assets.ts';
import { ATTACK_CLIP } from './lib/hitbox-draft.ts';
import { HITBOX_DIR, isLocked, lintBody, lock, readBody, readLocks, removeHit, setHit, setHurtbox, setPivot, unlock, verifyLocks } from './lib/hitbox-edit.ts';

const attackClips = (a: { category: string; clips: Record<string, number> } | undefined): string[] => (a && (a.category === 'mob' || a.category === 'boss') ? Object.keys(a.clips).filter((c) => ATTACK_CLIP.test(c)) : []);

export function run(args: string[]): { out: string[]; code: number } {
  const out: string[] = [];
  let dir = HITBOX_DIR;
  const d = args.indexOf('--dir');
  if (d >= 0) { dir = args[d + 1]!; args = args.filter((_, i) => i !== d && i !== d + 1); }
  const [cmd, id, ...r] = args;
  const num = (v: string | undefined): number => { const n = Number(v); if (v === undefined || !Number.isInteger(n)) throw new Error(`expected an integer, got ${v}`); return n; };
  const box = (a: string[]) => ({ x: num(a[0]), y: num(a[1]), w: num(a[2]), h: num(a[3]) });
  try {
    switch (cmd) {
      case 'show': out.push(JSON.stringify(readBody(dir, id!), null, 1), isLocked(dir, id!) ? 'locked (edit lock, not an approval)' : 'not locked'); break;
      case 'set-hurtbox': setHurtbox(dir, id!, box(r), r.length >= 6 ? { clip: r[4]!, frame: num(r[5]) } : undefined); out.push(`${id}: hurtbox set (draft-unreviewed, source hand)`); break;
      case 'set-pivot': setPivot(dir, id!, [num(r[0]), num(r[1])]); out.push(`${id}: pivot set`); break;
      case 'set-hit': setHit(dir, id!, r[0]!, num(r[1]), r[2]!, box(r.slice(3))); out.push(`${id}: hitbox ${r[2]} set at ${r[0]}[${r[1]}]`); break;
      case 'rm-hit': removeHit(dir, id!, r[0]!, num(r[1]), r[2]!); out.push(`${id}: hitbox ${r[2]} removed`); break;
      case 'lock': lock(dir, id!); out.push(`${id}: locked (not approved)`); break;
      case 'unlock': unlock(dir, id!); out.push(`${id}: unlocked`); break;
      case 'status': {
        const locks = Object.keys(readLocks(dir).locks);
        const files = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => n.endsWith('.bodies.json')).map((n) => n.replace('.bodies.json', ''));
        out.push(`${files.length} draft bodies, ${locks.length} locked, 0 approved here (approval lives in assets/review/body_approvals.json)`, ...files.map((f) => `  ${f}${locks.includes(f) ? '  [locked]' : ''}`));
        break;
      }
      case 'check': {
        const assets = loadAssets('mobile');
        const problems = verifyLocks(dir), warnings: string[] = [];
        for (const f of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => n.endsWith('.bodies.json'))) {
          const bid = f.replace('.bodies.json', '');
          const l = lintBody(bid, readBody(dir, bid), attackClips(assets.get(bid)), assets.get(bid)?.clips);
          problems.push(...l.errors); warnings.push(...l.warnings);
        }
        out.push(...warnings.map((w) => `warning: ${w}`), ...problems.map((p) => `ERROR: ${p}`), problems.length ? `FAILED: ${problems.length} problem(s)` : 'hitbox check OK');
        return { out, code: problems.length ? 1 : 0 };
      }
      default: out.push('usage: show|set-hurtbox|set-pivot|set-hit|rm-hit|lock|unlock|status|check (see the header of tools/hitbox.ts)'); return { out, code: 2 };
    }
  } catch (e) { out.push(`ERROR: ${(e as Error).message}`); return { out, code: 1 }; }
  return { out, code: 0 };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = run(process.argv.slice(2));
  for (const l of r.out) (r.code ? console.error : console.log)(l);
  process.exit(r.code);
}
