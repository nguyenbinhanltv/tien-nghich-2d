// Boots the game: Phaser (pixel-art 384x216 canvas), input, touch controls, rotate gate, service worker.
import Phaser from 'phaser';
import { VIEW_H, VIEW_W } from '../contracts/world.ts';
import { fitView } from './camera.ts';
import { AudioDirector } from '../audio/director.ts';
import { BloodSeaScene } from './scenes/BloodSeaScene.ts';
import { loadSliceContent } from './content-loader.ts';
import { createFlow } from './flow.ts';
import { ClipViewerScene } from './scenes/ClipViewerScene.ts';
import { InputHub } from '../ui/input-hub.ts';
import { Menus } from '../ui/menus.ts';
import { loadSettings, saveSettings } from '../ui/settings.ts';
import { mountOrientationGate } from '../ui/orientation-gate.ts';
import { createUiI18n } from '../ui/strings.ts';
import { isResult, mountStatus, statusText } from '../ui/status.ts';
import { mountTouchControls } from '../ui/touch-controls.ts';

const root = document.getElementById('game')!;
const settings = loadSettings(typeof localStorage === 'undefined' ? null : localStorage);
const i18n = createUiI18n(settings.locale === 'auto' ? navigator.language : settings.locale);
document.title = i18n.t('game.title');
document.documentElement.lang = i18n.locale;

const hub = new InputHub(window, settings.bindings, settings.padBindings);
const setStatus = mountStatus(document.body);
const audio = new AudioDirector();
// the sound card needs a user gesture: the first touch/key/pad press unlocks it and starts the room's bed
hub.onGesture = () => audio.unlock();
window.addEventListener('pointerdown', () => audio.unlock(), { passive: true });
const startBgm = new URLSearchParams(location.search).get('view') === 'dong-phu' ? 'bgm_dong_phu' : 'bgm_blood_sea';
void audio.init().then(() => audio.engine.playBgm(startBgm));
let portrait = false;
const ui: { menus?: Menus } = {}; // the menus need the scene and the scene needs to ask whether they are open
const params = new URLSearchParams(location.search);
if (params.has('golden')) document.body.classList.add('golden');
// the real floor needs the compiled content; without it the game plays the boss arena only
const content = params.get('view') === 'clips' ? null : await loadSliceContent().catch((e: unknown) => { console.warn('content unavailable, boss arena only:', e); return null; });
const flow = params.get('view') === 'dong-phu'
  ? createFlow({ hub, i18n, audio, content, store: { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v) }, frozen: params.has('golden'),
      paused: () => portrait || (ui.menus?.isOpen ?? false), juice: () => ({ shake: settings.shake, flash: settings.flash }), setStatus, panelRoot: document.body })
  : null;
const scene: Phaser.Scene = flow
  ? flow.first()
  : params.get('view') === 'clips'
  ? new ClipViewerScene(params.get('kind') ?? 'mob_blood_wolf', Number(params.get('page') ?? 0), params.get('chunk'))
  : new BloodSeaScene({ content, sample: () => hub.sample(), floorLabel: i18n.t('place.blood_sea'), nameOf: (k) => (i18n.has(k) ? i18n.t(k) : ''), paused: () => portrait || (ui.menus?.isOpen ?? false), onEvents: (ev, w) => audio.handle(ev, w),
    status: (w) => { const p = w.actors.find((a) => a.role === 'player'), b = w.actors.find((a) => a.role === 'boss'); setStatus(statusText(i18n, { playerHp: p?.hp ?? 0, playerMax: p?.hpMax ?? 0, bossHp: b?.hp ?? 0, bossMax: b?.hpMax ?? 0, mode: w.mode }), isResult(w.mode)); },
    frozen: params.has('golden') });

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

function applySettings(): void {
  audio.engine.setVolume('master', settings.master);
  audio.engine.setVolume('music', settings.music);
  audio.engine.setVolume('sfx', settings.sfx);
  const fightNow = flow ? flow.activeFight() : scene instanceof BloodSeaScene ? scene : null;
  if (fightNow) fightNow.juice.settings = { shake: settings.shake, flash: settings.flash };
}
applySettings();
const menus = (ui.menus = new Menus(document.body, {
  i18n, settings, hub,
  onChange: (s, reload) => { saveSettings(typeof localStorage === 'undefined' ? null : localStorage, s); applySettings(); if (reload) location.reload(); },
  onRestart: () => { (flow ? flow.activeFight() : scene instanceof BloodSeaScene ? scene : null)?.restartFight(); },
  canRestart: () => (flow ? !flow.inAbode() && !flow.resultShown() : scene instanceof BloodSeaScene),
  onOpenChange: () => {},
  onTitle: () => { (flow ? flow.activeFight() : scene instanceof BloodSeaScene ? scene : null)?.restartFight(); },
}));
// the title screen first (not in golden or viewer mode); Start unlocks audio like any first gesture
if (!params.has('golden') && params.get('view') !== 'clips') menus.openTitle();
hub.onPause = () => menus.toggle();
game.events.on(Phaser.Core.Events.PRE_STEP, () => menus.update());

// Offline cache: needs a secure context (https or localhost). Plain http on the LAN skips it, the game still runs.
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'));
}

flow?.attach(game);
(window as unknown as { __tn2d: unknown }).__tn2d = { game, scene, hub, audio, flow };
