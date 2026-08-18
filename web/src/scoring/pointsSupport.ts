import { strokeTable, strokesReceived } from './handicapping';
import { addTo, type Balances, type Money } from './money';
import { gross, participantsOf, type RoundSnapshot } from './snapshot';
import {
  holeAt,
  type HandicapAllowance,
  type HandicapMode,
  type PlayerID,
} from './types';

/**
 * Shared machinery for the formats that score in points rather than holes.
 *
 * Two things every one of them needs: net scores under the bet's own handicap
 * settings, and a way to turn a points table into zero-sum money.
 */

/** Resolves a per-hole net score for each participant. */
export function netScorer(
  snapshot: RoundSnapshot,
  players: PlayerID[],
  mode: HandicapMode,
  allowance: HandicapAllowance = 'full',
): (player: PlayerID, hole: number) => number | undefined {
  const participants = participantsOf(snapshot, players);
  const courseHoles = snapshot.holeNumbers
    .map((n) => holeAt(snapshot.course, n))
    .filter((h): h is NonNullable<typeof h> => h !== undefined);
  const strokes = strokeTable(participants, courseHoles, mode, allowance);

  return (player, hole) => {
    const raw = gross(snapshot, player, hole);
    if (raw === undefined) return undefined;
    return raw - strokesReceived(strokes, player, hole);
  };
}

/**
 * Settles a points table pairwise: every player pays every other player the
 * difference in their point totals, at `pointValue` a point.
 *
 * Pairwise settlement is zero-sum by construction for any number of players,
 * and it is what the points games actually describe ("you were four points up
 * on me"). A pot would need a tie policy and wouldn't match how these are
 * played.
 */
export function settlePointsPairwise(
  points: Record<PlayerID, number>,
  order: PlayerID[],
  pointValue: Money,
): Balances {
  const balances: Balances = {};
  if (pointValue === 0) return balances;

  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const a = order[i]!;
      const b = order[j]!;
      // Rounded because a fractional point value (a half-point tie at an odd
      // stake) must still land on whole cents. The transfer stays symmetric, so
      // rounding can never break the zero-sum invariant.
      const swing = Math.round(((points[a] ?? 0) - (points[b] ?? 0)) * pointValue);
      if (swing === 0) continue;
      addTo(balances, a, swing);
      addTo(balances, b, -swing);
    }
  }
  return balances;
}

/**
 * Splits `total` points across positions with ties pooling and sharing.
 *
 * The points games all work this way: rank the scores, and anyone tied for a
 * set of positions pools those positions' points and splits them. Splitting
 * uses tenths internally so a three-way tie for 5/3/1 comes out exactly even
 * rather than dropping a point to rounding.
 *
 * Returns points in *tenths* so the caller keeps integer math.
 */
export function splitPositionPoints(
  scores: { player: PlayerID; net: number }[],
  positionPoints: number[],
): Record<PlayerID, number> {
  const tenths: Record<PlayerID, number> = {};
  const ranked = [...scores].sort((a, b) => a.net - b.net);

  let index = 0;
  while (index < ranked.length) {
    // Everyone sharing this score shares the positions they collectively cover.
    let end = index;
    while (end + 1 < ranked.length && ranked[end + 1]!.net === ranked[index]!.net) {
      end += 1;
    }
    const count = end - index + 1;
    let pool = 0;
    for (let p = index; p <= end; p++) pool += (positionPoints[p] ?? 0) * 10;
    const share = Math.trunc(pool / count);
    let remainder = pool - share * count;
    for (let p = index; p <= end; p++) {
      // Odd tenths go to the earliest tied player, which is stable because the
      // caller passes players in tee order.
      const extra = remainder > 0 ? 1 : 0;
      remainder -= extra;
      tenths[ranked[p]!.player] = share + extra;
    }
    index = end + 1;
  }

  return tenths;
}
