// E2.2: hand edits and edit-locks for the draft bodies in game/content/hitbox. Pure data operations, tested without the CLI.
// A LOCK IS NOT AN APPROVAL. It only freezes a draft against accidental change (an edit or a drafting re-run) by recording the
// digest of the boxes; the body stays `draft-unreviewed`. Only the owner approves, in assets/review/body_approvals.json via Studio.
import fs from 'node:fs';
import path from 'node:path';
import { GAME } from './repo.ts';
import { bodyDigest } from './kiln-contract.ts';
import type { Box } from './kiln-contract.ts';
import { check } from './schemas.ts';

export const HITBOX_DIR = path.join(GAME, 'content/hitbox');
export const LOCK_FILE = '_locks.json';
export interface Locks { schema: 'tien-nghich-2d.hitbox-locks'; version: 1; note: string; locks: Record<string, { digest: string }> }
export type Body = Record<string, unknown> & { frameSize: [number, number]; pivot: [number, number]; hurtbox: Box; review: { status: string; source: string; note?: string; approvalRef?: string }; clips?: Record<string, { frames: Record<string, { hurtbox?: Box; hitboxes?: ({ id: string } & Box)[] }> }> };

const NOTE = 'Edit locks, NOT approvals. A lock freezes a draft body by the digest of its boxes; only the owner approves (assets/review/body_approvals.json).';
export const bodyFile = (dir: string, id: string): string => path.join(dir, `${id}.bodies.json`);
export const readBody = (dir: string, id: string): Body => {
  const f = bodyFile(dir, id);
  if (!fs.existsSync(f)) throw new Error(`no body for ${id} in ${dir}`);
  return JSON.parse(fs.readFileSync(f, 'utf8')) as Body;
};
export const writeBody = (dir: string, id: string, b: Body): void => { fs.writeFileSync(bodyFile(dir, id), `${JSON.stringify(b, null, 1)}\n`); };

export function readLocks(dir: string): Locks {
  const f = path.join(dir, LOCK_FILE);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) as Locks : { schema: 'tien-nghich-2d.hitbox-locks', version: 1, note: NOTE, locks: {} };
}
const writeLocks = (dir: string, l: Locks): void => {
  const sorted = Object.fromEntries(Object.entries(l.locks).sort(([a], [b]) => (a < b ? -1 : 1)));
  fs.writeFileSync(path.join(dir, LOCK_FILE), `${JSON.stringify({ ...l, note: NOTE, locks: sorted }, null, 1)}\n`);
};
export const isLocked = (dir: string, id: string): boolean => id in readLocks(dir).locks;

const intBox = (b: Box): void => {
  for (const [k, v] of Object.entries(b)) if (!Number.isInteger(v)) throw new Error(`box ${k} must be an integer, got ${v}`);
  if (b.w < 1 || b.h < 1) throw new Error('box w and h must be >= 1');
};
const insideFrame = (b: Body, box: Box, what: string): void => {
  if (box.x < 0 || box.y < 0 || box.x + box.w > b.frameSize[0] || box.y + box.h > b.frameSize[1]) throw new Error(`${what} leaves the ${b.frameSize.join('x')} frame`);
};
function touch(b: Body, what: string): Body {
  if (b.review.status === 'owner-approved') throw new Error('this body is owner-approved; edit assets/bodies through Studio, not here');
  b.review = { status: 'draft-unreviewed', source: 'hand', note: `${(b.review.note ?? '').replace(/; hand edit:.*$/, '')}; hand edit: ${what}` };
  const bad = check('bodies.schema.json#/$defs/body', b, 'body');
  if (bad.length) throw new Error(`edit makes the body invalid: ${bad.join('; ')}`);
  return b;
}
const assertUnlocked = (dir: string, id: string): void => { if (isLocked(dir, id)) throw new Error(`${id} is locked; run unlock first`); };

