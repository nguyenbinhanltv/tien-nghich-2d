// "Rotate your device" screen shown while the window is portrait. The manifest asks for landscape, and
// screen.orientation.lock is tried when allowed (installed PWA / fullscreen); the gate is the fallback that always works.
import type { I18n } from '../i18n/i18n.ts';
import { isPortrait } from '../render/camera.ts';
import './controls.css';

export function mountOrientationGate(root: HTMLElement, i18n: I18n, onChange: (portrait: boolean) => void): void {
  const gate = document.createElement('div');
  gate.className = 'rotate-gate';
  gate.setAttribute('role', 'alert');
  gate.innerHTML = '<div class="ico"></div><h1></h1><p></p><p></p>';
  const [h1, p1, p2] = [gate.querySelector('h1')!, ...gate.querySelectorAll('p')];
  h1.textContent = i18n.t('ui.rotate.title');
  p1!.textContent = i18n.t('ui.rotate.hint');
  p2!.textContent = i18n.t('ui.install.hint');
  root.appendChild(gate);
  let last: boolean | null = null;
  const apply = (): void => {
    const portrait = isPortrait(window.innerWidth, window.innerHeight);
    if (portrait === last) return;
    last = portrait;
    gate.classList.toggle('show', portrait);
    onChange(portrait);
  };
  window.addEventListener('resize', apply);
  window.addEventListener('orientationchange', apply);
  apply();
  const lock = (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock;
  if (typeof lock === 'function') void lock.call(screen.orientation, 'landscape').catch(() => { /* needs fullscreen or an installed PWA */ });
}
