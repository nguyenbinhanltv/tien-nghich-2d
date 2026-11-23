// Status icons of the HUD (PX-1): which of the three states the sim already has are active, and where their 16-px icons sit.
// Pure so it is unit-tested; the Hud draws them from the real atlas frames `ui/icon_status_<id>/v16_none_0`.
import type { ActorState } from '../contracts/world.ts';
import { BAR_H, HUD_POS } from './hud-layout.ts';
import { DIGIT_H } from './pixel-text.ts';

export const STATUS_IDS = ['guard', 'counter', 'immune'] as const;
export type StatusId = (typeof STATUS_IDS)[number];
export const STATUS_ICON = 16;
export const STATUS_GAP = 2;

/** Frame of a status icon in the core atlas (processed/icons maps to the `ui` key group). */
export const statusFrame = (id: StatusId): string => `ui/icon_status_${id}/v16_none_0`;

/** Active states of an actor: guard = a dodge guard window, counter = the strike window after a timed dodge, immune = damage immunity (dash, hurt blink, dodge). */
export function activeStatuses(a: Pick<ActorState, 'invuln' | 'combat'>): Record<StatusId, boolean> {
  return {
    guard: a.combat.guard > 0 && a.combat.guardSource === 'dodge',
    counter: a.combat.counterWindow > 0,
    immune: a.invuln > 0,
  };
}

/** Top-left of slot `index`: a row of 16-px icons under the counter-window bar, left-aligned with the player bar (3 slots fit the 64-px bar). */
export function statusSlot(index: number): { x: number; y: number } {
  const barY = HUD_POS.playerBar.y + BAR_H + 3 + DIGIT_H + 3;   // the counter bar row (hud.ts)
  return { x: HUD_POS.playerBar.x + index * (STATUS_ICON + STATUS_GAP), y: barY + 5 + 3 };
}
