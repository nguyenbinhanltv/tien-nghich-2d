// Voice budget (plan 8.1: at most 24 simultaneous). Pure bookkeeping so it can be tested without Web Audio.
export interface Voice { id: number; cue: string; priority: number; endsAt: number }

export class VoicePool {
  private voices: Voice[] = [];
  private nextId = 1;
  private readonly lastStart = new Map<string, number>();
  private readonly max: number;
  private readonly minRepeatMs: number;
  constructor(max = 24, minRepeatMs = 40) { this.max = max; this.minRepeatMs = minRepeatMs; }

  get active(): number { return this.voices.length; }

  /**
   * Ask for a voice at time `now` (ms). Returns the voice to start and the voice to steal (stop), or null when refused:
   * the same cue within `minRepeatMs`, or the pool is full of voices at least as important.
   */
  request(cue: string, priority: number, durationMs: number, now: number): { voice: Voice; steal: Voice | null } | null {
    this.voices = this.voices.filter((v) => v.endsAt > now);
    const last = this.lastStart.get(cue);
    if (last !== undefined && now - last < this.minRepeatMs) return null;
    let steal: Voice | null = null;
    if (this.voices.length >= this.max) {
      steal = this.voices.reduce((lo, v) => (v.priority < lo.priority || (v.priority === lo.priority && v.endsAt < lo.endsAt) ? v : lo));
      if (steal.priority >= priority) return null;
      this.voices = this.voices.filter((v) => v !== steal);
    }
    const voice: Voice = { id: this.nextId++, cue, priority, endsAt: now + durationMs };
    this.voices.push(voice);
    this.lastStart.set(cue, now);
    return { voice, steal };
  }
  release(id: number): void { this.voices = this.voices.filter((v) => v.id !== id); }
}
