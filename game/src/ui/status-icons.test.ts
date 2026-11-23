import { describe, expect, it } from 'vitest';
import { BAR_W, HUD_POS } from './hud-layout.ts';
import { activeStatuses, STATUS_GAP, STATUS_ICON, STATUS_IDS, statusFrame, statusSlot } from './status-icons.ts';

const actor = (over: { invuln?: number; guard?: number; guardSource?: 'none' | 'dodge' | 'hurt'; counterWindow?: number } = {}) =>
  ({ invuln: over.invuln ?? 0, combat: { guard: over.guard ?? 0, guardSource: over.guardSource ?? 'none', counterWindow: over.counterWindow ?? 0 } }) as never;

describe('status icons', () => {
  it('nothing is active at rest', () => expect(activeStatuses(actor())).toEqual({ guard: false, counter: false, immune: false }));
  it('a dodge guard shows guard; the post-hurt blink (guardSource hurt) only blinks, so it shows immune but not guard', () => {
    expect(activeStatuses(actor({ guard: 5, guardSource: 'dodge', invuln: 5 }))).toEqual({ guard: true, counter: false, immune: true });
    expect(activeStatuses(actor({ guard: 30, guardSource: 'hurt', invuln: 30 }))).toEqual({ guard: false, counter: false, immune: true });
  });
  it('the counter window shows counter on its own', () => expect(activeStatuses(actor({ counterWindow: 20 }))).toEqual({ guard: false, counter: true, immune: false }));
  it('frames are the 16-px variants and the three slots fit under the 64-px bar without overlapping', () => {
    expect(STATUS_IDS.map(statusFrame)).toEqual(['ui/icon_status_guard/v16_none_0', 'ui/icon_status_counter/v16_none_0', 'ui/icon_status_immune/v16_none_0']);
    const slots = STATUS_IDS.map((_, i) => statusSlot(i));
    expect(slots[1]!.x - slots[0]!.x).toBe(STATUS_ICON + STATUS_GAP);
    expect(slots[2]!.x + STATUS_ICON).toBeLessThanOrEqual(HUD_POS.playerBar.x + BAR_W);
    expect(new Set(slots.map((s) => s.y)).size).toBe(1);
  });
});
