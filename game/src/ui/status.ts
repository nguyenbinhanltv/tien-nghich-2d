// Plain-text status line (hp and result) in sharp device-resolution text. Temporary: E8.1 replaces it with the pixel HUD.
import type { I18n } from '../i18n/i18n.ts';

export function mountStatus(root: HTMLElement): (text: string) => void {
  const el = document.createElement('div');
  el.className = 'status';
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:fixed;left:calc(8px + env(safe-area-inset-left,0px));top:calc(6px + env(safe-area-inset-top,0px));z-index:4;color:#d7c9a3;font:600 15px var(--font-sharp, serif);text-shadow:0 1px 2px #14101a;pointer-events:none;white-space:pre';
  root.appendChild(el);
  let last = '';
  return (t) => { if (t !== last) { last = t; el.textContent = t; } };
}

export interface StatusInput { playerHp: number; playerMax: number; bossHp: number; bossMax: number; mode: string }
export function statusText(i18n: I18n, s: StatusInput): string {
  let t = `${i18n.t('hud.you')} ${s.playerHp}/${s.playerMax} · ${i18n.t('hud.boss')} ${s.bossHp}/${s.bossMax}`;
  if (s.mode === 'won') t += `\n${i18n.t('result.won')} — ${i18n.t('result.restart')}`;
  else if (s.mode === 'lost') t += `\n${i18n.t('result.lost')} — ${i18n.t('result.restart')}`;
  return t;
}
