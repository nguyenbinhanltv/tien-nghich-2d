import { describe, expect, it } from 'vitest';
import { clusterNumber, runLines } from './floor-status.ts';
import { RUN_LINES_MAX_W } from './hud-layout.ts';
import { ALL_TABLES } from '../i18n/locales.ts';
import { REALM_II, PILL_REWARD } from '../sim/run/run.ts';
import { pressureAtFloor } from '../contracts/run.ts';
import { canDraw } from './pixel-font.ts';
import { measure } from './pixel-font.ts';

const tr = (loc: 'vi' | 'en') => (k: string) => ALL_TABLES[loc][k] ?? `[${k}]`;

describe('runLines', () => {
  it('realm and cluster in both languages, nothing for no run', () => {
    expect(runLines(tr('vi'), { cluster: 1, realm: 1 })).toEqual(['Tụ Khí I', 'Cụm 2/3']);
    expect(runLines(tr('vi'), { cluster: 2, realm: 2 })).toEqual(['Tụ Khí II', 'Cụm 3/3']);
    expect(runLines(tr('en'), { cluster: 0, realm: 1 })).toEqual(['Qi Cond. I', 'Cluster 1/3']);
    expect(runLines(tr('vi'), null)).toEqual([]);
  });
  it('the boss room (cluster 3) stays "3/3"; the pressure shows only above 1', () => {
    expect(clusterNumber(3)).toBe(3);
    expect(clusterNumber(-1)).toBe(1);
    expect(runLines(tr('vi'), { cluster: 0, realm: 1 }, 1).join(' ')).not.toContain('Áp lực');
    expect(runLines(tr('vi'), { cluster: 0, realm: 1 }, pressureAtFloor(10))[1]).toContain('Áp lực 1.3');
  });
  it('every character can be drawn by the pixel font; the two lines fit the wall band without pressure, and never leave the screen with it', () => {
    for (const loc of ['vi', 'en'] as const) {
      for (const line of runLines(tr(loc), { cluster: 2, realm: 2 }, 1)) {
        expect([...line].every(canDraw), `${loc}: ${line}`).toBe(true);
        expect(measure(line), `${loc}: ${line}`).toBeLessThanOrEqual(RUN_LINES_MAX_W);
      }
      for (const line of runLines(tr(loc), { cluster: 2, realm: 3 }, 2.5)) expect([...line].every(canDraw)).toBe(true);
    }
    expect(RUN_LINES_MAX_W).toBeGreaterThan(60);
  });
});

describe('gate strings stay true to the sim numbers', () => {
  it('breakthrough text states the health numbers of REALM_II and the pill text the pill amount, in both languages', () => {
    for (const loc of ['vi', 'en'] as const) {
      expect(ALL_TABLES[loc]['gate.breakthrough.desc']).toContain(`+${REALM_II.hpMax}`);
      expect(ALL_TABLES[loc]['gate.breakthrough.desc']).toContain(String(REALM_II.heal));
      expect(ALL_TABLES[loc]['gate.pill.desc']).toContain(String(PILL_REWARD.amount));
    }
  });
});
