// The run line of the floor HUD (E3.3 full): realm, cluster and, once it is above 1, the pressure P of the endless loop.
// Pure: takes the string lookup, so both languages are tested. Cluster 3 is the boss room (run.cluster counts 0..3).
export interface RunLike { cluster: number; realm: number }

export const CLUSTERS = 3;
export const clusterNumber = (cluster: number): number => Math.min(CLUSTERS, Math.max(0, cluster) + 1);

/**
 * The run lines: realm, then cluster (and, only above 1, the pressure P of the endless loop; the slice runs at 1.0 so it shows
 * nothing). Two short lines because they sit in the free wall band between the player's HUD and the boss bar.
 */
export function runLines(t: (key: string) => string, run: RunLike | null | undefined, pressure = 1): string[] {
  if (!run) return [];
  const cluster = `${t('hud.cluster')} ${clusterNumber(run.cluster)}/${CLUSTERS}`;
  return [t(`realm.${Math.min(3, Math.max(1, run.realm))}`), pressure > 1 ? `${cluster} · ${t('hud.pressure')} ${pressure.toFixed(1)}` : cluster];
}
