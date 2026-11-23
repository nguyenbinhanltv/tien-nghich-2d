// Loads the compiled content the floor needs in the browser (dist-content: tables.json, rooms/<id>.json, encounters/<id>.json) and
// builds the ContentApi the sim reads (sim/context.ts). If anything is missing the caller falls back to the boss-arena fight, so a
// build without content still runs (and the golden/golden-less dev server keeps working).
import type { ContentApi } from '../contracts/content.ts';
import { contentFromTables } from '../sim/context.ts';
import type { ContentTables } from '../sim/context.ts';

type Fetch = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface RawTables { mobs: ContentTables['mobs']; bosses: ContentTables['bosses']; rooms: ContentTables['rooms'] }

/** Fetch tables, then every room layout and every boss encounter they name. Rejects on any missing file. */
export async function loadSliceContent(fetchFn: Fetch = (u) => fetch(u), base = 'content'): Promise<ContentApi> {
  const get = async <T>(path: string): Promise<T> => {
    const r = await fetchFn(`${base}/${path}`);
    if (!r.ok) throw new Error(`content/${path} not available`);
    return (await r.json()) as T;
  };
  const t = await get<RawTables>('tables.json');
  const layouts: NonNullable<ContentTables['layouts']> = {};
  await Promise.all(t.rooms.filter((r) => r.kind !== 'abode').map(async (r) => { layouts[r.id] = await get(`rooms/${r.id}.json`); }));
  const encounters: ContentTables['encounters'] = {};
  await Promise.all([...new Set(t.bosses.map((b) => b.encounter).filter(Boolean))].map(async (id) => { encounters[id] = await get(`encounters/${id}.json`); }));
  return contentFromTables({ mobs: t.mobs, bosses: t.bosses, rooms: t.rooms, encounters, layouts }, 'dist-content');
}
