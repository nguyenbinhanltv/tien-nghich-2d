import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GAME } from '../tools/lib/repo.ts';
import { loadTables, semanticCheck } from '../tools/lib/tables.ts';

/** A copy of the real sample content with one edit applied: the "wrong data" fixture the build must reject with a clear message. */
function broken(edits: Record<string, [string, string]>): { problems: string[]; semantic: { errors: string[]; warnings: string[] } } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-'));
  for (const sub of ['tables', 'encounters']) fs.cpSync(path.join(GAME, 'content', sub), path.join(root, sub), { recursive: true });
  for (const [file, [from, to]] of Object.entries(edits)) {
    const p = path.join(root, file), s = fs.readFileSync(p, 'utf8');
    if (!s.includes(from)) throw new Error(`fixture edit "${from}" not found in ${file}`);
    fs.writeFileSync(p, s.replace(from, to));
  }
  const { tables, problems } = loadTables(root);
  return { problems, semantic: semanticCheck(tables) };
}

describe('content validation: good data', () => {
  it('the sample content has no schema problems and no semantic errors', () => {
    const { tables, problems } = loadTables();
    expect(problems).toEqual([]);
    expect(semanticCheck(tables).errors).toEqual([]);
  });
});

describe('content validation: wrong data gives a readable message', () => {
  it('a wrong cell type names the file, row and field', () => {
    expect(broken({ 'tables/mobs.csv': ['mob_blood_wolf,14,62', 'mob_blood_wolf,many,62'] }).problems.join('\n')).toMatch(/mobs\.csv row 2\/hp|mobs\.csv row 2.*(number|integer)/);
  });
  it('a tell under 250 ms is rejected', () => {
    expect(broken({ 'tables/mobs.csv': ['attack,400', 'attack,100'] }).problems.join('\n')).toMatch(/mobs\.csv row 2.*(>=|minimum|250)/);
  });
  it('a room chain that loops back is an error naming the chain', () => {
    const r = broken({ 'tables/rooms.csv': ['room_bs_reward,blood_sea,reward,24,14,ts_blood_valley,,,', 'room_bs_reward,blood_sea,reward,24,14,ts_blood_valley,,,room_bs_1'] });
    expect(r.semantic.errors.join('\n')).toMatch(/chain loops back to room_bs_1/);
  });
  it('a boss phase that does not go down in hp_above, and a last phase above 0, are errors', () => {
    const e = broken({ 'encounters/oan_hon_quy_vuong.yaml': ['hp_above: 0.5', 'hp_above: 0'] }).semantic.errors.join('\n');
    expect(e).toMatch(/phase p2 has hp_above 0, it must be lower than the previous phase \(0\)/);
    expect(broken({ 'encounters/oan_hon_quy_vuong.yaml': ['hp_above: 0\n', 'hp_above: 0.1\n'] }).semantic.errors.join('\n')).toMatch(/last phase must have hp_above 0/);
  });
  it('a dodge window longer than the tell is an error', () => {
    expect(broken({ 'encounters/oan_hon_quy_vuong.yaml': ['dodge_window_ms: 280', 'dodge_window_ms: 2000'] }).semantic.errors.join('\n')).toMatch(/attack claw: dodge_window_ms 2000 is longer than the tell/);
  });
  it('a mob in a boss room, and a boss room without a boss, are errors', () => {
    const e = broken({ 'tables/rooms.csv': ['ts_blood_valley,,boss_ghost_king', 'ts_blood_valley,mob_blood_wolf:1,'] }).semantic.errors.join('\n');
    expect(e).toMatch(/room_bs_boss: only a combat room has mobs/);
    expect(e).toMatch(/room_bs_boss: a boss room needs a boss/);
  });
  it('a mob from another biome, a bad count and a duplicated id are errors', () => {
    expect(broken({ 'tables/mobs.csv': ['mob_blood_crow,8,48,1,swooper,1,blood_sea', 'mob_blood_crow,8,48,1,swooper,1,abode'] }).semantic.errors.join('\n')).toMatch(/mob_blood_crow is a abode mob in a blood_sea room/);
    expect(broken({ 'tables/rooms.csv': ['mob_blood_wolf:3', 'mob_blood_wolf:x'] }).semantic.errors.join('\n')).toMatch(/needs a positive count/);
    expect(broken({ 'tables/bosses.csv': ['boss_ghost_king,420', 'mob_blood_wolf,420'] }).semantic.errors.join('\n')).toMatch(/id is already used in mobs\.csv/);
  });
  it('an unreachable room and a chain with no reward end are errors', () => {
    const r = broken({ 'tables/rooms.csv': ['room_bs_2,blood_sea,combat,24,14,ts_blood_valley,mob_blood_corpse:3;mob_blood_wolf:2,,room_bs_3', 'room_bs_2,blood_sea,combat,24,14,ts_blood_valley,mob_blood_corpse:3;mob_blood_wolf:2,,'] });
    expect(r.semantic.errors.join('\n')).toMatch(/room_bs_3: not reachable from the abode/);
    expect(r.semantic.errors.join('\n')).toMatch(/room_bs_2: the chain ends here but it is a combat room/);
  });
});

describe('encounter hit ids against the boss hitboxes', () => {
  const { tables } = loadTables();
  const bodies = { boss_ghost_king: { clips: { attack_claw: { frames: { 2: { hitboxes: [{ id: 'claw_arc' }] } } } } } };
  it('warns when a hit id has no hitbox, and --strict makes it an error', () => {
    expect(semanticCheck(tables, bodies).warnings.join('\n')).toMatch(/attack wail: no hitbox named wail_ring on boss_ghost_king \(its hitboxes: claw_arc\)/);
    expect(semanticCheck(tables, bodies).errors).toEqual([]);
    expect(semanticCheck(tables, bodies, true).errors.join('\n')).toMatch(/no hitbox named wail_ring/);
  });
  it('says nothing when the boss has no body yet', () => { expect(semanticCheck(tables, {}).warnings).toEqual([]); });
});
