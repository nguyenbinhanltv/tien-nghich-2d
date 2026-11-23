// mob_vengeful_soul: fires a wailing orb (mob_shot) after a telegraphed aim line.
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import type { MobRow } from '../../contracts/content.ts';
import { COMBAT } from '../../contracts/combat.ts';
import { PROJECTILE_KINDS } from '../../contracts/pool.ts';
import { msToTicks } from '../../contracts/world.ts';
import { damageEnemy } from '../systems/combat.ts';
import { contentOf, makeFight, type Fight } from './harness.ts';
import { SHOOTER } from './params.ts';

const mobs = loadTables().tables.mobs as unknown as MobRow[];
const content = contentOf(mobs);
const SOUL = 'mob_vengeful_soul';
const TELL = msToTicks(mobs.find((m) => m.id === SOUL)!.tell_ms);
const mk = (seed = 1, x = 105): Fight => makeFight(seed, content, 200, 150, [[SOUL, x, 150]]);
const until = (f: Fight, cond: () => boolean, max = 1500): void => { for (let i = 0; i < max && !cond(); i++) f.tick(); };
const soulOf = (f: Fight) => f.world.actors.find((a) => a.id === f.mobs[0])!;
const MOB_SHOT = PROJECTILE_KINDS.indexOf('mob_shot');

describe('mob_vengeful_soul fires an orb', () => {
  it('is deterministic: same seed -> same hash', () => {
    const a = mk(7), b = mk(7);
    for (let i = 0; i < 1500; i++) { a.tick(); b.tick(); }
    expect(a.hash()).toBe(b.hash());
  });
  it('shows an aim line for the table tell (>= 250 ms) that deals no damage, then fires exactly one orb', () => {
    const f = mk();
    until(f, () => f.world.hazards.length > 0);
    const h = f.world.hazards[0]!;
    expect(h.owner).toBe(f.mobs[0]); expect(h.kind).toBe('claw'); expect(h.damage).toBe(0); expect(h.duration).toBe(TELL);
    expect(h.length).toBeCloseTo(SHOOTER.shotRange); expect(TELL).toBeGreaterThanOrEqual(msToTicks(250));
    expect(f.world.projectiles.count).toBe(0); // nothing flies during the tell
    until(f, () => f.world.hazards.length === 0);
    const shots = f.events.filter((e) => e.type === 'projectile-fired');
    expect(shots).toHaveLength(1);
    expect(f.world.projectiles.count).toBe(1);
    expect(f.world.projectiles.kind[0]).toBe(MOB_SHOT); expect(f.world.projectiles.owner[0]).toBe(f.mobs[0]);
    expect(f.events.filter((e) => e.type === 'hazard-resolved')).toHaveLength(0); // the aim line is never resolved on the player
  });
  it('the orb flies along the locked aim and hits a player who stands still', () => {
    const f = mk();
    until(f, () => f.world.hazards.length > 0);
    const aim = { ...f.world.hazards[0]!.dir };
    until(f, () => f.world.projectiles.count > 0);
    const p = f.world.projectiles;
    expect(p.vx[0]! / SHOOTER.shotSpeed).toBeCloseTo(aim.x, 3); expect(p.vy[0]! / SHOOTER.shotSpeed).toBeCloseTo(aim.y, 3);
    until(f, () => f.world.stats.hitsTaken > 0, 200);
    expect(f.world.stats.hitsTaken).toBe(1);
    expect(f.events.some((e) => e.type === 'projectile-hit' && e.target === f.player)).toBe(true);
  });
  it('a dash across the orb takes no damage, and the orb expires at the end of its range', () => {
    const f = mk();
    until(f, () => f.world.projectiles.count > 0);
    // the orb is on its way: dash across its line just before it arrives
    until(f, () => { const p = f.world.projectiles; return p.count > 0 && Math.hypot((p.x[0] as number) - f.world.actors[0]!.pos.x, (p.y[0] as number) - f.world.actors[0]!.pos.y) < 24; }, 200);
    f.tick({ move: { x: 0, y: 1 }, dash: true });
    for (let i = 0; i < Math.ceil(SHOOTER.shotRange / SHOOTER.shotSpeed) + 2; i++) f.tick({ move: { x: 0, y: 1 } });
    expect(f.world.stats.hitsTaken).toBe(0); expect(f.world.projectiles.count).toBe(0);
  });
  it('is open after the shot: it stands still for a window the player can punish', () => {
    const f = mk(), m = soulOf(f);
    let run = 0, best = 0;
    for (let i = 0; i < 1500; i++) { f.tick(); if (m.ai.state === 'recover') { run++; best = Math.max(best, run); expect(m.vel).toEqual({ x: 0, y: 0 }); } else run = 0; }
    expect(best).toBeGreaterThanOrEqual(msToTicks(500));
  });
  it('a counter stagger cancels the cast: the aim line goes and no orb is fired; it fires again later', () => {
    const f = mk(), m = soulOf(f);
    until(f, () => f.world.hazards.length > 0);
    m.combat.hurt = COMBAT.hurtPose; f.tick();
    expect(f.world.hazards).toHaveLength(0); expect(m.ai.state).toBe('recover');
    expect(f.world.projectiles.count).toBe(0);
    until(f, () => f.world.projectiles.count > 0);
    expect(f.world.projectiles.count).toBe(1);
  });
  it('killed mid-telegraph it leaves no aim line and fires nothing', () => {
    const f = mk(), m = soulOf(f);
    until(f, () => f.world.hazards.length > 0);
    damageEnemy(f.world, m, 999, f.player, false, f.events);
    for (let i = 0; i < COMBAT.freezeHit + 2 + TELL; i++) f.tick();
    expect(f.world.hazards).toHaveLength(0); expect(f.world.projectiles.count).toBe(0);
  });
  it('idles with no player', () => {
    const f = mk();
    f.world.actors[0]!.diedTick = 0;
    for (let i = 0; i < 30; i++) f.tick();
    expect(soulOf(f).vel).toEqual({ x: 0, y: 0 }); expect(soulOf(f).clip).toBe('idle');
  });
});
