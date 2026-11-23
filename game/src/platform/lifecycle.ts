// App lifecycle for the native wrappers (Capacitor iOS) and for the browser alike: when the page goes to the background
// (home swipe, app switcher, call, lock) the game pauses and the sound card is suspended; when it comes back the sound card is
// resumed. A phone call can also leave the Web Audio context 'interrupted' without a hidden page; the next touch re-unlocks it
// (AudioDirector.unlock treats any state but 'running' as locked), and focus/pageshow nudge it too.
export interface LifecycleHooks {
  /** true while the app is not in front: feed this into the scenes' paused() */
  onAway(away: boolean): void;
  suspendAudio(): void;
  resumeAudio(): void;
}

export function mountLifecycle(doc: Document, win: Window, hooks: LifecycleHooks): () => void {
  let away = false;
  const set = (next: boolean): void => {
    if (next === away) return;
    away = next;
    hooks.onAway(away);
    if (away) hooks.suspendAudio(); else hooks.resumeAudio();
  };
  const onVis = (): void => set(doc.visibilityState === 'hidden');
  const onBlur = (): void => set(true);
  const onFocus = (): void => set(doc.visibilityState === 'hidden');
  const onPageShow = (): void => { set(doc.visibilityState === 'hidden'); if (!away) hooks.resumeAudio(); };
  doc.addEventListener('visibilitychange', onVis);
  win.addEventListener('pagehide', onBlur);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('focus', onFocus);
  return () => {
    doc.removeEventListener('visibilitychange', onVis);
    win.removeEventListener('pagehide', onBlur);
    win.removeEventListener('pageshow', onPageShow);
    win.removeEventListener('focus', onFocus);
  };
}