/** Every operation returns nothing and writes the file; a refused edit throws and leaves the file untouched. */
export function setHurtbox(dir: string, id: string, box: Box, where?: { clip: string; frame: number }): void {
  assertUnlocked(dir, id); intBox(box);
  const b = readBody(dir, id); insideFrame(b, box, 'hurtbox');
  if (where) (((b.clips ??= {})[where.clip] ??= { frames: {} }).frames[String(where.frame)] ??= {}).hurtbox = box; else b.hurtbox = box;
  writeBody(dir, id, touch(b, where ? `hurtbox ${where.clip}[${where.frame}]` : 'hurtbox'));
}
export function setPivot(dir: string, id: string, pivot: [number, number]): void {
  assertUnlocked(dir, id);
  const b = readBody(dir, id);
  if (!pivot.every(Number.isInteger) || pivot[0] < 0 || pivot[1] < 0 || pivot[0] >= b.frameSize[0] || pivot[1] >= b.frameSize[1]) throw new Error('pivot must be an integer pixel inside the frame');
  b.pivot = pivot;
  writeBody(dir, id, touch(b, 'pivot'));
}
export function setHit(dir: string, id: string, clip: string, frame: number, hitId: string, box: Box): void {
  assertUnlocked(dir, id); intBox(box);
  const b = readBody(dir, id); insideFrame(b, box, `hitbox ${hitId}`);
  const f = (((b.clips ??= {})[clip] ??= { frames: {} }).frames[String(frame)] ??= {});
  const list = (f.hitboxes ??= []);
  const i = list.findIndex((h) => h.id === hitId);
  if (i >= 0) list[i] = { id: hitId, ...box }; else list.push({ id: hitId, ...box });
  writeBody(dir, id, touch(b, `hitbox ${clip}[${frame}] ${hitId}`));
}
export function removeHit(dir: string, id: string, clip: string, frame: number, hitId: string): void {
  assertUnlocked(dir, id);
  const b = readBody(dir, id);
  const f = b.clips?.[clip]?.frames[String(frame)];
  const i = f?.hitboxes?.findIndex((h) => h.id === hitId) ?? -1;
  if (!f?.hitboxes || i < 0) throw new Error(`no hitbox ${hitId} at ${clip}[${frame}]`);
  f.hitboxes.splice(i, 1);
  if (!f.hitboxes.length) delete f.hitboxes;
  if (!Object.keys(f).length) delete b.clips![clip]!.frames[String(frame)];
  if (!Object.keys(b.clips![clip]!.frames).length) delete b.clips![clip];
  if (!Object.keys(b.clips!).length) delete b.clips;
  writeBody(dir, id, touch(b, `removed hitbox ${clip}[${frame}] ${hitId}`));
}

export function lock(dir: string, id: string): void {
  const b = readBody(dir, id);
  if (b.review.status === 'owner-approved') throw new Error('owner-approved bodies are not locked here; they are pinned by body_approvals.json');
  const l = readLocks(dir);
  l.locks[id] = { digest: bodyDigest(b) };
  writeLocks(dir, l);
}
export function unlock(dir: string, id: string): void {
  const l = readLocks(dir);
  if (!(id in l.locks)) throw new Error(`${id} is not locked`);
  delete l.locks[id];
  writeLocks(dir, l);
}

/** A locked body must still match its recorded digest, and its file must exist: an out-of-band change is an error. */
export function verifyLocks(dir: string = HITBOX_DIR): string[] {
  const problems: string[] = [];
  for (const [id, { digest }] of Object.entries(readLocks(dir).locks)) {
    if (!fs.existsSync(bodyFile(dir, id))) { problems.push(`hitbox lock: ${id} is locked but its body file is missing`); continue; }
    if (bodyDigest(readBody(dir, id)) !== digest) problems.push(`hitbox lock: ${id} changed after it was locked (digest mismatch); unlock, edit, lock again, or restore it`);
  }
  return problems;
}

/** Lint of one body: hitboxes of attack clips missing (warn), boxes outside the frame (error). */
export function lintBody(id: string, b: Body, attackClips: string[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = [], warnings: string[] = [];
  const out = (box: Box | undefined, at: string): void => { if (box && (box.x < 0 || box.y < 0 || box.x + box.w > b.frameSize[0] || box.y + box.h > b.frameSize[1])) errors.push(`${id}: ${at} leaves the frame`); };
  out(b.hurtbox, 'hurtbox');
  for (const [c, v] of Object.entries(b.clips ?? {})) for (const [n, f] of Object.entries(v.frames)) { out(f.hurtbox, `${c}[${n}].hurtbox`); f.hitboxes?.forEach((h) => out(h, `${c}[${n}] ${h.id}`)); }
  for (const c of attackClips) if (!Object.values(b.clips?.[c]?.frames ?? {}).some((f) => f.hitboxes?.length)) warnings.push(`${id}: attack clip ${c} has no hitbox`);
  return { errors, warnings };
}
