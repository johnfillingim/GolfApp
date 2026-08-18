import { strokeTable, strokesReceived } from './handicapping';
import type { MatchComputation, MatchHoleResult, MatchStatus } from './evaluation';
import { matchMargin } from './evaluation';
import {
  activePlayers,
  gross,
  participantsOf,
  type RoundSnapshot,
} from './snapshot';
import { holeAt, type HandicapAllowance, type HandicapMode, type MatchSide, type PlayerID } from './types';

/**
 * Pure hole-by-hole match evaluator.
 *
 * Rules encoded here:
 * - **Best ball**: a side's score on a hole is the lowest net score among its
 *   active members. All active members of both sides must have posted before
 *   the hole counts (a partially-entered best-ball hole could otherwise flip
 *   after being "decided").
 * - **Pending holes stay live**: a skipped hole (no scores yet) counts toward
 *   `remaining`, because it can still be filled in. Mathematical closure
 *   (`|up| > remaining`) is therefore safe even with gaps.
 * - **Withdrawals concede**: once every member of a side has withdrawn, each
 *   later hole is conceded to the other side (if it still has anyone standing).
 *   If both sides are gone, remaining holes are halved.
 * - **Auto-close**: once `|up| > remaining` the match is over; later holes are
 *   ignored for this match.
 */

/** Who won one hole, with no notion of match closure. */
export interface RawOutcome {
  /** null = halved. */
  winner: MatchSide | null;
  byConcession: boolean;
}

export interface RawOutcomes {
  /** Decided holes only. */
  byHole: Record<number, RawOutcome>;
  /** Holes with missing scores, ascending. */
  pendingHoles: number[];
}

/**
 * Who won each hole. Nassau computes this once per segment and derives the
 * original bet and every press from the same outcome table.
 */
export function rawOutcomes(
  sideA: PlayerID[],
  sideB: PlayerID[],
  holes: number[],
  snapshot: RoundSnapshot,
  mode: HandicapMode,
  allowance: HandicapAllowance,
): RawOutcomes {
  const participants = participantsOf(snapshot, [...sideA, ...sideB]);
  const courseHoles = snapshot.holeNumbers
    .map((n) => holeAt(snapshot.course, n))
    .filter((h): h is NonNullable<typeof h> => h !== undefined);
  // Strokes fall on the holes where the full round's stroke index puts them —
  // a front-nine segment does not re-spread the handicap.
  const strokes = strokeTable(participants, courseHoles, mode, allowance);

  const net = (player: PlayerID, hole: number): number | undefined => {
    const raw = gross(snapshot, player, hole);
    if (raw === undefined) return undefined;
    return raw - strokesReceived(strokes, player, hole);
  };

  const byHole: Record<number, RawOutcome> = {};
  const pending: number[] = [];

  for (const hole of [...holes].sort((a, b) => a - b)) {
    const activeA = activePlayers(snapshot, sideA, hole);
    const activeB = activePlayers(snapshot, sideB, hole);

    if (activeA.length === 0 && activeB.length === 0) {
      byHole[hole] = { winner: null, byConcession: true };
    } else if (activeA.length === 0) {
      byHole[hole] = { winner: 'b', byConcession: true };
    } else if (activeB.length === 0) {
      byHole[hole] = { winner: 'a', byConcession: true };
    } else {
      const netsA = activeA.map((p) => net(p, hole));
      const netsB = activeB.map((p) => net(p, hole));
      if (netsA.some((n) => n === undefined) || netsB.some((n) => n === undefined)) {
        pending.push(hole);
      } else {
        const bestA = Math.min(...(netsA as number[]));
        const bestB = Math.min(...(netsB as number[]));
        const winner: MatchSide | null = bestA < bestB ? 'a' : bestB < bestA ? 'b' : null;
        byHole[hole] = { winner, byConcession: false };
      }
    }
  }

  return { byHole, pendingHoles: pending };
}

/**
 * Applies cumulative match logic (closure, dormie, display) to a hole range
 * using a precomputed outcome table.
 */
export function matchStatus(holes: number[], outcomes: RawOutcomes): MatchComputation {
  const results: MatchHoleResult[] = [];
  const pending: number[] = [];
  let upA = 0;
  let closed = false;

  const ordered = [...holes].sort((a, b) => a - b);
  for (const hole of ordered) {
    if (closed) break;
    const outcome = outcomes.byHole[hole];
    if (outcome === undefined) {
      pending.push(hole);
      continue;
    }
    if (outcome.winner === 'a') upA += 1;
    else if (outcome.winner === 'b') upA -= 1;
    results.push({
      hole,
      winner: outcome.winner,
      upAAfter: upA,
      byConcession: outcome.byConcession,
    });

    // Undecided = total - decided. Pending holes are still undecided (they may
    // be filled in later), so they count toward what the trailing side could
    // still win.
    const undecidedNow = ordered.length - results.length;
    if (Math.abs(upA) > undecidedNow) {
      closed = true;
    }
  }

  const undecided = ordered.length - results.length;
  const decidedHoles = results.map((r) => r.hole);

  const status: MatchStatus = {
    holesDecided: results.length,
    upA,
    remaining: undecided,
    closed,
    winner: null,
    dormieSide: null,
    thruHole: decidedHoles.length > 0 ? Math.max(...decidedHoles) : null,
    display: '—',
  };

  if (closed) {
    status.winner = upA > 0 ? 'a' : 'b';
  } else if (undecided === 0) {
    status.winner = upA > 0 ? 'a' : upA < 0 ? 'b' : null;
  } else if (Math.abs(upA) === undecided && upA !== 0) {
    status.dormieSide = upA > 0 ? 'a' : 'b';
  }

  status.display = matchDisplay(status);

  return { status, holeResults: results, pendingHoles: pending };
}

/** One-shot convenience: raw outcomes + status over the same range. */
export function computeMatch(
  sideA: PlayerID[],
  sideB: PlayerID[],
  holes: number[],
  snapshot: RoundSnapshot,
  mode: HandicapMode,
  allowance: HandicapAllowance,
): MatchComputation {
  const outcomes = rawOutcomes(sideA, sideB, holes, snapshot, mode, allowance);
  return matchStatus(holes, outcomes);
}

/** Conventional match-play status strings. */
export function matchDisplay(status: MatchStatus): string {
  const margin = matchMargin(status);
  if (status.closed) {
    // "3&2" when decided with holes to spare; closing on the final hole reads
    // "2 UP".
    return status.remaining > 0 ? `${margin}&${status.remaining}` : `${margin} UP`;
  }
  if (status.holesDecided === 0) {
    return 'Not started';
  }
  const thru = status.thruHole !== null ? ` thru ${status.thruHole}` : '';
  if (status.remaining === 0) {
    return margin === 0 ? 'Halved' : `Final: ${margin} UP`;
  }
  if (status.dormieSide !== null) {
    return `Dormie ${margin}`;
  }
  return margin === 0 ? `AS${thru}` : `${margin} UP${thru}`;
}
