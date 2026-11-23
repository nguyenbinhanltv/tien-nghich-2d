import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GAME } from '../tools/lib/repo.ts';
import { HITBOX_DIR, lintBody, readBody, verifyLocks, writeBody } from '../tools/lib/hitbox-edit.ts';
import { run } from '../tools/hitbox.ts';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  fs.copyFileSync(path.join(HITBOX_DIR, 'mob_blood_wolf.bodies.json'), path.join(dir, 'mob_blood_wolf.bodies.json'));
});
const cli = (...a: string[]): { out: string[]; code: number } => run([...a, '--dir', dir]);

describe('hitbox edit tool (E2.2)', () => {
  it('edits mark the body hand-made but still draft-unreviewed', () => {
    expect(cli('set-hurtbox', 'mob_blood_wolf', '4', '12', '20', '18').code).toBe(0);
    const b = readBody(dir, 'mob_blood_wolf');
    expect(b.hurtbox).toEqual({ x: 4, y: 12, w: 20, h: 18 });
    expect(b.review).toMatchObject({ status: 'draft-unreviewed', source: 'hand' });
    expect(b.review).not.toHaveProperty('approvalRef');
  });
  it('sets and removes a hitbox and a per-frame hurtbox, and keeps the body schema-valid', () => {
    expect(cli('set-hit', 'mob_blood_wolf', 'attack', '2', 'bite', '20', '12', '8', '8').code).toBe(0);
    expect(readBody(dir, 'mob_blood_wolf').clips!.attack!.frames['2']!.hitboxes).toContainEqual({ id: 'bite', x: 20, y: 12, w: 8, h: 8 });
    expect(cli('set-hurtbox', 'mob_blood_wolf', '5', '13', '20', '17', 'attack', '2').code).toBe(0);
    expect(cli('rm-hit', 'mob_blood_wolf', 'attack', '2', 'bite').code).toBe(0);
    const f2 = readBody(dir, 'mob_blood_wolf').clips!.attack!.frames['2']!;
    expect(f2.hitboxes!.map((h) => h.id)).toEqual(['attack']);
    expect(f2.hurtbox).toEqual({ x: 5, y: 13, w: 20, h: 17 });
  });
  it('refuses bad boxes and leaves the file untouched', () => {
    const before = fs.readFileSync(path.join(dir, 'mob_blood_wolf.bodies.json'), 'utf8');
    for (const a of [['set-hurtbox', 'mob_blood_wolf', '30', '0', '10', '5'], ['set-hurtbox', 'mob_blood_wolf', '1', '1', '0', '5'], ['set-pivot', 'mob_blood_wolf', '40', '3'], ['set-hit', 'mob_blood_wolf', 'attack', '1', 'Bad-Id', '1', '1', '2', '2']])
      expect(cli(...a).code).toBe(1);
    expect(fs.readFileSync(path.join(dir, 'mob_blood_wolf.bodies.json'), 'utf8')).toBe(before);
  });
  it('refuses an unknown clip or an out-of-range frame and leaves the file untouched', () => {
    const f = path.join(dir, 'mob_blood_wolf.bodies.json'), before = fs.readFileSync(f, 'utf8');
    for (const a of [['set-hit', 'mob_blood_wolf', 'atack', '2', 'bite', '1', '1', '2', '2'], ['set-hit', 'mob_blood_wolf', 'attack', '99', 'bite', '1', '1', '2', '2'],
      ['set-hurtbox', 'mob_blood_wolf', '1', '1', '4', '4', 'atack', '1'], ['set-hurtbox', 'mob_blood_wolf', '1', '1', '4', '4', 'attack', '4']]) {
      const r = cli(...a);
      expect(r.code).toBe(1);
      expect(r.out.join()).toMatch(/has no clip atack|has 4 frames, there is no frame (99|4)/);
    }
    expect(fs.readFileSync(f, 'utf8')).toBe(before);
  });
  it('check catches a clip or frame that does not exist in an existing file', () => {
    const b = readBody(dir, 'mob_blood_wolf');
    b.clips = { ...b.clips, ghost: { frames: { 0: { hitboxes: [{ id: 'x', x: 1, y: 1, w: 2, h: 2 }] } } }, attack: { frames: { ...b.clips!.attack!.frames, 9: { hitboxes: [{ id: 'y', x: 1, y: 1, w: 2, h: 2 }] } } } };
    writeBody(dir, 'mob_blood_wolf', b);
    const r = cli('check');
    expect(r.code).toBe(1);
    expect(r.out.join('\n')).toMatch(/clip ghost, which the asset does not have/);
    expect(r.out.join('\n')).toMatch(/clip attack has 4 frames, boxes on frame 9/);
  });
  it('lock freezes: edits are refused, an out-of-band change fails verify, unlock allows editing again', () => {
    expect(cli('lock', 'mob_blood_wolf').out[0]).toMatch(/locked \(not approved\)/);
    expect(verifyLocks(dir)).toEqual([]);
    expect(cli('set-pivot', 'mob_blood_wolf', '3', '3')).toMatchObject({ code: 1 });
    const b = readBody(dir, 'mob_blood_wolf'); b.hurtbox = { ...b.hurtbox, w: b.hurtbox.w - 1 }; writeBody(dir, 'mob_blood_wolf', b);
    expect(verifyLocks(dir).join()).toMatch(/changed after it was locked/);
    expect(cli('check').code).toBe(1);
    expect(cli('unlock', 'mob_blood_wolf').code).toBe(0);
    expect(verifyLocks(dir)).toEqual([]);
    expect(cli('set-pivot', 'mob_blood_wolf', '15', '31').code).toBe(0);
  });
  it('a lock never changes the review status and never writes an approval', () => {
    cli('lock', 'mob_blood_wolf');
    expect(readBody(dir, 'mob_blood_wolf').review.status).toBe('draft-unreviewed');
    expect(fs.readFileSync(path.join(dir, '_locks.json'), 'utf8')).toMatch(/NOT approvals/);
  });
  it('refuses to edit an owner-approved body', () => {
    const b = readBody(dir, 'mob_blood_wolf'); b.review = { status: 'owner-approved', source: 'hand', approvalRef: 'x' }; writeBody(dir, 'mob_blood_wolf', b);
    expect(cli('set-pivot', 'mob_blood_wolf', '3', '3').out.join()).toMatch(/owner-approved/);
  });
  it('lints boxes outside the frame (error) and attack clips without hitbox (warning)', () => {
    const b = readBody(dir, 'mob_blood_wolf');
    b.hurtbox = { x: 30, y: 0, w: 5, h: 5 };
    const l = lintBody('mob_blood_wolf', b, ['attack', 'bite2']);
    expect(l.errors.join()).toMatch(/hurtbox leaves the frame/);
    expect(l.warnings.join()).toMatch(/bite2 has no hitbox/);
  });
  it('drafting with --write leaves a locked body alone', () => {
    fs.rmSync(path.join(dir, 'mob_blood_wolf.bodies.json'));
    fs.copyFileSync(path.join(HITBOX_DIR, 'mob_blood_wolf.bodies.json'), path.join(dir, 'mob_blood_wolf.bodies.json'));
    cli('set-pivot', 'mob_blood_wolf', '15', '31'); cli('lock', 'mob_blood_wolf');
    const out = execFileSync('node', [path.join(GAME, 'tools/draft-bodies.ts'), '--write', '--force', '--assets', 'mob_blood_wolf', '--out', dir], { encoding: 'utf8' });
    expect(out).toMatch(/locked, left alone/);
    expect(readBody(dir, 'mob_blood_wolf').pivot).toEqual([15, 31]);
    expect(verifyLocks(dir)).toEqual([]);
  });
  it('the tracked drafts pass their own check', () => { expect(run(['check']).code).toBe(0); });
});
