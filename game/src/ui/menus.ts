// Pause, settings and key-binding menus (E8.3): sharp DOM text over the game (owner decision: pixel HUD, sharp menus). Works by
// touch, mouse, keyboard (Tab/arrows/Enter, Esc) and gamepad (D-pad/stick to move focus, A to confirm, B to go back, Start to
// close). Opening a menu pauses the game; settings apply immediately and are saved by the caller.
import type { I18n } from '../i18n/i18n.ts';
import type { InputHub } from './input-hub.ts';
import { ACTIONS, DEFAULT_SETTINGS, keyLabel, rebind } from './settings.ts';
import type { Action, LocalePref, Settings } from './settings.ts';
import './controls.css';

export interface MenuDeps {
  i18n: I18n;
  settings: Settings;
  hub: InputHub;
  /** Called after every change (apply to audio/juice and save). `reload` is true when the language changed. */
  onChange(s: Settings, reload: boolean): void;
  onRestart(): void;
  /** Hide the Restart item when there is nothing to restart (the hub). Default: shown. */
  canRestart?(): boolean;
  onOpenChange(open: boolean): void;
}
type View = 'pause' | 'settings' | 'keys';

export class Menus {
  private readonly root: HTMLElement;
  private readonly deps: MenuDeps;
  private readonly overlay: HTMLDivElement;
  private readonly button: HTMLButtonElement;
  private view: View = 'pause';
  private listening: Action | null = null;
  private note = '';
  private padHeld = new Set<number>();
  private open_ = false;

