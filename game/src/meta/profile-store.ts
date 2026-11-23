// Where the profile lives. The platform decides the storage (browser: localStorage here, IndexedDB later; Electron: a file),
// the codec in sim/save gives the checksum and migration. A bad or newer save is NEVER overwritten silently: it is kept under a
// ".bad" key and the caller is told, so the player does not lose a profile to a bug.
import type { SaveProfile } from '../contracts/save.ts';
import { createProfile } from '../sim/save/profile.ts';
import { loadProfile, serializeProfile } from '../sim/save/codec.ts';

export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const PROFILE_KEY = 'tn2d.profile';
export type LoadOutcome = { profile: SaveProfile; source: 'stored' | 'fresh' | 'recovered'; reason?: string };

export function readProfile(store: KeyValueStore, freshSeed: number): LoadOutcome {
  const text = store.getItem(PROFILE_KEY);
  if (text === null) return { profile: createProfile(freshSeed), source: 'fresh' };
  const r = loadProfile(text);
  if (r.ok) return { profile: r.profile, source: 'stored' };
  store.setItem(`${PROFILE_KEY}.bad`, text);
  return { profile: createProfile(freshSeed), source: 'recovered', reason: r.reason };
}

export function writeProfile(store: KeyValueStore, profile: SaveProfile): void {
  store.setItem(PROFILE_KEY, serializeProfile(profile));
}
