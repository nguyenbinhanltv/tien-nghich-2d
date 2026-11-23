// E7.2: game events -> cue ids, through dist-content/audio_events.json (compiled from the audio manifest: asset id ->
// { release | tell | impact | outcome | stride | ... } and fusions already resolved). Nobody names a cue directly: callers
// say (role, asset id) or hand over a GameEvent. A boss tell outranks everything else (plan 4.3).
import type { GameEvent, WorldState } from '../contracts/world.ts';

export interface AudioEventsDoc {
  events: Record<string, Record<string, string>>;
  modes: Record<string, Record<string, string>>;
  silent: string[];
}
export interface CuePlay { cue: string; priority: number; role: string; asset: string; /** 0..1 loudness of this cue (default 1). */ gain?: number }

/** Higher wins a voice. A boss tell is above everything and also ducks the rest (engine). */
export const PRIORITY = { bossTell: 100, hurt: 70, outcome: 60, counter: 55, dash: 50, tell: 40, impact: 30, door: 28, wall: 22, release: 20, step: 10 } as const;

/** A shot that ends on a wall or prop is stone: it uses the stone family's impact (asset below) and is quieter than a creature hit. */
export const WALL_ASSET = 'mob_stone_puppet';
export const GAIN = { step: 0.6, wall: 0.7 } as const;

/**
 * The sim's player actor has kind "player"; the audio table is keyed by the form asset. Same form as the renderer's
 * render/clip-map.ts PLAYER_FORM (a test keeps the two equal); the form will follow the realm when the run state exposes it (E5.3).
 */
export const PLAYER_FORM_ASSET = 'wl_outer_disciple';
/** Asset of each projectile kind (contracts/pool.ts PROJECTILE_KINDS). Placeholders like the renderer's shot sprites, until the weapons (E5.1). */
export const SHOT_ASSET: Record<string, string> = { spirit_blade: 'pj_blood_jade_blade', mob_shot: 'pj_soul_lamp', player_bolt: 'pj_azure_wind_sword' };
const assetOf = (a: { kind: string; role: string }): string => (a.role === 'player' ? PLAYER_FORM_ASSET : a.kind);

export class EventMap {
  private readonly doc: AudioEventsDoc;
  private readonly silent: Set<string>;
  constructor(doc: AudioEventsDoc) { this.doc = doc; this.silent = new Set(doc.silent); }

  /** The cue for a semantic role of an asset, or null (silent assets and roles the asset's family lacks play nothing). */
  cue(role: string, asset: string): string | null {
    if (this.silent.has(asset)) return null;
    return this.doc.events[asset]?.[role] ?? null;
  }
  /** audio.mode('core', 'boss') -> modes.core.boss */
  modeCue(mode: string, key: string): string | null { return this.doc.modes[mode]?.[key] ?? null; }

  private play(role: string, asset: string, priority: number, gain?: number): CuePlay[] {
    const cue = this.cue(role, asset);
    return cue ? [{ cue, priority, role, asset, ...(gain === undefined ? {} : { gain }) }] : [];
  }

  /** Cues for one sim event. `world` resolves actor ids to content kinds; unknown ids play nothing. */
  fromEvent(ev: GameEvent, world: Pick<WorldState, 'actors' | 'hazards'>): CuePlay[] {
    const actor = (id: number) => world.actors.find((a) => a.id === id);
    switch (ev.type) {
      case 'dash': { const a = actor(ev.actor); return a ? this.play('dash', assetOf(a), PRIORITY.dash) : []; }
      case 'dodge-counter': { const a = actor(ev.actor); return a ? this.play('evade', assetOf(a), PRIORITY.dash) : []; }
      case 'strike': { const a = actor(ev.actor); return a && ev.counter ? this.play('counter', assetOf(a), PRIORITY.counter) : []; }
      case 'hit': {
        const t = actor(ev.target);
        if (!t) return [];
        // the receiver's material impact, once; the player has its own hurt cue
        return t.role === 'player' ? this.play('hurt', assetOf(t), PRIORITY.hurt) : this.play('impact', assetOf(t), PRIORITY.impact);
      }
      case 'actor-died': { const a = actor(ev.actor); return a ? this.play(a.role === 'player' ? 'fall' : 'outcome', assetOf(a), PRIORITY.outcome) : []; }
      case 'clip-event': {
        const a = actor(ev.actor);
        if (!a) return [];
        if (ev.name === 'tell') return this.play('tell', assetOf(a), a.role === 'boss' ? PRIORITY.bossTell : PRIORITY.tell);
        // footfalls: only the player has a stride cue (the mob families have none, so their steps stay silent)
        if (ev.name === 'step') return a.role === 'player' ? this.play('stride', assetOf(a), PRIORITY.step, GAIN.step) : [];
        return [];
      }
      case 'telegraph': {
        const h = world.hazards.find((x) => x.id === ev.hazard);
        const a = h ? actor(h.owner) : undefined;
        return a ? this.play('tell', assetOf(a), a.role === 'boss' ? PRIORITY.bossTell : PRIORITY.tell) : [];
      }
      // a shot that hit a creature is voiced by that creature's `hit` event (the receiver's impact, once); one that hit a wall or prop is stone
      case 'projectile-hit': return ev.target === 0 ? this.play('impact', WALL_ASSET, PRIORITY.wall, GAIN.wall) : [];
      case 'door-opened': { const cue = this.modeCue('abode', 'door'); return cue ? [{ cue, priority: PRIORITY.door, role: 'door', asset: ev.room }] : []; }
      case 'projectile-fired': return this.play('release', SHOT_ASSET[ev.kind] ?? ev.kind, PRIORITY.release);
      case 'realm-breakthrough': { const p = world.actors.find((a) => a.role === 'player'); return p ? this.play('advance', assetOf(p), PRIORITY.outcome) : []; }
      default: return [];
    }
  }
}
