import type {
  HandicapAllowance,
  HandicapMode,
  HoleInfo,
  PlayerID,
  ScoringPlayer,
} from './types';

/** hole number → strokes received on that hole. */
export type HoleAllocation = Record<number, number>;

/** playerID → hole allocation. */
export type StrokeTable = Record<PlayerID, HoleAllocation>;

/**
 * Strokes received per hole for one player.
 *
 * Holes are ranked by their course stroke index *within the set being played* —
 * so a back-nine round whose raw stroke indexes are {2,4,...,18} still hands out
 * the first stroke on its hardest hole.
 *
 * Standard allocation: handicap `h` over `n` holes gives `h / n` strokes
 * everywhere plus one extra on the `h % n` hardest holes. Plus players
 * (negative handicap) give strokes back starting at the *easiest* hole, per USGA
 * convention.
 */
export function allocation(handicap: number, holes: HoleInfo[]): HoleAllocation {
  const count = holes.length;
  if (count === 0) return {};

  // Rank 1 = hardest among the holes actually played. Ties in stroke index
  // (shouldn't happen on real cards) break by hole number so the result stays
  // deterministic.
  const ranked = [...holes].sort(
    (a, b) => a.strokeIndex - b.strokeIndex || a.number - b.number,
  );
  const rankOf: Record<number, number> = {};
  ranked.forEach((hole, index) => {
    rankOf[hole.number] = index + 1;
  });

  const result: HoleAllocation = {};
  if (handicap >= 0) {
    const base = Math.trunc(handicap / count);
    const extras = handicap % count;
    for (const hole of holes) {
      const rank = rankOf[hole.number] ?? count;
      result[hole.number] = base + (rank <= extras ? 1 : 0);
    }
  } else {
    // A +2 gives one stroke back on each of the two easiest holes
    // (highest rank numbers).
    const give = -handicap;
    const base = Math.trunc(give / count);
    const extras = give % count;
    for (const hole of holes) {
      const rank = rankOf[hole.number] ?? count;
      const givesExtra = rank > count - extras;
      result[hole.number] = -(base + (givesExtra ? 1 : 0));
    }
  }
  return result;
}

/**
 * Net-score table for a set of participants over the round's holes.
 *
 * `allowance: 'offLow'` subtracts the group's lowest handicap first.
 * `mode: 'gross'` yields empty allocations, so callers can use one code path
 * for both modes.
 */
export function strokeTable(
  participants: ScoringPlayer[],
  holes: HoleInfo[],
  mode: HandicapMode,
  allowance: HandicapAllowance = 'full',
): StrokeTable {
  const table: StrokeTable = {};
  if (mode !== 'net') {
    for (const player of participants) {
      // First entry wins, mirroring Swift's `uniquingKeysWith` — a malformed
      // config that lists a player twice gets a benign allocation, not a crash.
      if (!(player.id in table)) table[player.id] = {};
    }
    return table;
  }

  let low = 0;
  if (participants.length > 0) {
    low = Math.min(...participants.map((p) => p.playingHandicap));
  }
  for (const player of participants) {
    if (player.id in table) continue;
    const effective =
      allowance === 'offLow' ? player.playingHandicap - low : player.playingHandicap;
    table[player.id] = allocation(effective, holes);
  }
  return table;
}

/** Strokes `player` receives on `hole` under `table` (0 when absent). */
export function strokesReceived(
  table: StrokeTable,
  player: PlayerID,
  hole: number,
): number {
  return table[player]?.[hole] ?? 0;
}
