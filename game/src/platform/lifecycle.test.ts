import { describe, expect, it } from 'vitest';
import { mountLifecycle } from './lifecycle.ts';

function fakeEnv() {
  const listeners = new Map<string, Array<() => void>>();
  const add = (t: string, f: () => void): void => { listeners.set(t, [...(listeners.get(t) ?? []), f]); };
  const doc = { visibilityState: 'visible', addEventListener: add, removeEventListener: () => {} } as unknown as Document & { visibilityState: string };
  const win = { addEventListener: add, removeEventListener: () => {} } as unknown as Window;
  const fire = (t: string): void => listeners.get(t)?.forEach((f) => f());
  return { doc, win, fire };
}

describe('lifecycle', () => {
  it('pauses and suspends audio when hidden, resumes when visible again', () => {
    const { doc, win, fire } = fakeEnv();
    const log: string[] = [];
    mountLifecycle(doc, win, { onAway: (a) => log.push(`away:${a}`), suspendAudio: () => log.push('suspend'), resumeAudio: () => log.push('resume') });
    (doc as { visibilityState: string }).visibilityState = 'hidden';
    fire('visibilitychange');
    fire('pagehide'); // a second signal for the same state does nothing
    (doc as { visibilityState: string }).visibilityState = 'visible';
    fire('visibilitychange');
    expect(log).toEqual(['away:true', 'suspend', 'away:false', 'resume']);
  });
  it('pageshow while in front nudges audio without toggling pause', () => {
    const { doc, win, fire } = fakeEnv();
    const log: string[] = [];
    mountLifecycle(doc, win, { onAway: (a) => log.push(`away:${a}`), suspendAudio: () => log.push('suspend'), resumeAudio: () => log.push('resume') });
    fire('pageshow');
    expect(log).toEqual(['resume']);
  });
});
