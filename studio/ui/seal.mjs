// The approval seal: a red pixel stamp that presses down for about 1.1 s with a few gold specks, and the undo toast that goes with it.
// Rules: it plays only AFTER the server confirmed the decision (see approveThenStamp), never blocks the next action (the overlay takes no
// pointer events and the page does not wait for it), can be switched off (localStorage) and is off under prefers-reduced-motion.
// The pixels come from the pack (ui.brand.seal, a 12x12 grid of '.' and '#'); without one a plain block is stamped.
import { sealRows, sealParticles } from './seal-model.mjs';

export { sealRows, sealParticles, SEAL_KEY, sealSetting, setSealSetting, reducedMotion, sealAllowed, approveThenStamp, TOAST_MS } from './seal-model.mjs';

const NS = 'http://www.w3.org/2000/svg';

function gridSvg(rows) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${rows[0].length} ${rows.length}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '#') return;
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 1); r.setAttribute('height', 1);
    svg.append(r);
  }));
  return svg;
}

/**
 * Stamp the seal over `host` (position: relative or fixed ancestor). Returns the overlay element, removed again by itself after `ms`;
 * the caller may ignore it. It is decoration only: aria-hidden, no pointer events, no focus.
 */
export function playSeal(host, brandSeal, {ms = 1100} = {}) {
  const stage = document.createElement('div');
  stage.className = 'seal-stage';
  stage.setAttribute('aria-hidden', 'true');
  const stamp = document.createElement('div');
  stamp.className = 'seal-stamp';
  stamp.append(gridSvg(sealRows(brandSeal)));
  stage.append(stamp);
  for (const p of sealParticles()) {
    const s = document.createElement('i');
    s.className = 'seal-speck';
    s.style.setProperty('--dx', p.dx + 'px'); s.style.setProperty('--dy', p.dy + 'px'); s.style.setProperty('--sz', p.size + 'px');
    stage.append(s);
  }
  host.append(stage);
  const timer = setTimeout(() => stage.remove(), ms + 100);
  stage.addEventListener('seal-cancel', () => { clearTimeout(timer); stage.remove(); });
  return stage;
}

/**
 * A toast that lives `ms` (6 s) with one action. `host` should be a polite live region. Returns {el, dismiss}.
 * `onAction` runs at most once; the toast closes before it runs so a second click cannot repeat it.
 */
export function actionToast(host, {text, actionLabel, onAction, ms = 6000, tone = 'ok'}) {
  const el = document.createElement('div');
  el.className = `toast ${tone} rv-toast`;
  const span = document.createElement('span');
  span.textContent = text;
  el.append(span);
  let timer = null;
  const dismiss = () => { clearTimeout(timer); el.remove(); };
  if (actionLabel && onAction) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = actionLabel;
    b.addEventListener('click', () => { dismiss(); onAction(); });
    el.append(b);
  }
  host.append(el);
  timer = setTimeout(dismiss, ms);
  return {el, dismiss};
}
