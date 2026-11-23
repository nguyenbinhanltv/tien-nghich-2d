// Save migration. `SAVE_VERSION` is 2. Steps: 0 -> 1 from the unversioned "version 0" prototype blob
// ({ realm: 0|1|2, inventory: { id: amount }, recipes, runs }) that early dev builds kept; 1 -> 2 is a pure version stamp (the
// profile shape of 1 and 2 is the same: main carried version 2 briefly before this chain existed, so both must load).
// Each future bump appends one function to STEPS and a test with a frozen fixture of the old version.
import type { ProfileRealm, SaveProfile } from '../../contracts/save.ts';
import { SAVE_VERSION } from '../../contracts/save.ts';
import { createProfile } from './profile.ts';

export type MigrateResult = { ok: true; profile: SaveProfile; from: number } | { ok: false; reason: 'not-an-object' | 'newer-version' | 'bad-version' | 'invalid' };

type Raw = Record<string, unknown>;
const REALMS: ProfileRealm[] = ['nhap_mon', 'khai_lo', 'lap_tran'];

/** STEPS[n] turns a version-n blob into a version n+1 blob. */
const STEPS: Record<number, (raw: Raw) => Raw> = {
  0: (raw) => {
    const base = createProfile(0) as unknown as Raw;
    const inv = raw.inventory && typeof raw.inventory === 'object' ? Object.entries(raw.inventory as Record<string, unknown>).filter(([, n]) => Number.isInteger(n) && (n as number) > 0).map(([id, amount]) => ({ id, amount })) : [];
    const runs = Number.isInteger(raw.runs) && (raw.runs as number) >= 0 ? (raw.runs as number) : 0;
    const realm = REALMS[Number.isInteger(raw.realm) ? Math.min(2, Math.max(0, raw.realm as number)) : 0];
    return { ...base, version: 1, realm, recipes: Array.isArray(raw.recipes) ? raw.recipes.filter((x) => typeof x === 'string') : [], inventory: inv, runsStarted: runs, runsDied: 0, runsWon: 0 };
  },
  1: (raw) => ({ ...raw, version: 2 }),
};

/** Strict shape check of the current version; anything that survives is safe for the rest of the game to read. */
export function validateProfile(raw: unknown): raw is SaveProfile {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Raw;
  const isNat = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 0;
  const rewards = (x: unknown): boolean => Array.isArray(x) && x.every((r) => r && typeof r.id === 'string' && Number.isInteger(r.amount) && r.amount > 0);
  const s = p.settings as Raw | undefined;
  return p.version === SAVE_VERSION && typeof p.profileId === 'string' && REALMS.includes(p.realm as ProfileRealm) &&
    Array.isArray(p.recipes) && p.recipes.every((x) => typeof x === 'string') && rewards(p.inventory) &&
    Array.isArray(p.plots) && p.plots.every((x) => x && (x.seed === null || typeof x.seed === 'string') && isNat(x.milestones)) &&
    isNat(p.furnaceOre) && isNat(p.milestone) && isNat(p.runsStarted) && isNat(p.runsWon) && isNat(p.runsDied) && isNat(p.nextRunSeed) &&
    (p.suspendedRun === null || (typeof p.suspendedRun === 'object' && isNat((p.suspendedRun as Raw).seed) && isNat((p.suspendedRun as Raw).ticks))) &&
    !!s && (s.locale === 'vi' || s.locale === 'en') && typeof s.sfx === 'number' && typeof s.music === 'number' && typeof s.reducedFlash === 'boolean';
}

export function migrateProfile(raw: unknown): MigrateResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'not-an-object' };
  let cur = raw as Raw;
  const from = cur.version === undefined ? 0 : cur.version;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) return { ok: false, reason: 'bad-version' };
  if (from > SAVE_VERSION) return { ok: false, reason: 'newer-version' };
  for (let v = from; v < SAVE_VERSION; v++) {
    const step = STEPS[v];
    if (!step) return { ok: false, reason: 'bad-version' };
    cur = step(cur);
  }
  return validateProfile(cur) ? { ok: true, profile: cur, from } : { ok: false, reason: 'invalid' };
}
