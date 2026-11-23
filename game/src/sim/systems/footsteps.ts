// `step` clip events (contracts ClipEventName): the sim tells audio/VFX when a walking actor puts a foot down, so cues follow
// the real movement and not the animation clock. A pure function of state: an actor that moves emits every STEP ticks, offset by
// its id so a crowd does not step in unison. Flyers and floaters (crow, soul) do not step.
import type { ContentApi, MobRow } from '../../contracts/content.ts';
import type { GameEvent, WorldState } from '../../contracts/world.ts';

/** Ticks between footfalls: the player's run step (125 ms) and the heavier mobs. */
export const PLAYER_STEP_TICKS = 8, MOB_STEP_TICKS = 10;
const MIN_SPEED = 0.05;

export function footsteps(world: WorldState, content: ContentApi, events: GameEvent[]): void {
  for (const a of world.actors) {
    if (a.hp <= 0 || a.vel.x * a.vel.x + a.vel.y * a.vel.y < MIN_SPEED * MIN_SPEED) continue;
    let every = MOB_STEP_TICKS;
    if (a.role === 'player') { if (a.combat.dash > 0) continue; every = PLAYER_STEP_TICKS; }
    else if (a.role === 'mob') { const ai = content.get<MobRow>('mobs', a.kind).ai; if (ai !== 'charger' && ai !== 'brawler') continue; }
    if ((world.tick + a.id) % every === 0) events.push({ type: 'clip-event', tick: world.tick, actor: a.id, clip: 'move', name: 'step' });
  }
}
