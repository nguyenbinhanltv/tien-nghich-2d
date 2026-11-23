// Keyboard + gamepad + touch reduced to one InputFrame per render frame (plan E8.3 starts here; rebinding comes later).
// Touch is the primary device: a floating joystick on the left, Dodge and Counter on the right (touch-controls.ts).
import type { InputFrame } from '../contracts/world.ts';

const DEAD = 0.18;
const KEY_DODGE = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyK']);
const KEY_COUNTER = new Set(['KeyJ', 'KeyL', 'Enter']);

export class InputHub {
  private readonly keys = new Set<string>();
  private dashLatch = false;
  private fireLatch = false;
  /** Set by the touch overlay: stick deflection in -1..1. */
  touchMove = { x: 0, y: 0 };
  /** What the player used last; the UI shows touch controls only after a touch (or on a coarse pointer). */
  lastSource: 'none' | 'key' | 'touch' | 'pad' = 'none';
  /** First user gesture of any kind (audio unlock, E7.1). */
  onGesture: () => void = () => {};

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (KEY_DODGE.has(e.code)) this.pressDash();
      if (KEY_COUNTER.has(e.code)) this.pressFire();
      this.lastSource = 'key';
      this.onGesture();
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    target.addEventListener('blur', () => { this.keys.clear(); this.touchMove = { x: 0, y: 0 }; });
  }

  pressDash(): void { this.dashLatch = true; }
  pressFire(): void { this.fireLatch = true; }

  private pad(): { x: number; y: number; dash: boolean; fire: boolean } {
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
      const dash = !!(p.buttons[0]?.pressed || p.buttons[6]?.pressed); // A / LT
      const fire = !!(p.buttons[2]?.pressed || p.buttons[1]?.pressed || p.buttons[7]?.pressed); // X / B / RT
      return { x, y, dash, fire };
    }
    return { x: 0, y: 0, dash: false, fire: false };
  }

  private padDashHeld = false;
  private padFireHeld = false;

  /** One call per render frame. dash/fire fire once per press (rising edge). */
  sample(): InputFrame {
    let x = this.touchMove.x;
    let y = this.touchMove.y;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    const p = this.pad();
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
