// Shell of the vertical slice: Động Phủ -> gate -> Huyết Hải boss fight -> result -> rewards sent home -> Động Phủ.
// It owns the profile for the session and swaps Phaser scenes; the rules live in meta/ (tested without Phaser). Scenes are
// built fresh for every visit, so a run always starts from a clean world on the seed the profile handed out.
import Phaser from 'phaser';
import type { ContentApi } from '../contracts/content.ts';
import type { SaveProfile } from '../contracts/save.ts';
import type { WorldState } from '../contracts/world.ts';
import type { I18n } from '../i18n/i18n.ts';
import type { InputHub } from '../ui/input-hub.ts';
import type { AudioDirector } from '../audio/director.ts';
import { mountAbodePanel } from '../ui/abode-panel.ts';
import { isResult, statusText } from '../ui/status.ts';
import { beginSliceRun, finishSliceRun } from '../meta/flow.ts';
import { readProfile, writeProfile } from '../meta/profile-store.ts';
import type { KeyValueStore } from '../meta/profile-store.ts';
import type { JuiceSettings } from './juice.ts';
import { BloodSeaScene } from './scenes/BloodSeaScene.ts';
import { DongPhuScene } from './scenes/DongPhuScene.ts';

export interface FlowDeps {
  hub: InputHub; i18n: I18n; audio: AudioDirector; store: KeyValueStore; frozen: boolean;
  /** Compiled content: with it every run walks the real floor; null = the boss arena only. */
  content: ContentApi | null;
  /** The realm gate prompt (cluster 2) and the floor HUD's realm and cluster lines. */
  onGate?(choose: (choice: 'breakthrough' | 'pill') => void): void;
  runLines?(run: WorldState['run']): string[];
  /** True while the scenes must not advance: portrait gate or an open menu. */
  paused(): boolean;
  /** Current shake/flash settings, applied to every fight scene built here. */
  juice(): JuiceSettings;
  setStatus(text: string, result: boolean): void;
  panelRoot: HTMLElement;
}

export interface Flow { first(): Phaser.Scene; attach(game: Phaser.Game): void; /** The fight scene on screen, if any (settings changes reach it). */ activeFight(): BloodSeaScene | null; /** True in the hub, where Restart means nothing. */ inAbode(): boolean; /** True while the fight on screen shows its result: Restart must stay hidden. */ resultShown(): boolean; debug(): { where: 'abode' | 'fight'; profile: SaveProfile } }

export function createFlow(d: FlowDeps): Flow {
  const loaded = readProfile(d.store, Date.now() >>> 0);
  let profile = loaded.profile;
  let game: Phaser.Game | null = null;
  let where: 'abode' | 'fight' = 'abode';
  let n = 0;
  const panel = mountAbodePanel(d.panelRoot, d.i18n);

  /** Save the profile. A session whose stored copy could not be read or backed up never writes over it. */
  const persist = (): void => {
    if (!loaded.memoryOnly) panel.warn(writeProfile(d.store, profile) ? null : d.i18n.t('abode.save.unavailable'));
    panel.stock(profile);
  };
  if (loaded.source === 'recovered') panel.warn(d.i18n.t('abode.save.recovered'));
  if (loaded.source === 'unavailable') panel.warn(d.i18n.t('abode.save.unavailable'));
  if (loaded.source === 'damaged') panel.warn(d.i18n.t('abode.save.damaged'));
  panel.stock(profile);

  const abodeScene = (): DongPhuScene => new DongPhuScene({
    sample: () => d.hub.sample(), paused: d.paused, frozen: d.frozen,
    get profile() { return profile; },
    commit: (p) => { profile = p; persist(); },
    enterRun: (_p, biome) => later(() => toFight(biome)),
    onPrompt: (s, o) => panel.update(s, o),
  });

  let fight: BloodSeaScene | null = null;
  const fightScene = (seed: number, runId: number, biome = 'blood_sea'): BloodSeaScene => (fight = new BloodSeaScene({
    sample: () => d.hub.sample(), biome, floorLabel: d.i18n.t(`place.${biome}`), paused: d.paused, frozen: d.frozen, content: d.content, ...(d.onGate ? { onGate: d.onGate } : {}), ...(d.runLines ? { runLines: d.runLines } : {}), run: { seed, runId },
    onEvents: (ev, w) => d.audio.handle(ev, w),
    status: (w) => {
      const p = w.actors.find((a) => a.role === 'player'), b = w.actors.find((a) => a.role === 'boss');
      d.setStatus(statusText(d.i18n, { playerHp: p?.hp ?? 0, playerMax: p?.hpMax ?? 0, bossHp: b?.hp ?? 0, bossMax: b?.hpMax ?? 0, mode: w.mode, returning: true }), isResult(w.mode));
    },
    onFinished: (w: WorldState) => later(() => toAbode(w)),
  }));

  /** Scene swaps happen outside Phaser's update loop. */
  const later = (fn: () => void): void => { setTimeout(fn, 0); };
  const swap = (from: string, next: Phaser.Scene, tag: 'abode' | 'fight'): void => {
    const sm = game!.scene;
    sm.stop(from); sm.remove(from);
    sm.add(`${tag}-${++n}`, next, true);
  };
  const current = (): string => game!.scene.getScenes(true)[0]?.scene.key ?? '';

  function toFight(biome = 'blood_sea'): void {
    if (where !== 'abode') return;
    where = 'fight';
    const start = beginSliceRun(profile);
    profile = start.profile;
    persist(); // before the fight, so closing the game mid-fight cannot reroll the seed
    panel.show(false);
    void d.audio.engine.playBgm(biome === 'hengyue' ? 'bgm_hengyue' : 'bgm_blood_sea');
    const f = fightScene(start.seed, start.runId, biome);
    f.juice.settings = { ...d.juice() };
    swap(current(), f, 'fight');
  }

  function toAbode(world: WorldState): void {
    if (where !== 'fight' || !world.run) return;
    where = 'abode';
    const res = finishSliceRun(profile, world.run);
    profile = res.profile;
    persist();
    d.setStatus('', false);
    panel.show(true);
    panel.flash(d.i18n.t(res.outcome === 'won' ? 'abode.delivered' : 'abode.run.lost'));
    void d.audio.engine.playBgm('bgm_dong_phu');
    fight = null;
    swap(current(), abodeScene(), 'abode');
  }

  return {
    first: abodeScene,
    attach: (g) => { game = g; },
    activeFight: () => fight,
    inAbode: () => where === 'abode',
    resultShown: () => fight?.resultShown() ?? false,
    debug: () => ({ where, profile }),
  };
}
