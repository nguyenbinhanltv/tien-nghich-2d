// The one audio API the game calls (plan 4.3): audio.emit(role, assetId), audio.mode(mode, key), audio.handle(events, world).
// Nobody passes a cue id; the table decides. Unlock happens on the first gesture the input hub reports.
import type { GameEvent, WorldState } from '../contracts/world.ts';
import { AudioEngine } from './audio-engine.ts';
import { EventMap, PRIORITY } from './event-map.ts';
import type { AudioEventsDoc } from './event-map.ts';

export class AudioDirector {
  readonly engine: AudioEngine;
  private map: EventMap | null = null;
  constructor(engine: AudioEngine = new AudioEngine()) { this.engine = engine; }

  /** Load the event table and packs. Failures leave the game silent, never broken. */
  async init(eventsUrl = 'content/audio_events.json'): Promise<void> {
    try {
      const [doc] = await Promise.all([fetch(eventsUrl).then((r) => r.json() as Promise<AudioEventsDoc>), this.engine.loadPacks()]);
      this.map = new EventMap(doc);
    } catch (e) {
      console.warn('audio disabled:', e);
    }
  }

  /** First user gesture (touch, key, pad). Cheap to call repeatedly. */
  unlock(): void {
    if (this.engine.unlocked) return;
    this.engine.unlock();
    void this.engine.preloadSprites().catch(() => { /* a missing sprite only silences its cues */ });
  }

  emit(role: string, asset: string, priority: number = PRIORITY.impact): void {
    const cue = this.map?.cue(role, asset);
    if (cue) void this.engine.playCue(cue, { priority });
  }

  /** Mode changes: `entry`/`boss`/`exit` start a bed, other keys are one-shot cues (bank, door, vow...). */
  mode(mode: string, key: string): void {
    const cue = this.map?.modeCue(mode, key);
    if (!cue) return;
    if (cue.startsWith('bgm_')) void this.engine.playBgm(cue);
    else void this.engine.playCue(cue, { priority: PRIORITY.outcome });
  }

  handle(events: readonly GameEvent[], world: Pick<WorldState, 'actors' | 'hazards'>): void {
    if (!this.map) return;
    for (const ev of events) for (const p of this.map.fromEvent(ev, world)) void this.engine.playCue(p.cue, { priority: p.priority, ...(p.gain === undefined ? {} : { gain: p.gain }) });
  }
}
