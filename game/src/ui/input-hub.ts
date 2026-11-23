// Keyboard + gamepad + touch reduced to one InputFrame per render frame (plan E8.3 starts here; rebinding comes later).
// Touch is the primary device: a floating joystick on the left, Dodge and Counter on the right (touch-controls.ts).
import type { InputFrame } from '../contracts/world.ts';
import { ACTIONS, DEFAULT_BINDINGS, DEFAULT_PAD } from './settings.ts';
import type { Action, Bindings, PadBindings } from './settings.ts';

const DEAD = 0.18;

export class InputHub {
  private readonly keys = new Set<string>();
  private codeToAction = new Map<string, Action>();
  private padBindings: PadBindings = DEFAULT_PAD;
  /** false while a menu is open: the game sees no input and pending presses are dropped. */
  enabled = true;
  /** Pause requested (Esc/P by default, pad Start, or the on-screen button). */
  onPause: () => void = () => {};
  private dashLatch = false;
  private fireLatch = false;
  /** Set by the touch overlay: stick deflection in -1..1. */
  touchMove = { x: 0, y: 0 };
  /** What the player used last; the UI shows touch controls only after a touch (or on a coarse pointer). */
  lastSource: 'none' | 'key' | 'touch' | 'pad' = 'none';
  /** First user gesture of any kind (audio unlock, E7.1). */
  onGesture: () => void = () => {};

  constructor(target: Window, bindings: Bindings = DEFAULT_BINDINGS, padBindings: PadBindings = DEFAULT_PAD) {
    this.setBindings(bindings);
    this.padBindings = padBindings;
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.onGesture();
      const action = this.codeToAction.get(e.code);
      if (action === 'pause') { e.preventDefault(); this.onPause(); return; }
      if (!this.enabled) return;
      this.keys.add(e.code);
      if (action === 'dash') this.pressDash();
      if (action === 'counter') this.pressFire();
      this.lastSource = 'key';
      if (action && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    target.addEventListener('blur', () => { this.keys.clear(); this.touchMove = { x: 0, y: 0 }; });
  }

  setBindings(b: Bindings): void {
    this.codeToAction = new Map();
    for (const a of ACTIONS) for (const c of b[a]) this.codeToAction.set(c, a);
  }
  setPadBindings(b: PadBindings): void { this.padBindings = b; }
  /** Drop held keys and pending presses (menu opened or closed). */
  reset(): void {
    this.keys.clear(); this.dashLatch = this.fireLatch = false; this.touchMove = { x: 0, y: 0 };
    this.followPad();
  }
  /** Remember which pad buttons are down right now, so a press that was already held (A on "Resume", B to go back, Start) only counts after release. */
  private followPad(): void {
    const p = this.pad();
    this.padDashHeld = p.dash; this.padFireHeld = p.fire; this.padStartHeld = p.start;
  }
  private held(a: Action): boolean { for (const [c, act] of this.codeToAction) if (act === a && this.keys.has(c)) return true; return false; }

  pressDash(): void { if (this.enabled) this.dashLatch = true; }
  pressFire(): void { if (this.enabled) this.fireLatch = true; }

  private pad(): { x: number; y: number; dash: boolean; fire: boolean; start: boolean } {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p?.connected) continue;
      let x = p.axes[0] ?? 0;
      let y = p.axes[1] ?? 0;
      if (Math.hypot(x, y) < DEAD) x = y = 0;
      if (p.buttons[14]?.pressed) x = -1;
      if (p.buttons[15]?.pressed) x = 1;
      if (p.buttons[12]?.pressed) y = -1;
      if (p.buttons[13]?.pressed) y = 1;
      const dash = this.padBindings.dash.some((n) => p.buttons[n]?.pressed);
      const fire = this.padBindings.counter.some((n) => p.buttons[n]?.pressed);
      return { x, y, dash, fire, start: !!p.buttons[9]?.pressed };
    }
    return { x: 0, y: 0, dash: false, fire: false, start: false };
  }

  private padDashHeld = false;
  private padFireHeld = false;
  private padStartHeld = false;

  /** One call per render frame. dash/fire fire once per press (rising edge). */
  sample(): InputFrame {
    if (!this.enabled) { this.followPad(); return { move: { x: 0, y: 0 }, aim: null, dash: false, fire: false }; }
    let x = this.touchMove.x;
    let y = this.touchMove.y;
    if (this.held('left')) x -= 1;
    if (this.held('right')) x += 1;
    if (this.held('up')) y -= 1;
    if (this.held('down')) y += 1;
    const p = this.pad();
    if (p.start && !this.padStartHeld) this.onPause();
    this.padStartHeld = p.start;
    x += p.x;
    y += p.y;
    if (p.dash && !this.padDashHeld) this.dashLatch = true;
    if (p.fire && !this.padFireHeld) this.fireLatch = true;
    if (p.dash || p.fire || p.x || p.y) { this.lastSource = 'pad'; this.onGesture(); }
    this.padDashHeld = p.dash;
    this.padFireHeld = p.fire;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    const frame: InputFrame = { move: { x, y }, aim: null, dash: this.dashLatch, fire: this.fireLatch };
    this.dashLatch = this.fireLatch = false;
    return frame;
  }
}
