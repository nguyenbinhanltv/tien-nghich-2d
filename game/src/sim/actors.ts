import type { ActorRole, ActorState, GameEvent, WorldState } from '../contracts/world.ts';

export function createActor(world: WorldState, kind: string, x: number, y: number, hp: number, radius = 6): ActorState {
  const role: ActorRole = kind === 'player' ? 'player' : kind.startsWith('boss_') ? 'boss' : 'mob';
  return {
    id: world.nextActorId++, role, kind, pos: { x, y }, vel: { x: 0, y: 0 }, facing: 'south', hp, hpMax: hp, radius,
    clip: 'idle', clipStartTick: world.tick, invuln: 0, diedTick: -1,
    combat: { cool: 0, action: 0, dash: 0, guard: 0, guardSource: 'none', hurt: 0, counterWindow: 0, counterCast: false, slash: 0, down: 0, motion: { x: 1, y: 0 }, aim: { x: 1, y: 0 }, moving: false },
    ai: { state: 'idle', timer: 0, target: 0, data: [0, 0, 0, 0] },
  };
}

export function spawnActor(world: WorldState, kind: string, x: number, y: number, hp: number, events: GameEvent[], radius = 6): ActorState {
  const a = createActor(world, kind, x, y, hp, radius);
  world.actors.push(a);
  events.push({ type: 'actor-spawned', tick: world.tick, actor: a.id, kind });
  return a;
}

export function findPlayer(world: WorldState): ActorState | undefined {
  for (const a of world.actors) if (a.role === 'player') return a;
  return undefined;
}

export function findActor(world: WorldState, id: number): ActorState | undefined {
  for (const a of world.actors) if (a.id === id) return a;
  return undefined;
}

export const isAlive = (a: ActorState): boolean => a.hp > 0;

/** Nearest living enemy of the player (mob or boss) by squared distance; ties keep the earlier actor. */
export function nearestHostile(world: WorldState, x: number, y: number): ActorState | undefined {
  let best: ActorState | undefined, bd = Infinity;
  for (const a of world.actors) {
    if (a.role === 'player' || a.hp <= 0) continue;
    const dx = a.pos.x - x, dy = a.pos.y - y, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}
