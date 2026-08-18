import { emptyEvents, unionEvents, type RoundEvents } from './snapshot';
import type { PlayerID } from './types';

/**
 * The sync-facing shape of one player's entry on one hole, with the metadata
 * needed for deterministic merging. This is the *only* mutable-by-anyone data in
 * a round; everything else is append-only or immutable.
 *
 * The web app is single-device today, so nothing here runs in anger — but the
 * iOS architecture put the merge rules in the scoring layer precisely so a sync
 * transport could be added later without touching them. Keeping the port means
 * multi-phone sync stays a new file rather than a rewrite.
 */
export interface ScoreCell {
  playerID: PlayerID;
  hole: number;
  /** null = score cleared. */
  strokes: number | null;
  putts?: number | null;
  fairwayHit?: boolean | null;
  greenInRegulation?: boolean | null;
  /** Wall-clock write time on the editing device, as epoch milliseconds. */
  updatedAt: number;
  /** Stable per-device identifier; the total-order tiebreak. */
  editorID: string;
}

export function cellKey(cell: ScoreCell): string {
  return `${cell.playerID}|${cell.hole}`;
}

/** Everything about a round that syncs between devices. */
export interface RoundChangeSet {
  cells: ScoreCell[];
  events: RoundEvents;
  /** playerID → last hole played before withdrawing. */
  withdrawals: Record<PlayerID, number>;
}

export function emptyChangeSet(): RoundChangeSet {
  return { cells: [], events: emptyEvents(), withdrawals: {} };
}

/**
 * Deterministic conflict resolution for concurrent edits from multiple phones.
 *
 * - **Score cells: last-write-wins per (player, hole).** Score entry is
 *   naturally single-writer — you type your own score — so true conflicts only
 *   occur when someone marks a score for a buddy who then edits it himself.
 *   Whole-cell LWW matches what players expect ("the last person to touch it set
 *   it") and needs no coordination. Ties on timestamp break by editor ID, then
 *   by content, so merge is commutative and associative.
 * - **Events (presses, wolf picks): grow-only set union.** Append-only facts
 *   keyed by identity; union never conflicts.
 * - **Withdrawals: earliest hole wins.** Two devices recording the same
 *   withdrawal converge on the earlier boundary.
 */

const MIN = Number.MIN_SAFE_INTEGER;

/**
 * Total order over conflicting cell versions. Never returns different winners
 * on different devices.
 */
export function newerCell(a: ScoreCell, b: ScoreCell): ScoreCell {
  if (a.updatedAt !== b.updatedAt) {
    return a.updatedAt > b.updatedAt ? a : b;
  }
  if (a.editorID !== b.editorID) {
    return a.editorID > b.editorID ? a : b;
  }
  // Same instant, same editor (clock repeat): break by content so the choice is
  // still symmetric in its arguments.
  const keyA = [a.strokes ?? MIN, a.putts ?? MIN];
  const keyB = [b.strokes ?? MIN, b.putts ?? MIN];
  const aPrecedes =
    keyA[0]! < keyB[0]! || (keyA[0] === keyB[0] && keyA[1]! < keyB[1]!);
  return aPrecedes ? b : a;
}

export function mergeChangeSets(a: RoundChangeSet, b: RoundChangeSet): RoundChangeSet {
  const cellsByKey = new Map<string, ScoreCell>();
  for (const cell of [...a.cells, ...b.cells]) {
    const key = cellKey(cell);
    const existing = cellsByKey.get(key);
    cellsByKey.set(key, existing ? newerCell(existing, cell) : cell);
  }
  // Stable ordering keeps encoded changesets comparable in tests.
  const cells = [...cellsByKey.values()].sort(
    (x, y) =>
      x.hole - y.hole ||
      (x.playerID < y.playerID ? -1 : x.playerID > y.playerID ? 1 : 0),
  );

  const withdrawals: Record<PlayerID, number> = { ...a.withdrawals };
  for (const player of Object.keys(b.withdrawals)) {
    const hole = b.withdrawals[player]!;
    const existing = withdrawals[player];
    withdrawals[player] = existing === undefined ? hole : Math.min(existing, hole);
  }

  return {
    cells,
    events: unionEvents(a.events, b.events),
    withdrawals,
  };
}

/** Applies a changeset's cells to the score table shape the engines use. */
export function scoreTableFrom(
  cells: ScoreCell[],
): Record<PlayerID, Record<number, number>> {
  const scores: Record<PlayerID, Record<number, number>> = {};
  for (const cell of cells) {
    if (cell.strokes === null || cell.strokes === undefined) continue;
    const existing = scores[cell.playerID] ?? {};
    existing[cell.hole] = cell.strokes;
    scores[cell.playerID] = existing;
  }
  return scores;
}
