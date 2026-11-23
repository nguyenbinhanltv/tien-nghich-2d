// Run (lượt Tầm Đạo) contract: realm progress, rewards at risk, and how a run ends (plan E5.3).

/** Realm inside a run. Cluster 1 = Tụ Khí I, breakthrough at cluster 2 = Tụ Khí II; III is reserved for a later slice. */
export type RealmStage = 1 | 2 | 3;

/** What the player chose at the cluster-2 gate: break through now, or take the pill instead. */
export type BreakthroughChoice = 'breakthrough' | 'pill';

export interface Reward { id: string; amount: number }

export type RunOutcome = 'active' | 'banked' | 'died' | 'abandoned' | 'won';

export interface RunState {
  runId: number;
  /** Index of the room in the floor (0-based) and the cluster (3 rooms per cluster). */
  room: number;
  cluster: number;
  realm: RealmStage;
  /** True once the cluster-2 choice was made, so it cannot be repeated. */
  gateUsed: boolean;
  /** Rewards held this run. They are lost on death unless banked. */
  carried: Reward[];
  /** Rewards already sent home (kept whatever happens next). */
  banked: Reward[];
  /** First-clear bonus already granted for these clusters (anti-farm). */
  clusterFirstClear: number[];
  outcome: RunOutcome;
}

/** The pressure P of the endless loop: P = min(2.5, 1 + 0.15 * floor(F / 5)). Lives here so UI and sim agree. */
export const pressureAtFloor = (floor: number): number => Math.min(2.5, 1 + 0.15 * Math.floor(floor / 5));
