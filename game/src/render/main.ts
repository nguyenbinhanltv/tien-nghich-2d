// Boots the game: Phaser (pixel-art 384x216 canvas), input, touch controls, rotate gate, service worker.
import Phaser from 'phaser';
import { VIEW_H, VIEW_W } from '../contracts/world.ts';
import { fitView } from './camera.ts';
import { AudioDirector } from '../audio/director.ts';
import { BloodSeaScene } from './scenes/BloodSeaScene.ts';
import { DongPhuScene } from './scenes/DongPhuScene.ts';
import { mountAbodePanel } from '../ui/abode-panel.ts';
import { readProfile, writeProfile } from '../meta/profile-store.ts';
import { ClipViewerScene } from './scenes/ClipViewerScene.ts';
import { InputHub } from '../ui/input-hub.ts';
import { mountOrientationGate } from '../ui/orientation-gate.ts';
import { createUiI18n } from '../ui/strings.ts';
import { isResult, mountStatus, statusText } from '../ui/status.ts';
import { mountTouchControls } from '../ui/touch-controls.ts';

const root = document.getElementById('game')!;
const i18n = createUiI18n(navigator.language);
document.title = i18n.t('game.title');
document.documentElement.lang = i18n.locale;

const hub = new InputHub(window);
const setStatus = mountStatus(document.body);
const audio = new AudioDirector();
// the sound card needs a user gesture: the first touch/key/pad press unlocks it and starts the room's bed
hub.onGesture = () => audio.unlock();
window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
void audio.init().then(() => audio.engine.playBgm('bgm_blood_sea'));
let portrait = false;
const params = new URLSearchParams(location.search);
if (params.has('golden')) document.body.classList.add('golden');
const abodePanel = params.get('view') === 'dong-phu' ? mountAbodePanel(document.body, i18n) : null;
const store = { getItem: (k: string) => localStorage.getItem(k), setItem: (k: string, v: string) => localStorage.setItem(k, v) };
const scene: Phaser.Scene = params.get('view') === 'dong-phu'
  ? makeAbode()
  : params.get('view') === 'clips'
  ? new ClipViewerScene(params.get('kind') ?? 'mob_blood_wolf', Number(params.get('page') ?? 0), params.get('chunk'))
  : new BloodSeaScene({ sample: () => hub.sample(), paused: () => portrait, onEvents: (ev, w) => audio.handle(ev, w),
    status: (w) => { const p = w.actors.find((a) => a.role === 'player'), b = w.actors.find((a) => a.role === 'boss'); setStatus(statusText(i18n, { playerHp: p?.hp ?? 0, playerMax: p?.hpMax ?? 0, bossHp: b?.hp ?? 0, bossMax: b?.hpMax ?? 0, mode: w.mode }), isResult(w.mode)); },
    frozen: params.has('golden') });

/** Hub scene on a saved profile. Entering the gate only announces `tn2d:enter-run`: the Blood Sea scene is wired in after the arena PR. */
function makeAbode(): Phaser.Scene {
  const loaded = readProfile(store, Date.now() >>> 0);
  let profile = loaded.profile;
  const host = {
    sample: () => hub.sample(), paused: () => portrait, frozen: params.has('golden'),
    get profile() { return profile; },
    commit: (p: typeof profile) => {
      profile = p;
      // memory-only sessions never write: the stored key may hold the only copy of a profile we could not read or back up
      if (!loaded.memoryOnly) abodePanel?.warn(writeProfile(store, p) ? null : i18n.t('abode.save.unavailable'));
      abodePanel?.stock(p);
    },
    enterRun: (p: typeof profile) => { window.dispatchEvent(new CustomEvent('tn2d:enter-run', { detail: p })); },
    onPrompt: (s: Parameters<NonNullable<typeof abodePanel>['update']>[0], o: Parameters<NonNullable<typeof abodePanel>['update']>[1]) => abodePanel?.update(s, o),
  };
  abodePanel?.stock(profile);
  if (loaded.source === 'recovered') abodePanel?.warn(i18n.t('abode.save.recovered'));
  if (loaded.source === 'unavailable') abodePanel?.warn(i18n.t('abode.save.unavailable'));
  if (loaded.source === 'damaged') abodePanel?.warn(i18n.t('abode.save.damaged'));
  return new DongPhuScene(host);
}

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
