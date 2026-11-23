// E4.3 acceptance: the greedy dodger beats Oán Hồn Quỷ Vương in 20-50% of seeds (reads the telegraph at 1x, has a phase change).
import { describe, expect, it } from 'vitest';
import { loadTables } from '../../../tools/lib/tables.ts';
import { loadLayouts } from '../../../tools/lib/rooms.ts';
import type { BossRow, MobRow, RoomLayout, RoomRow } from '../../contracts/content.ts';
import type { Encounter } from '../ai/boss.ts';
import { contentFromTables } from '../context.ts';
import { GREEDY, runBossFight, winRate } from './greedy.ts';

const { tables } = loadTables();
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: tables.rooms as unknown as RoomRow[], encounters: tables.encounters as Record<string, Encounter>, layouts: Object.fromEntries(loadLayouts()) as Record<string, RoomLayout> });
const SEEDS = 100;

describe('greedy dodger vs the boss', () => {
  it('is reproducible: same seed, same fight', () => {
    expect(runBossFight(5, content)).toEqual(runBossFight(5, content));
  });
  it(`wins 20-50% of ${SEEDS} seeds (placeholder numbers, tuned for this band)`, () => {
    const r = winRate(content, SEEDS);
    console.log('greedy dodger', JSON.stringify(r));
    expect(r.rate).toBeGreaterThanOrEqual(0.2); expect(r.rate).toBeLessThanOrEqual(0.5);
  }, 120_000);
  it('a bot that never notices a telegraph loses, and a perfect one wins more: the fight reads the dodge', () => {
    const blind = winRate(content, 30, { ...GREEDY, notice: 0 }), keen = winRate(content, 30, { ...GREEDY, notice: 1 });
    expect(blind.rate).toBeLessThan(winRate(content, 30).rate + 1e-9);
    expect(keen.rate).toBeGreaterThanOrEqual(winRate(content, 30).rate);
    expect(blind.rate).toBeLessThanOrEqual(0.1);
  }, 120_000);
});
