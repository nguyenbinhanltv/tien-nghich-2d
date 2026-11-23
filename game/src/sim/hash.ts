// FNV-1a over a canonical (key-sorted) form: equal states hash equal on every platform.
import type { ProjectilePool } from '../contracts/pool.ts';
import type { WorldState } from '../contracts/world.ts';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (ArrayBuffer.isView(value)) throw new Error('typed arrays are hashed by hashWorld, not hashState');
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fnvString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), FNV_PRIME) >>> 0;
  return h;
}
const hex = (h: number): string => h.toString(16).padStart(8, '0');

/** Hash of any plain JSON-like value (no typed arrays). */
export function hashState(value: unknown): string { return hex(fnvString(FNV_OFFSET, canonical(value))); }

// Scratch for reading the exact bits of a double without allocating per value.
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function fnvWord(h: number, w: number): number {
  for (let s = 0; s < 32; s += 8) h = Math.imul(h ^ ((w >>> s) & 0xff), FNV_PRIME) >>> 0;
  return h;
}
function fnvF64(h: number, a: Float64Array, n: number): number {
  for (let i = 0; i < n; i++) { f64[0] = a[i] as number; h = fnvWord(fnvWord(h, u32[0] as number), u32[1] as number); }
  return h;
}
function fnvInts(h: number, a: Int32Array | Uint8Array, n: number): number {
  for (let i = 0; i < n; i++) h = fnvWord(h, a[i] as number);
  return h;
}

/** Folds only the live slots (0..count): stale data left behind by swap-remove never changes the hash. */
export function hashPool(h: number, p: ProjectilePool): number {
  const n = p.count;
  h = fnvWord(fnvWord(h, n), p.nextId);
  h = fnvInts(h, p.id, n); h = fnvInts(h, p.owner, n); h = fnvInts(h, p.kind, n);
  h = fnvF64(h, p.x, n); h = fnvF64(h, p.y, n); h = fnvF64(h, p.vx, n); h = fnvF64(h, p.vy, n); h = fnvF64(h, p.radius, n);
  h = fnvInts(h, p.ttl, n); h = fnvInts(h, p.damage, n); h = fnvInts(h, p.counter, n);
  return h;
}

/** Canonical hash of the whole world: plain fields as JSON, pool by live slots. Same seed + same inputs => same hash. */
export function hashWorld(w: WorldState): string {
  const { projectiles, ...rest } = w;
  return hex(hashPool(fnvString(FNV_OFFSET, canonical(rest)), projectiles));
}
