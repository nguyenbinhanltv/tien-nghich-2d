// The one entry a renderer, bot or test needs: construct a Sim, feed InputFrames, read WorldState and events.
import type { ContentApi } from './content.ts';
import type { GameEvent, InputFrame, WorldState } from './world.ts';
import type { SaveProfile } from './save.ts';

export interface SimOptions { seed: number; content?: ContentApi; profile?: SaveProfile }

export interface Sim {
  /** Live state. Read-only for everyone but the sim. */
  readonly world: WorldState;
  /** Advance exactly one tick and return the events it produced (the array is reused: copy to keep). */
  step(input: InputFrame): readonly GameEvent[];
  /** Canonical hash of the whole world, equal for equal seed + inputs. */
  hash(): string;
}
