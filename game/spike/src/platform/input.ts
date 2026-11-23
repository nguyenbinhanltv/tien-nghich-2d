// Keyboard + mouse + Gamepad API + virtual touch controls, merged into one sim Input per frame.
import { BTN_COUNTER, BTN_DODGE, type Input } from "../sim/world.ts";

export interface PressStamp {
  btn: number;
  t: number; // event.timeStamp (ms, same clock as performance.now())
  src: "key" | "mouse" | "touch" | "pad";
}

const DEAD = 0.18;

export class InputHub {
  private keys = new Set<string>();
  private latch = 0;
  private held = 0;
  /** press events not yet consumed by the sim (for latency measurement) */
  pending: PressStamp[] = [];
  // virtual stick
  private stickId = -1;
  private stickOx = 0;
  private stickOy = 0;
  private stickX = 0;
  private stickY = 0;
  private btnIds = new Map<number, number>(); // pointerId -> btn bit
  padSeen = false;
  private padHeld = 0;
  private ui: { base: HTMLElement; knob: HTMLElement } | null = null;
  lastSource: "key" | "mouse" | "touch" | "pad" | "none" = "none";
  onGesture: (t: number) => void = () => {};

  private root: HTMLElement;
  constructor(root: HTMLElement, _canvasEl: HTMLElement) {
    this.root = root;
    addEventListener("keydown", (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const b = this.keyBtn(e.code);
      if (b) this.press(b, e.timeStamp, "key");
      this.lastSource = "key";
      this.onGesture(e.timeStamp);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      const b = this.keyBtn(e.code);
      if (b) this.held &= ~b;
    });
    addEventListener("blur", () => {
      this.keys.clear();
      this.held = 0;
    });
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    // Desktop mouse: left = counter, right = dodge. Touch pointers are handled by the on-screen controls.
    root.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      this.press(e.button === 2 ? BTN_DODGE : BTN_COUNTER, e.timeStamp, "mouse");
      this.lastSource = "mouse";
      this.onGesture(e.timeStamp);
    });
    root.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") this.held &= ~(e.button === 2 ? BTN_DODGE : BTN_COUNTER);
    });
    this.buildTouchUi();
  }

  private keyBtn(code: string): number {
    if (code === "Space" || code === "ShiftLeft" || code === "KeyK") return BTN_DODGE;
    if (code === "KeyJ" || code === "KeyL") return BTN_COUNTER;
    return 0;
  }
  private press(btn: number, t: number, src: PressStamp["src"]): void {
    this.latch |= btn;
    this.held |= btn;
    if (this.pending.length < 64) this.pending.push({ btn, t, src });
  }

  private buildTouchUi(): void {
    const css = document.createElement("style");
    css.textContent = `
      .tc{position:absolute;inset:0;touch-action:none;user-select:none;-webkit-user-select:none;pointer-events:none}
      .tc .zone{position:absolute;left:0;top:30%;width:58%;bottom:0;pointer-events:auto;touch-action:none}
      .tc .base{position:absolute;width:96px;height:96px;margin:-48px 0 0 -48px;border-radius:50%;border:2px solid #d7c9a3aa;background:#14101a66;display:none}
      .tc .knob{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:#d7c9a3cc}
      .tc .btn{position:absolute;width:76px;height:76px;border-radius:50%;border:2px solid #d7c9a3;background:#14101acc;color:#d7c9a3;font:600 14px system-ui;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none}
      .tc .btn.on{background:#a8322acc}
      .tc .dodge{right:100px;bottom:44px}.tc .counter{right:14px;bottom:96px;width:88px;height:88px}`;
    document.head.appendChild(css);
    const tc = document.createElement("div");
    tc.className = "tc";
    tc.innerHTML = `<div class="zone"></div><div class="base"><div class="knob"></div></div>
      <div class="btn dodge" data-b="1">Né</div><div class="btn counter" data-b="2">Phản</div>`;
    this.root.appendChild(tc);
    const zone = tc.querySelector<HTMLElement>(".zone")!;
    const base = tc.querySelector<HTMLElement>(".base")!;
    const knob = tc.querySelector<HTMLElement>(".knob")!;
    this.ui = { base, knob };
    const R = 48;
    zone.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" || this.stickId !== -1) return;
      zone.setPointerCapture(e.pointerId);
      this.stickId = e.pointerId;
      const r = tc.getBoundingClientRect();
      this.stickOx = e.clientX;
      this.stickOy = e.clientY;
      this.stickX = this.stickY = 0;
      base.style.display = "block";
      base.style.left = `${e.clientX - r.left}px`;
      base.style.top = `${e.clientY - r.top}px`;
      knob.style.transform = "translate(0,0)";
      this.lastSource = "touch";
      this.onGesture(e.timeStamp);
    });
    zone.addEventListener("pointermove", (e) => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.stickOx;
      let dy = e.clientY - this.stickOy;
      const m = Math.hypot(dx, dy);
      if (m > R) {
        dx = (dx / m) * R;
        dy = (dy / m) * R;
      }
      this.stickX = dx / R;
      this.stickY = dy / R;
      knob.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = -1;
      this.stickX = this.stickY = 0;
      base.style.display = "none";
    };
    zone.addEventListener("pointerup", end);
    zone.addEventListener("pointercancel", end);
    for (const b of tc.querySelectorAll<HTMLElement>(".btn")) {
      const bit = Number(b.dataset.b);
      b.addEventListener("pointerdown", (e) => {
        b.setPointerCapture(e.pointerId);
        this.btnIds.set(e.pointerId, bit);
        b.classList.add("on");
        this.press(bit, e.timeStamp, "touch");
        this.lastSource = "touch";
        this.onGesture(e.timeStamp);
      });
      const up = (e: PointerEvent) => {
        if (this.btnIds.get(e.pointerId) !== bit) return;
        this.btnIds.delete(e.pointerId);
        this.held &= ~bit;
        b.classList.remove("on");
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
    }
  }

  private pollPad(now: number): { x: number; y: number } {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      this.padSeen = true;
      let x = p.axes[0] ?? 0;
      let y = p.axes[1] ?? 0;
      if (Math.hypot(x, y) < DEAD) x = y = 0;
      if (p.buttons[14]?.pressed) x = -1;
      if (p.buttons[15]?.pressed) x = 1;
      if (p.buttons[12]?.pressed) y = -1;
      if (p.buttons[13]?.pressed) y = 1;
      let held = 0;
      if (p.buttons[0]?.pressed || p.buttons[6]?.pressed) held |= BTN_DODGE; // A / LT
      if (p.buttons[2]?.pressed || p.buttons[1]?.pressed || p.buttons[7]?.pressed) held |= BTN_COUNTER; // X / B / RT
      const rising = held & ~this.padHeld;
      this.padHeld = held;
      if (rising) {
        // The Gamepad API has no per-event timestamp; use the poll time (real latency adds the device polling interval).
        for (const bit of [BTN_DODGE, BTN_COUNTER]) if (rising & bit) {
          this.press(bit, now, "pad");
          this.held &= ~bit; // pad hold is tracked in padHeld
        }
        this.lastSource = "pad";
        this.onGesture(now);
      }
      if (x !== 0 || y !== 0) this.lastSource = "pad";
      return { x, y };
    }
    return { x: 0, y: 0 };
  }

  /** Sample once per render frame; the same Input is fed to every tick of that frame. */
  sample(now: number): Input {
    let x = 0;
    let y = 0;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) x += 1;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) y += 1;
    x += this.stickX;
    y += this.stickY;
    const pad = this.pollPad(now);
    x += pad.x;
    y += pad.y;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    const btn = this.held | this.padHeld | this.latch;
    this.latch = 0;
    return { mx: Math.round(x * 127), my: Math.round(y * 127), btn };
  }
}
