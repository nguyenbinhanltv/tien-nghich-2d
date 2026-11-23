// E7.2: game events -> cue ids, through dist-content/audio_events.json (compiled from the audio manifest: asset id ->
// { release | tell | impact | outcome | stride | ... } and fusions already resolved). Nobody names a cue directly: callers
// say (role, asset id) or hand over a GameEvent. A boss tell outranks everything else (plan 4.3).
import type { GameEvent, WorldState } from '../contracts/world.ts';

export interface AudioEventsDoc {
  events: Record<string, Record<string, string>>;
  modes: Record<string, Record<string, string>>;
  silent: string[];
}
export interface CuePlay { cue: string; priority: number; role: string; asset: string }

/** Higher wins a voice. A boss tell is above everything and also ducks the rest (engine). */
export const PRIORITY = { bossTell: 100, hurt: 70, outcome: 60, counter: 55, dash: 50, tell: 40, impact: 30, release: 20, step: 10 } as const;

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

  private play(role: string, asset: string, priority: number): CuePlay[] {
    const cue = this.cue(role, asset);
    return cue ? [{ cue, priority, role, asset }] : [];
  }

  /** Cues for one sim event. `world` resolves actor ids to content kinds; unknown ids play nothing. */
  fromEvent(ev: GameEvent, world: Pick<WorldState, 'actors' | 'hazards'>): CuePlay[] {
    const actor = (id: number) => world.actors.find((a) => a.id === id);
    switch (ev.type) {
      case 'dash': { const a = actor(ev.actor); return a ? this.play('dash', a.kind, PRIORITY.dash) : []; }
      case 'dodge-counter': { const a = actor(ev.actor); return a ? this.play('evade', a.kind, PRIORITY.dash) : []; }
      case 'strike': { const a = actor(ev.actor); return a && ev.counter ? this.play('counter', a.kind, PRIORITY.counter) : []; }
      case 'hit': {
        const t = actor(ev.target);
        if (!t) return [];
        // the receiver's material impact, once; the player has its own hurt cue
        return t.role === 'player' ? this.play('hurt', t.kind, PRIORITY.hurt) : this.play('impact', t.kind, PRIORITY.impact);
      }
      case 'actor-died': { const a = actor(ev.actor); return a ? this.play(a.role === 'player' ? 'fall' : 'outcome', a.kind, PRIORITY.outcome) : []; }
      case 'clip-event': {
        const a = actor(ev.actor);
        if (!a) return [];
        if (ev.name === 'tell') return this.play('tell', a.kind, a.role === 'boss' ? PRIORITY.bossTell : PRIORITY.tell);
        if (ev.name === 'step') return a.role === 'player' ? this.play('stride', a.kind, PRIORITY.step) : [];
        return [];
      }
      case 'telegraph': {
        const h = world.hazards.find((x) => x.id === ev.hazard);
        const a = h ? actor(h.owner) : undefined;
        return a ? this.play('tell', a.kind, a.role === 'boss' ? PRIORITY.bossTell : PRIORITY.tell) : [];
      }
      case 'projectile-fired': return this.play('release', ev.kind, PRIORITY.release);
      case 'realm-breakthrough': { const p = world.actors.find((a) => a.role === 'player'); return p ? this.play('advance', p.kind, PRIORITY.outcome) : []; }
      default: return [];
    }
  }
}
