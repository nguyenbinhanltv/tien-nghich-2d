// Pixel HUD maths (E8.1), pure so it is unit-tested: bar crop width and safe positions at 384x216 (text itself comes from the pixel font, ui/pixel-text.ts).
// The HUD is drawn at the logical resolution and scaled by the integer camera scale like everything else; sharp text (menus,
// result banner) lives in the DOM layer instead (owner decision 2026-11-23: pixel HUD, sharp menus).
import { VIEW_W } from '../contracts/world.ts';
import { mapSize } from './minimap-layout.ts';

export const BAR_W = 64;
export const BAR_H = 8;

/** Width in pixels of the filled part of a 64-wide bar. The left end stays fixed (GDD); any life left shows at least 1 px. */
export function barCropWidth(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(1, Math.min(BAR_W, Math.round((BAR_W * value) / max)));
}

/** 0..1 of the counter window or dodge cooldown left, clamped. */
export const ratio = (value: number, max: number): number => (max > 0 ? Math.min(1, Math.max(0, value / max)) : 0);

/** Margin from the screen edge in logical px. Larger on the sides, where phone notches and rounded corners sit. */
export const MARGIN = { x: 8, y: 6 } as const;
export const HUD_POS = {
  playerBar: { x: MARGIN.x, y: MARGIN.y },
  bossBar: { x: Math.round((VIEW_W - BAR_W) / 2), y: MARGIN.y },
} as const;

/** The minimap column in the top-right: the map (up to 3 cells wide), a 6-px gap and the floor label (reserved 64 px). */
export const FLOOR_LABEL_MAX_W = 64;
export const FLOOR_COLUMN_LEFT = VIEW_W - MARGIN.x - mapSize(99).w - 6 - FLOOR_LABEL_MAX_W;
/** The boss name may use the space between the boss bar's left edge and the floor column (4 px clear). */
export const BOSS_NAME_MAX_W = FLOOR_COLUMN_LEFT - 4 - HUD_POS.bossBar.x;

/** Free wall band between the player's HUD and the boss bar: the realm and cluster lines (ui/floor-status.ts) are drawn here. */
export const RUN_LINES_X = HUD_POS.playerBar.x + BAR_W + 8;
export const RUN_LINES_MAX_W = HUD_POS.bossBar.x - 4 - RUN_LINES_X;
