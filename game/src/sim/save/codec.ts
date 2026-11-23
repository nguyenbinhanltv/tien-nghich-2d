// Text form of the profile: a small envelope with a checksum, so a half-written or hand-edited file is detected instead of trusted.
import type { SaveProfile } from '../../contracts/save.ts';
import { hashState } from '../hash.ts';
import { migrateProfile } from './migrate.ts';
import type { MigrateResult } from './migrate.ts';

const FORMAT = 'tn2d-save';

export function serializeProfile(p: SaveProfile): string {
  return JSON.stringify({ format: FORMAT, sum: hashState(p), data: p });
}

export type LoadResult = MigrateResult | { ok: false; reason: 'unreadable' | 'checksum' };

/** Parse and migrate stored text. A bare object without the envelope is a legacy blob and is migrated without a checksum. */
export function loadProfile(text: string): LoadResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, reason: 'unreadable' }; }
  if (raw && typeof raw === 'object' && (raw as { format?: unknown }).format === FORMAT) {
    const env = raw as { sum?: unknown; data?: unknown };
    if (env.sum !== hashState(env.data)) return { ok: false, reason: 'checksum' };
    return migrateProfile(env.data);
  }
  return migrateProfile(raw);
}
