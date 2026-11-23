// Boots the game: Phaser (pixel-art 384x216 canvas), input, touch controls, rotate gate, service worker.
import Phaser from 'phaser';
import { VIEW_H, VIEW_W } from '../contracts/world.ts';
import { fitView } from './camera.ts';
import { AudioDirector } from '../audio/director.ts';
import { BloodSeaScene } from './scenes/BloodSeaScene.ts';
import { InputHub } from '../ui/input-hub.ts';
import { mountOrientationGate } from '../ui/orientation-gate.ts';
import { createUiI18n } from '../ui/strings.ts';
import { mountTouchControls } from '../ui/touch-controls.ts';

const root = document.getElementById('game')!;
const i18n = createUiI18n(navigator.language);
document.title = i18n.t('game.title');
document.documentElement.lang = i18n.locale;

const hub = new InputHub(window);
const audio = new AudioDirector();
// the sound card needs a user gesture: the first touch/key/pad press unlocks it and starts the room's bed
hub.onGesture = () => audio.unlock();
window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
void audio.init().then(() => audio.engine.playBgm('bgm_blood_sea'));
let portrait = false;
const scene = new BloodSeaScene({ sample: () => hub.sample(), paused: () => portrait, onEvents: (ev, w) => audio.handle(ev, w) });

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: root,
  width: VIEW_W,
  height: VIEW_H,
  backgroundColor: '#14101a',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: { mode: Phaser.Scale.NONE },
  input: { mouse: false, touch: false, keyboard: false, gamepad: false }, // our InputHub reads the raw events
  scene: [scene],
  banner: false,
});

function fit(): void {
  const f = fitView(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  const c = game.canvas;
  c.style.position = 'fixed';
  c.style.width = `${f.cssW}px`;
  c.style.height = `${f.cssH}px`;
  c.style.left = `${f.left}px`;
  c.style.top = `${f.top}px`;
  c.style.imageRendering = 'pixelated';
}
game.events.once(Phaser.Core.Events.READY, fit);
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);

const controls = mountTouchControls(document.body, hub, i18n);
const coarse = window.matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');
controls.setVisible(coarse);
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') controls.setVisible(true); }, { passive: true });
mountOrientationGate(document.body, i18n, (p) => { portrait = p; });

// Offline cache: needs a secure context (https or localhost). Plain http on the LAN skips it, the game still runs.
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'));
}

(window as unknown as { __tn2d: unknown }).__tn2d = { game, scene, hub, audio };
