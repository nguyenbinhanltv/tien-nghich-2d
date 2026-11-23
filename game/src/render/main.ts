// Placeholder entry. The renderer is chosen by the engine spike (G0-A, game/spike/); until then this only
// proves the layering: the page imports the sim, the sim never imports this folder.
import { VIEW_H, VIEW_W } from '../contracts/world.ts';
import { createWorld, FixedLoop, NO_INPUT, step } from '../sim/loop.ts';
import type { GameEvent } from '../contracts/world.ts';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('2d canvas unavailable');
ctx.imageSmoothingEnabled = false;
const world = createWorld(1);
const loop = new FixedLoop();
const events: GameEvent[] = [];
let last = performance.now();
function frame(now: number): void {
  loop.advance(now - last, () => step(world, NO_INPUT, events));
  last = now;
  events.length = 0;
  ctx!.fillStyle = '#14101a';
  ctx!.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx!.fillStyle = '#d8c8a0';
  ctx!.font = '12px monospace';
  ctx!.fillText(`tick ${world.tick}`, 8, 16);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
