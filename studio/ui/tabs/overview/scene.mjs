// The Overview hero: a scene drawn in CSS (decoration only, aria-hidden), the project's greeting from ui.voice, and
// the controls. The scene can be switched off (remembered in localStorage) and folds to a strip once the page scrolls.
import { h } from './dom.mjs';

export const SCENE_KEY = 'studio.overview.scene';
const COLLAPSE_AT = 80, EXPAND_AT = 8;

export function readSceneChoice(storage = globalThis.localStorage) {
  try { return storage?.getItem(SCENE_KEY) !== 'off'; } catch { return true; }
}
export function saveSceneChoice(on, storage = globalThis.localStorage) {
  try { storage?.setItem(SCENE_KEY, on ? 'on' : 'off'); } catch { /* private mode: the choice is just not remembered */ }
}

/** What the hero says: the pack's ui.voice when present, neutral words otherwise. */
export function heroWords(ctx) {
  const voice = ctx.project.voice ?? {};
  const name = voice.name ? ctx.label(voice.name) : '';
  const greeting = voice.greeting ? ctx.label(voice.greeting) : '';
  const pipeline = voice.pipeline ? ctx.label(voice.pipeline) : '';
  return {
    title: name || ctx.t('title'),
    greeting: greeting || ctx.t('subtitle', {project: ctx.project.name}),
    pipeline: pipeline || ctx.t('pipeline.title')
  };
}

function artwork() {
  const part = (cls, ...kids) => h('span', cls, ...kids);
  return h('div', {class: 'ov-scene', 'aria-hidden': 'true'},
    part('ov-stars'), part('ov-moon'),
    part('ov-hill far'), part('ov-hill mid'),
    part('ov-gate', part('ov-lantern a'), part('ov-lantern b')),
    part('ov-hill near'), part('ov-lantern c'));
}

/**
 * Build the hero. Returns {el, refresh, toggle}: `refresh` is the refresh button (kept for the life of the mount so it keeps focus
 * across redraws). `onRefresh` runs on click.
 */
export function createHero(ctx, onRefresh) {
  const words = heroWords(ctx);
  let shown = readSceneChoice();
  const refresh = h('button', {type: 'button', class: 'btn', 'data-fk': 'refresh'}, ctx.t('refresh'));
  refresh.addEventListener('click', onRefresh);
  const toggle = h('button', {type: 'button', class: 'btn quiet', 'data-fk': 'scene', 'aria-pressed': String(shown), title: ctx.t(shown ? 'scene.hide' : 'scene.show')}, ctx.t('scene.toggle'));
  const el = h('header', {class: 'ov-hero', 'data-scene': shown ? 'on' : 'off', 'data-collapsed': 'false'},
    artwork(),
    h('div', 'ov-hero-text', h('h1', {}, words.title), h('p', 'ov-greeting', words.greeting), h('div', 'ov-hero-actions', refresh, toggle)));
  toggle.addEventListener('click', () => {
    shown = !shown;
    saveSceneChoice(shown);
    el.dataset.scene = shown ? 'on' : 'off';
    if (!shown) el.dataset.collapsed = 'false';
    toggle.setAttribute('aria-pressed', String(shown));
    toggle.title = ctx.t(shown ? 'scene.hide' : 'scene.show');
  });

  // Fold on scroll. Folding shortens the page, so it only folds when the page stays long enough to keep the scroll position;
  // folded and expanded have different thresholds so the hero never flickers at the edge.
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (el.dataset.scene !== 'on') return;
      const doc = document.scrollingElement ?? document.documentElement;
      const y = doc.scrollTop, room = doc.scrollHeight - doc.clientHeight;
      if (el.dataset.collapsed === 'false') {
        if (y > COLLAPSE_AT && room > y + 280) el.dataset.collapsed = 'true';
      } else if (y < EXPAND_AT) el.dataset.collapsed = 'false';
    });
  };
  window.addEventListener('scroll', onScroll, {passive: true});
  ctx.onUnmount(() => { window.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame); });
  return {el, refresh, toggle, words};
}
