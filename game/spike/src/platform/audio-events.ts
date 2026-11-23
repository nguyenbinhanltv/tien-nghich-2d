// Build-time-style compile of assets/audio_manifest.json into an event table (plan section 4.3).
// Pure data code so node:test can run it.
export interface Manifest {
  families: Record<string, Record<string, string>>;
  asset_groups: Record<string, string[]>;
  fusions: Record<string, { parents: [string, string]; shot: string }>;
}
export type EventTable = Record<string, Record<string, string>>;

export function compileEvents(m: Manifest): EventTable {
  const events: EventTable = {};
  for (const [group, ids] of Object.entries(m.asset_groups)) {
    if (group === "silent") continue;
    const fam = m.families[group];
    if (!fam) continue;
    for (const id of ids) events[id] = fam;
  }
  for (const [relic, f] of Object.entries(m.fusions)) {
    const [a, b] = f.parents;
    const release = events[a]?.release;
    const impact = events[b]?.impact;
    if (!release || !impact) continue;
    events[relic] = { release, impact };
    events[f.shot] = events[relic]!;
  }
  return events;
}

/** event name -> cue id for an asset, or undefined when silent / unmapped. */
export function cueFor(table: EventTable, asset: string, event: string): string | undefined {
  return table[asset]?.[event];
}
