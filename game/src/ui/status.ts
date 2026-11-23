// Sharp (device-resolution) text over the pixel HUD: the match result banner. While playing the element is visually hidden but
// still read out to screen readers (aria-live), so hp and result are never pixel-only.
import type { I18n } from '../i18n/i18n.ts';

export function mountStatus(root: HTMLElement): (text: string, result: boolean) => void {
  const el = document.createElement('div');
  el.className = 'status';
  el.setAttribute('aria-live', 'polite');
  root.appendChild(el);
  let last = '';
  return (t, result) => {
    if (t !== last) { last = t; el.textContent = t; }
    el.classList.toggle('result', result);
  };
}

export interface StatusInput { playerHp: number; playerMax: number; bossHp: number; bossMax: number; mode: string }
export function statusText(i18n: I18n, s: StatusInput): string {
  const hp = `${i18n.t('hud.you')} ${s.playerHp}/${s.playerMax} · ${i18n.t('hud.boss')} ${s.bossHp}/${s.bossMax}`;
  if (s.mode === 'won') return `${i18n.t('result.won')}\n${i18n.t('result.restart')}`;
  if (s.mode === 'lost') return `${i18n.t('result.lost')}\n${i18n.t('result.restart')}`;
  return hp;
}
export const isResult = (mode: string): boolean => mode === 'won' || mode === 'lost';
