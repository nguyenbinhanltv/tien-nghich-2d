// Roster hover/focus preview: the thumbnail loops the character's idle at its real pace while the pointer or keyboard focus is on the row.
// Frames come from the asset route on first use and are cached. Under prefers-reduced-motion nothing moves: the still thumbnail stays.
import { pickIdle } from './idle.mjs';
import { reducedMotion } from '../../seal.mjs';

/** Wire one roster row. `idleFor(c)` resolves to a pickIdle() result or null. */
export function bindPreview(app, link, c) {
  const img = link.querySelector('.thumb img');
  if (!img) return;
  const home = img.getAttribute('src');
  let token = 0, timer = 0;
  const stop = () => { token++; if (app.previewStop === stop) app.previewStop = null; clearTimeout(timer); if (img.getAttribute('src') !== home) img.setAttribute('src', home); link.removeAttribute('data-playing'); };
  const start = async () => {
    if (reducedMotion(window)) return;
    const mine = ++token;
    clearTimeout(timer);
    const clip = await idleFor(app, c);
    if (mine !== token || !clip || reducedMotion(window)) return;
    for (const p of clip.paths) new Image().src = '/' + p;
    app.previewStop?.(); app.previewStop = stop;
    link.dataset.playing = '';
    let i = 0;
    const step = () => {
      if (mine !== token) return;
      if (!link.isConnected) { stop(); return; }
      img.setAttribute('src', '/' + clip.paths[i]);
      timer = setTimeout(step, clip.ms[i]);
      i = (i + 1) % clip.paths.length;
    };
    step();
  };
  link.addEventListener('pointerenter', start);
  link.addEventListener('focus', start);
  link.addEventListener('pointerleave', stop);
  link.addEventListener('blur', stop);
}

function idleFor(app, c) {
  const cache = app.idleCache ?? (app.idleCache = new Map());
  const key = c.source + '/' + c.id;
  if (!cache.has(key)) {
    const facings = app.ctx.project.tabConfig.characters?.facings ?? ['south', 'east', 'north', 'west'];
    cache.set(key, app.ctx.tabApi('asset?' + new URLSearchParams({id: c.id, ...(c.source ? {source: c.source} : {})})).then(d => pickIdle(d, facings), () => { cache.delete(key); return null; }));
  }
  return cache.get(key);
}