  constructor(root: HTMLElement, deps: MenuDeps) {
    this.root = root; this.deps = deps;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'menu-btn';
    this.button.textContent = 'II';
    this.button.setAttribute('aria-label', deps.i18n.t('menu.pause'));
    this.button.addEventListener('pointerdown', (e) => { e.preventDefault(); this.open(); });
    this.button.addEventListener('keydown', (e) => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); this.open(); } });
    root.appendChild(this.button);
    this.overlay = document.createElement('div');
    this.overlay.className = 'menu-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    root.appendChild(this.overlay);
    // key capture for rebinding: runs before every other key listener
    window.addEventListener('keydown', (e) => this.captureKey(e), true);
  }

  get isOpen(): boolean { return this.open_; }
  private t(k: string): string { return this.deps.i18n.t(k); }

  open(): void {
    if (this.open_) return;
    this.open_ = true; this.view = 'pause'; this.note = '';
    this.deps.hub.enabled = false; this.deps.hub.reset();
    this.overlay.classList.add('show'); this.button.classList.add('hidden');
    this.snapshotPad();
    this.render();
    this.deps.onOpenChange(true);
  }
  close(): void {
    if (!this.open_) return;
    this.open_ = false; this.listening = null;
    this.overlay.classList.remove('show'); this.button.classList.remove('hidden');
    this.deps.hub.enabled = true; this.deps.hub.reset();
    this.deps.onOpenChange(false);
  }
  /** Pause key or pad Start: open, or step back one level, or close from the top level. */
  toggle(): void { if (!this.open_) this.open(); else this.back(); }
  private back(): void {
    if (this.listening) { this.listening = null; this.note = ''; this.render(); return; }
    if (this.view === 'pause') this.close(); else { this.view = this.view === 'keys' ? 'settings' : 'pause'; this.note = ''; this.render(); }
  }

  private captureKey(e: KeyboardEvent): void {
    if (!this.listening) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const action = this.listening;
    if (e.code === 'Escape' && action !== 'pause') { this.listening = null; this.note = ''; this.render(); return; }
    const next = rebind(this.deps.settings.bindings, action, e.code);
    if (!next) { this.note = this.t('keys.refused'); this.render(); return; }
    this.deps.settings.bindings = next;
    this.deps.hub.setBindings(next);
    this.listening = null; this.note = '';
    this.deps.onChange(this.deps.settings, false);
    this.render();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e;
  }
  private btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = this.el('button', `menu-item ${cls}`.trim(), label); b.type = 'button';
    b.addEventListener('click', onClick); return b;
  }
  private slider(label: string, value: number, set: (v: number) => void): HTMLLabelElement {
    const l = this.el('label', 'menu-row');
    const name = this.el('span', '', label);
    const r = this.el('input'); r.type = 'range'; r.min = '0'; r.max = '100'; r.step = '5'; r.value = String(Math.round(value * 100));
    const out = this.el('output', '', `${r.value}%`);
    r.addEventListener('input', () => { out.textContent = `${r.value}%`; set(Number(r.value) / 100); });
    l.append(name, r, out); return l;
  }

  private render(): void {
    const s = this.deps.settings;
    const box = this.el('div', 'menu-panel');
    const title = this.el('h2', '', this.t(this.view === 'pause' ? 'menu.pause' : this.view === 'settings' ? 'menu.settings' : 'settings.keys'));
    this.overlay.setAttribute('aria-label', title.textContent ?? '');
    box.appendChild(title);
    if (this.view === 'pause') {
      box.append(this.btn(this.t('menu.resume'), () => this.close()), ...(this.deps.canRestart?.() ?? true ? [this.btn(this.t('menu.restart'), () => { this.close(); this.deps.onRestart(); })] : []), this.btn(this.t('menu.settings'), () => { this.view = 'settings'; this.render(); }));
    } else if (this.view === 'settings') {
      const emit = (reload = false) => this.deps.onChange(s, reload);
      box.append(this.el('h3', '', this.t('settings.audio')),
        this.slider(this.t('settings.master'), s.master, (v) => { s.master = v; emit(); }),
        this.slider(this.t('settings.music'), s.music, (v) => { s.music = v; emit(); }),
        this.slider(this.t('settings.sfx'), s.sfx, (v) => { s.sfx = v; emit(); }),
        this.el('h3', '', this.t('settings.feel')),
        this.slider(this.t('settings.shake'), s.shake, (v) => { s.shake = v; emit(); }));
      const flash = this.btn(`${this.t('settings.flash')}: ${this.t(s.flash ? 'settings.on' : 'settings.off')}`, () => { s.flash = !s.flash; emit(); this.render(); this.focusIndex(this.focusables().findIndex((f) => f.textContent?.startsWith(this.t('settings.flash')))); });
      flash.setAttribute('role', 'switch'); flash.setAttribute('aria-checked', String(s.flash));
      const lang = this.el('label', 'menu-row'); lang.append(this.el('span', '', this.t('settings.language')));
      const sel = this.el('select');
      for (const v of ['auto', 'vi', 'en'] as const) { const o = this.el('option', '', this.t(`settings.lang.${v}`)); o.value = v; o.selected = s.locale === v; sel.appendChild(o); }
      sel.addEventListener('change', () => { s.locale = sel.value as LocalePref; this.deps.onChange(s, true); });
      lang.append(sel);
      box.append(flash, lang, this.el('p', 'menu-note', this.t('settings.reload_note')), this.btn(this.t('settings.keys'), () => { this.view = 'keys'; this.render(); }),
        this.btn(this.t('settings.reset'), () => { Object.assign(s, structuredClone(DEFAULT_SETTINGS)); this.deps.hub.setBindings(s.bindings); this.deps.onChange(s, true); this.render(); }),
        this.btn(this.t('menu.back'), () => this.back()));
    } else {
      for (const a of ACTIONS) {
        const row = this.el('div', 'menu-row');
        row.append(this.el('span', '', this.t(`action.${a}`)));
        const label = this.listening === a ? this.t('keys.press') : s.bindings[a].map(keyLabel).join(' / ');
        row.append(this.btn(label, () => { this.listening = a; this.note = this.t('keys.cancel'); this.render(); this.focusIndex(ACTIONS.indexOf(a)); }, 'menu-key'));
        box.append(row);
      }
      box.append(this.el('p', 'menu-note', this.note || this.t('keys.pad')), this.btn(this.t('menu.back'), () => this.back()));
    }
    this.overlay.replaceChildren(box);
    if (!this.root.contains(document.activeElement) || document.activeElement === document.body) this.focusIndex(0);
  }

  private focusables(): HTMLElement[] { return [...this.overlay.querySelectorAll<HTMLElement>('button, input, select')]; }
  private focusIndex(i: number): void { const f = this.focusables(); f[Math.max(0, Math.min(f.length - 1, i))]?.focus(); }

  private padDown(p: Gamepad): Set<number> {
    const down = new Set<number>();
    const ay = p.axes[1] ?? 0, ax = p.axes[0] ?? 0;
    p.buttons.forEach((b, i) => { if (b.pressed) down.add(i); });
    if (ay < -0.6) down.add(12); if (ay > 0.6) down.add(13); if (ax < -0.6) down.add(14); if (ax > 0.6) down.add(15);
    return down;
  }
  /** Buttons already held when the menu opens (the Start press that opened it) must not count as new presses. */
  private snapshotPad(): void {
    const p = typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].find((g) => g?.connected) : undefined;
    this.padHeld = p ? this.padDown(p) : new Set();
  }

  /** Poll the gamepad once per frame while a menu is open: edge-triggered, so holding a button moves one step. */
  update(): void {
    if (!this.open_ || typeof navigator.getGamepads !== 'function') return;
    const p = [...navigator.getGamepads()].find((g) => g?.connected);
    if (!p) return;
    const down = this.padDown(p);
    const edge = (i: number) => down.has(i) && !this.padHeld.has(i);
    const f = this.focusables();
    const cur = f.indexOf(document.activeElement as HTMLElement);
    if (edge(12)) this.focusIndex(cur <= 0 ? 0 : cur - 1);
    if (edge(13)) this.focusIndex(cur + 1);
    const range = document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range' ? document.activeElement : null;
    if ((edge(14) || edge(15)) && range) { range.value = String(Number(range.value) + (edge(15) ? 5 : -5)); range.dispatchEvent(new Event('input')); }
    if (edge(0)) (document.activeElement as HTMLElement | null)?.click();
    if (edge(1) || edge(9)) this.back();
    this.padHeld = down;
  }
}
