import type {
  CourseInfo,
  PlayerID,
  PressEvent,
  ScoringPlayer,
  WolfDecision,
} from './types';

/**
 * Append-only events that affect bets. Because these merge as set-unions keyed
 * by unique IDs, two devices could record events offline and reconcile without
 * conflicts — the property the iOS app relied on for sync, preserved here so
 * the seam stays open.
 */
export interface RoundEvents {
  presses: PressEvent[];
  wolfDecisions: WolfDecision[];
}

export function emptyEvents(): RoundEvents {
  return { presses: [], wolfDecisions: [] };
}

/** Set-union merge by event identity. */
export function unionEvents(a: RoundEvents, b: RoundEvents): RoundEvents {
  const presses = [...a.presses];
  for (const press of b.presses) {
    if (!presses.some((p) => p.id === press.id)) presses.push(press);
  }
  const wolfDecisions = [...a.wolfDecisions];
  for (const decision of b.wolfDecisions) {
    if (
      !wolfDecisions.some((d) => d.betID === decision.betID && d.hole === decision.hole)
    ) {
      wolfDecisions.push(decision);
    }
  }
  return { presses, wolfDecisions };
}

/**
 * An immutable view of everything the bet engines need about a round at one
 * moment in time: who is playing, what course, what has been scored, who has
 * withdrawn, and any bet-relevant events (presses, Wolf decisions).
 *
 * The app rebuilds a snapshot whenever state changes and re-runs `evaluateAll`
 * over it. Evaluation is a pure function of the snapshot, so identical data
 * always produces identical standings.
 */
export interface RoundSnapshot {
  course: CourseInfo;
  /**
   * Players in tee order. Order matters: it is the Wolf rotation default and
   * the deterministic tiebreak for splitting odd cents.
   */
  players: ScoringPlayer[];
  /** The holes being played this round, ascending. */
  holeNumbers: number[];
  /**
   * Gross strokes: playerID → (hole number → strokes).
   * Absence means "not entered yet" — engines treat those holes as pending.
   */
  scores: Record<PlayerID, Record<number, number>>;
  /**
   * playerID → last hole through which the player is active. A player with
   * `withdrawals[p] === 6` counts for holes 1–6 and is out from hole 7 on.
   * `0` means they never started. Absent = never withdrew.
   */
  withdrawals: Record<PlayerID, number>;
  events: RoundEvents;
}

export interface SnapshotInit {
  course: CourseInfo;
  players: ScoringPlayer[];
  holeNumbers?: number[];
  scores?: Record<PlayerID, Record<number, number>>;
  withdrawals?: Record<PlayerID, number>;
  events?: RoundEvents;
}

export function makeSnapshot(init: SnapshotInit): RoundSnapshot {
  const holeNumbers = [...(init.holeNumbers ?? init.course.holes.map((h) => h.number))].sort(
    (a, b) => a - b,
  );
  return {
    course: init.course,
    players: init.players,
    holeNumbers,
    scores: init.scores ?? {},
    withdrawals: init.withdrawals ?? {},
    events: init.events ?? emptyEvents(),
  };
}

// MARK: Lookups

export function playerIn(snapshot: RoundSnapshot, id: PlayerID): ScoringPlayer | undefined {
  return snapshot.players.find((p) => p.id === id);
}

export function gross(
  snapshot: RoundSnapshot,
  player: PlayerID,
  hole: number,
): number | undefined {
  return snapshot.scores[player]?.[hole];
}

/** Whether the player is still in the round when `hole` is played. */
export function isActive(
  snapshot: RoundSnapshot,
  player: PlayerID,
  hole: number,
): boolean {
  const lastHole = snapshot.withdrawals[player];
  if (lastHole === undefined) return true;
  return hole <= lastHole;
}

/** Participants of `ids` still active at `hole`, preserving the given order. */
export function activePlayers(
  snapshot: RoundSnapshot,
  ids: PlayerID[],
  hole: number,
): PlayerID[] {
  return ids.filter((id) => isActive(snapshot, id, hole));
}

/**
 * Deterministic ordering index used to break ties (cent remainders etc.).
 * Players not in the round sort last.
 */
export function orderIndex(snapshot: RoundSnapshot, id: PlayerID): number {
  const index = snapshot.players.findIndex((p) => p.id === id);
  return index === -1 ? snapshot.players.length : index;
}

/** Holes of the round that lie in the inclusive number range. */
export function holesInRange(
  snapshot: RoundSnapshot,
  lower: number,
  upper: number,
): number[] {
  return snapshot.holeNumbers.filter((n) => n >= lower && n <= upper);
}

/** The scoring players for a set of IDs, in the order given. */
export function participantsOf(
  snapshot: RoundSnapshot,
  ids: PlayerID[],
): ScoringPlayer[] {
  const result: ScoringPlayer[] = [];
  for (const id of ids) {
    const player = playerIn(snapshot, id);
    if (player) result.push(player);
  }
  return result;
}
