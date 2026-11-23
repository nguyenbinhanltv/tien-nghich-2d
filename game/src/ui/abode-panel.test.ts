import { afterEach, describe, expect, it } from 'vitest';
import { mountAbodePanel } from './abode-panel.ts';
import { createUiI18n } from './strings.ts';
import { createProfile } from '../sim/save/profile.ts';

// Minimal DOM stand-in: one text holder per selector (vitest runs in node here).
const mount = (): { cells: Map<string, { textContent: string }>; panel: ReturnType<typeof mountAbodePanel> } => {
  const cells = new Map<string, { textContent: string }>();
  const el = { className: '', set innerHTML(_v: string) { /* structure is by selector */ }, querySelector: (s: string) => { let c = cells.get(s); if (!c) { c = { textContent: '' }; cells.set(s, c); } return c; } };
  (globalThis as unknown as { document: unknown }).document = { createElement: () => el };
  return { cells, panel: mountAbodePanel({ appendChild: () => undefined } as unknown as HTMLElement, createUiI18n('en')) };
};
afterEach(() => { delete (globalThis as { document?: unknown }).document; });

describe('abode panel save warning', () => {
  it('stays visible after an interaction whose save failed, and clears when a save works', () => {
    const { cells, panel } = mount();
    // what main.ts does for one action: commit (warn) first, then the scene reports the action result
    panel.warn('Saving is not available here');
    panel.update('kiln', { profile: createProfile(1), msg: 'abode.kiln.empty', changed: false });
    expect(cells.get('.ap-msg')!.textContent).toBe('No ore to smelt yet.');
    expect(cells.get('.ap-warn')!.textContent).toBe('Saving is not available here');
    panel.update(null, null);
    expect(cells.get('.ap-warn')!.textContent).toBe('Saving is not available here');
    panel.warn(null);
    expect(cells.get('.ap-warn')!.textContent).toBe('');
  });
});
