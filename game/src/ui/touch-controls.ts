// On-screen controls: floating joystick (left half), Dodge and Counter (right). Plain DOM over the canvas so they
// can sit in the letterbox and inside the safe area (notch, home bar). Multi-touch: one finger stick, one finger button.
import type { InputHub } from './input-hub.ts';
import type { I18n } from '../i18n/i18n.ts';
import './controls.css';

const STICK_RADIUS = 56; // CSS px of full deflection

export function mountTouchControls(root: HTMLElement, hub: InputHub, i18n: I18n): { setVisible(v: boolean): void } {
  const tc = document.createElement('div');
  tc.className = 'tc';
  tc.innerHTML = `
    <div class="tc-zone"></div>
    <div class="tc-base"><div class="tc-knob"></div></div>
    <button class="tc-btn tc-dodge" type="button" data-act="dash"></button>
    <button class="tc-btn tc-counter" type="button" data-act="fire"></button>`;
  const label = (sel: string, key: string): void => { const el = tc.querySelector(sel); if (el) el.textContent = i18n.t(key); };
  label('.tc-dodge', 'ui.dodge');
  label('.tc-counter', 'ui.counter');
  root.appendChild(tc);

  const zone = tc.querySelector<HTMLElement>('.tc-zone')!;
  const base = tc.querySelector<HTMLElement>('.tc-base')!;
  const knob = tc.querySelector<HTMLElement>('.tc-knob')!;
  let stickId = -1;
  let ox = 0;
  let oy = 0;

  zone.addEventListener('pointerdown', (e) => {
    if (stickId !== -1) return;
    zone.setPointerCapture(e.pointerId);
    stickId = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    const r = tc.getBoundingClientRect();
    base.style.display = 'block';
    base.style.left = `${ox - r.left}px`;
    base.style.top = `${oy - r.top}px`;
    knob.style.transform = 'translate(0,0)';
    hub.lastSource = 'touch';
    hub.onGesture();
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - ox;
    let dy = e.clientY - oy;
    const m = Math.hypot(dx, dy);
    if (m > STICK_RADIUS) { dx = (dx / m) * STICK_RADIUS; dy = (dy / m) * STICK_RADIUS; }
    hub.touchMove = { x: dx / STICK_RADIUS, y: dy / STICK_RADIUS };
    knob.style.transform = `translate(${dx}px,${dy}px)`;
  });
  const endStick = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    stickId = -1;
    hub.touchMove = { x: 0, y: 0 };
    base.style.display = 'none';
  };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  for (const b of tc.querySelectorAll<HTMLButtonElement>('.tc-btn')) {
    const act = b.dataset['act'];
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('on');
      if (act === 'dash') hub.pressDash(); else hub.pressFire();
      hub.lastSource = 'touch';
      hub.onGesture();
    });
    const up = (): void => b.classList.remove('on');
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  }
  return { setVisible: (v) => tc.classList.toggle('hidden', !v) };
}
