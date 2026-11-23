// Sim actor -> art. The sim speaks content ids and a few clip names ("player", "attack", "attack_seal"); the atlas has its
// own names (form "wl_outer_disciple", "cast_attack", "soul_devour"). This is the only place that knows both.
import { COMBAT } from '../contracts/combat.ts';
import type { ActorState, WorldState } from '../contracts/world.ts';

/** Player forms by realm index until the run state exposes the form (E5.3). */
export const PLAYER_FORM = 'wl_outer_disciple';

export interface ArtClip { kind: string; clip: string; startTick: number }

/** Boss clips the sim names `attack_<hazard>`; the seal is the soul-devour clip in the art. */
const BOSS_CLIP: Record<string, string> = { attack_claw: 'attack_claw', attack_wail: 'attack_wail', attack_seal: 'soul_devour' };

/** Tick at which the 3-frame `hurt` clip began: `combat.hurt` counts down from COMBAT.hurtPose when the hit lands. */
const hurtStart = (world: Pick<WorldState, 'tick'>, a: ActorState): number => world.tick - (COMBAT.hurtPose - a.combat.hurt);

export function artOf(world: Pick<WorldState, 'mode' | 'tick'>, a: ActorState): ArtClip {
  if (a.role === 'player') {
    let clip = 'idle';
    if (a.diedTick >= 0 || a.combat.down > 0 || world.mode === 'falling' || world.mode === 'lost') clip = 'death';
    else if (a.combat.hurt > 0) return { kind: PLAYER_FORM, clip: 'hurt', startTick: hurtStart(world, a) };
    else if (a.clip === 'dash' && a.combat.dash > 0) clip = 'dash';
    else if (a.clip === 'attack' && a.combat.slash > 0) clip = 'cast_attack';
    else if (a.combat.moving) clip = 'run';
    const startTick = clip === 'dash' || clip === 'cast_attack' ? a.clipStartTick : clip === 'death' ? a.clipStartTick : 0;
    return { kind: PLAYER_FORM, clip, startTick };
  }
  if (a.role === 'boss') {
    if (a.hp <= 0 || a.ai.state === 'release') return { kind: a.kind, clip: 'death', startTick: a.clipStartTick };
    if (a.ai.state === 'warn' || a.ai.state === 'impact') return { kind: a.kind, clip: BOSS_CLIP[a.clip] ?? 'attack_claw', startTick: a.clipStartTick };
    return { kind: a.kind, clip: a.ai.state === 'stalk' ? 'move' : 'idle', startTick: 0 };
  }
  // mobs: dead -> death, a counter-struck mob flinches (hurt), otherwise move (their AI sets finer clips later)
  if (a.diedTick >= 0 || a.hp <= 0) return { kind: a.kind, clip: 'death', startTick: a.clipStartTick };
  if (a.combat.hurt > 0 && a.clip !== 'attack') return { kind: a.kind, clip: 'hurt', startTick: hurtStart(world, a) };
  return { kind: a.kind, clip: a.clip === 'attack' ? 'attack' : 'move', startTick: a.clip === 'attack' ? a.clipStartTick : 0 };
}
