import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSliceContent } from './content-loader.ts';
import { floorChain } from '../sim/run/floor.ts';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../dist-content');
const fromDisk = (url: string): Promise<{ ok: boolean; json(): Promise<unknown> }> => {
  const f = join(DIST, url.replace(/^content\//, ''));
  return Promise.resolve(existsSync(f) ? { ok: true, json: () => Promise.resolve(JSON.parse(readFileSync(f, 'utf8'))) } : { ok: false, json: () => Promise.reject(new Error('404')) });
};

describe('loadSliceContent', () => {
  it('rejects, naming the file, when something is missing (the game then falls back to the boss arena)', async () => {
    await expect(loadSliceContent(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }))).rejects.toThrow(/tables\.json/);
  });
  // dist-content is written by `npm run content:build` (part of `npm run build`); skipped on a tree that has not built it
  it.skipIf(!existsSync(join(DIST, 'tables.json')))('builds a ContentApi whose floor is the nine combat rooms and the boss, with layouts and the encounter', async () => {
    const c = await loadSliceContent(fromDisk);
    const chain = floorChain(c);
    expect(chain[0]).toBe('room_bs_1');
    expect(chain.at(-2)).toBe('room_bs_boss');
    for (const id of chain) expect(c.has('room_layouts', id), id).toBe(true);
    expect(c.has('encounters', 'oan_hon_quy_vuong')).toBe(true);
    expect(c.has('mobs', 'mob_blood_wolf')).toBe(true);
  });
});
