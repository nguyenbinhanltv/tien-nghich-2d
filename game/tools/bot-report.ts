// Headless bot report: the greedy dodger against the Ghost King over N seeds, at a few skill levels.
//   node tools/bot-report.ts [seeds=100] [biome=blood_sea|hengyue]
// The acceptance band for the default skill is 20-50% wins (plan E4.3); the other rows show that the fight reads the dodge.
import { loadTables } from './lib/tables.ts';
import { loadLayouts } from './lib/rooms.ts';
import type { BossRow, MobRow, RoomLayout, RoomRow } from '../src/contracts/content.ts';
import type { Encounter } from '../src/sim/ai/boss.ts';
import { contentFromTables } from '../src/sim/context.ts';
import { GREEDY, winRate } from '../src/sim/bot/greedy.ts';

const seeds = Number(process.argv[2] ?? 100), biome = process.argv[3] ?? 'blood_sea';
const bossRoom = biome === 'hengyue' ? 'room_hy_boss' : 'room_bs_boss';
const { tables } = loadTables();
const content = contentFromTables({ mobs: tables.mobs as unknown as MobRow[], bosses: tables.bosses as unknown as BossRow[], rooms: tables.rooms as unknown as RoomRow[], encounters: tables.encounters as Record<string, Encounter>, layouts: Object.fromEntries(loadLayouts()) as Record<string, RoomLayout> });
const rows: [string, typeof GREEDY][] = [['never dodges', { ...GREEDY, notice: 0 }], ['greedy dodger (default)', GREEDY], ['always notices', { ...GREEDY, notice: 1 }]];
console.log(`${biome}: boss hp ${(tables.bosses.find((b) => b.biome === biome) as unknown as BossRow).hp}, ${seeds} seeds, 2 minute limit per fight`);
for (const [name, skill] of rows) {
  const r = winRate(content, seeds, skill, 1, bossRoom);
  console.log(`${name.padEnd(26)} won ${String(r.won).padStart(3)}  lost ${String(r.lost).padStart(3)}  timeout ${String(r.timeout).padStart(3)}  rate ${(r.rate * 100).toFixed(0).padStart(3)}%  median ${(r.medianTicks / 60).toFixed(0)} s`);
}
