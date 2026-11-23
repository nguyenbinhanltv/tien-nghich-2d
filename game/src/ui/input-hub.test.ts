import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputHub } from './input-hub.ts';

type Btn = { pressed: boolean };
const pad = (): { connected: true; axes: number[]; buttons: Btn[] } => ({ connected: true, axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false })) });
const win = { addEventListener: () => {} } as unknown as Window;

function setup(): { hub: InputHub; p: ReturnType<typeof pad>; pauses: { n: number } } {
  const p = pad();
  vi.stubGlobal('navigator', { getGamepads: () => [p] });
  const hub = new InputHub(win);
  const pauses = { n: 0 };
  hub.onPause = () => { pauses.n++; };
  return { hub, p, pauses };
}
afterEach(() => vi.unstubAllGlobals());

describe('gamepad presses that start in a menu do not leak into the game', () => {
  it('A held on "Resume" does not dash when the menu closes; it counts after release and a new press', () => {
    const { hub, p } = setup();
    hub.enabled = false; hub.reset();
    p.buttons[0]!.pressed = true;           // A confirms Resume
    hub.sample();                            // menu still open this frame: follows the pad
    hub.enabled = true; hub.reset();         // menu closed
    expect(hub.sample().dash).toBe(false);   // A is still down: not a new press
    p.buttons[0]!.pressed = false; expect(hub.sample().dash).toBe(false);
    p.buttons[0]!.pressed = true; expect(hub.sample().dash).toBe(true);
  });
  it('B used to go back does not trigger a counter', () => {
    const { hub, p } = setup();
    hub.enabled = false; hub.reset();
    p.buttons[1]!.pressed = true;
    hub.enabled = true; hub.reset();
    expect(hub.sample().fire).toBe(false);
  });
  it('Start that closes the menu does not reopen it', () => {
    const { hub, p, pauses } = setup();
    hub.enabled = false; hub.reset();
    p.buttons[9]!.pressed = true;            // Start closes the menu
    hub.enabled = true; hub.reset();
    hub.sample();
    expect(pauses.n).toBe(0);
    p.buttons[9]!.pressed = false; hub.sample();
    p.buttons[9]!.pressed = true; hub.sample();
    expect(pauses.n).toBe(1);                // a fresh press still pauses
  });
  it('without a pad nothing throws and nothing fires', () => {
    vi.stubGlobal('navigator', { getGamepads: () => [] });
    const hub = new InputHub(win);
    hub.enabled = false; hub.reset(); hub.enabled = true; hub.reset();
    expect(hub.sample()).toMatchObject({ dash: false, fire: false });
  });
});

describe('gamepad bindings are read from the settings', () => {
  it('a rebound button dashes; a button that was moved to the other action no longer does', () => {
    const p = pad();
    vi.stubGlobal('navigator', { getGamepads: () => [p] });
    const hub = new InputHub(win, undefined, { dash: [3], counter: [0] });
    p.buttons[3]!.pressed = true;
    expect(hub.sample()).toMatchObject({ dash: true, fire: false });
    p.buttons[3]!.pressed = false; hub.sample();
    p.buttons[0]!.pressed = true;
    expect(hub.sample()).toMatchObject({ dash: false, fire: true });
    hub.setPadBindings({ dash: [0], counter: [3] });
    p.buttons[0]!.pressed = false; hub.sample();
    p.buttons[0]!.pressed = true;
    expect(hub.sample()).toMatchObject({ dash: true, fire: false });
  });
});
