// Sharp HTML text over the abode canvas (owner decision: HUD pixel + sharp text menus). Shows what is in the player's reach,
// the result of the last action and the stock. Strings come from i18n only.
import type { I18n } from '../i18n/i18n.ts';
import type { SaveProfile } from '../contracts/save.ts';
import type { StationId } from '../meta/abode-layout.ts';
import type { ActionOutcome } from '../meta/abode-actions.ts';
import { countOf, ITEM } from '../meta/abode.ts';
import './abode-panel.css';

const ACTION: Record<StationId, string> = { kiln: 'station.kiln', jar: 'station.jar', altar: 'station.altar', chest: 'station.chest', bed0: 'station.bed', bed1: 'station.bed', bed2: 'station.bed', gate: 'station.gate' };

export function mountAbodePanel(root: HTMLElement, i18n: I18n): { update(station: StationId | null, outcome: ActionOutcome | null): void; stock(p: SaveProfile): void; flash(text: string): void; /** Persistent save warning on its own line: actions never overwrite it, `null` clears it. */ warn(text: string | null): void; /** Hide while another scene (the fight) has the screen. */ show(visible: boolean): void } {
  const el = document.createElement('div');
  el.className = 'ap';
  el.innerHTML = '<div class="ap-top"><span class="ap-place"></span><span class="ap-stock"></span></div><div class="ap-warn" role="alert"></div><div class="ap-msg" role="status" aria-live="polite"></div><div class="ap-prompt"></div>';
  root.appendChild(el);
  const q = (s: string): HTMLElement => el.querySelector<HTMLElement>(s)!;
  q('.ap-place').textContent = i18n.t('place.abode');
  return {
    update(station, outcome) {
      q('.ap-prompt').textContent = station ? i18n.fmt('abode.prompt', { action: i18n.t(ACTION[station]) }) : '';
      if (outcome) q('.ap-msg').textContent = i18n.fmt(outcome.msg, outcome.vars);
    },
    stock(p) {
      q('.ap-stock').textContent = `◆ ${countOf(p.inventory, 'spirit_stone')}  ● ${countOf(p.inventory, ITEM.pill)}  ▬ ${countOf(p.inventory, ITEM.blank)}  ✿ ${countOf(p.inventory, ITEM.herb)}`;
    },
    flash(text) { q('.ap-msg').textContent = text; },
    show(visible) { el.style.display = visible ? '' : 'none'; },
    warn(text) { q('.ap-warn').textContent = text ?? ''; },
  };
}
