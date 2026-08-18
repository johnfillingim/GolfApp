import type { Bet, PlayerID, RoundEvents } from '../scoring';
import type { CatalogCourse } from './courses';

/**
 * The stored shape of the app's data.
 *
 * The iOS app used a relational SwiftData schema because CloudKit sync needed
 * per-record granularity. This build is single-device, so a round is stored as
 * one self-contained document — far simpler, and it still carries every field
 * the sync layer would need if it ever comes back.
 */

/** A person known to this device: the local user or a buddy. */
export interface PlayerProfile {
  id: string;
  name: string;
  /** Single-emoji avatar; keeps profiles fun with zero asset pipeline. */
  emoji: string;
  /** WHS handicap index (e.g. 12.4). Optional — plenty of groups play gross. */
  handicapIndex: number | null;
  /** True for the profile that owns this device. */
  isMe: boolean;
  createdAt: number;
}

/**
 * Course handicap for a round, resolved to whole strokes. Slope-adjusted
 * course handicaps need a course rating API; rounding the index is the standard
 * casual fallback, and is what the Swift app did.
 */
export function playingHandicap(profile: PlayerProfile, holeCount: number): number {
  if (profile.handicapIndex === null) return 0;
  const index = profile.handicapIndex;
  return holeCount <= 9 ? Math.round(index / 2) : Math.round(index);
}

export type RoundStatus = 'setup' | 'live' | 'finished';

/**
 * A player *in a specific round*. Snapshots name/emoji/handicap at round time
 * so history doesn't rewrite itself when a profile changes.
 */
export interface RoundPlayerRecord {
  /** This IS the scoring `PlayerID` for the round. */
  id: PlayerID;
  profileID: string | null;
  name: string;
  emoji: string;
  playingHandicap: number;
  /** Tee order; also the Wolf rotation and deterministic tiebreak order. */
  teeOrder: number;
}

/** One player's entry on one hole. */
export interface ScoreEntry {
  strokes: number | null;
  putts: number | null;
  fairwayHit: boolean | null;
  greenInRegulation: boolean | null;
  updatedAt: number;
}

/** playerID → hole number → entry. */
export type ScoreTable = Record<PlayerID, Record<number, ScoreEntry>>;

/** One settle-up line's paid/unpaid state, keyed by the transfer's stable ID. */
export interface SettlementMark {
  transferID: string;
  settledAt: number | null;
  note: string | null;
}

/** One outing: course snapshot, players, bets, scores, settlement. */
export interface StoredRound {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: RoundStatus;
  /** Catalog identifier (for "play it again"). */
  courseID: string;
  /** The frozen card — a round never breaks if the catalog changes. */
  course: CatalogCourse;
  /** The holes being played: all 18, the front, or the back. */
  holeNumbers: number[];
  players: RoundPlayerRecord[];
  scores: ScoreTable;
  bets: Bet[];
  /** Append-only presses and Wolf picks. */
  events: RoundEvents;
  /** playerID → last hole played before withdrawing. */
  withdrawals: Record<PlayerID, number>;
  settlementMarks: SettlementMark[];
  /**
   * Celebration IDs already fired for this round. Persisting this is what makes
   * re-evaluation (or reopening the app) not replay old confetti.
   */
  firedCelebrations: string[];
}

export function emptyScoreEntry(): ScoreEntry {
  return {
    strokes: null,
    putts: null,
    fairwayHit: null,
    greenInRegulation: null,
    updatedAt: Date.now(),
  };
}

/** Reads a score entry, or undefined when the hole hasn't been touched. */
export function scoreEntry(
  round: StoredRound,
  player: PlayerID,
  hole: number,
): ScoreEntry | undefined {
  return round.scores[player]?.[hole];
}

/** Whether every active player has a score on every hole of the round. */
export function isRoundComplete(round: StoredRound): boolean {
  return round.players.every((player) => {
    if (round.withdrawals[player.id] !== undefined) return true;
    return round.holeNumbers.every(
      (hole) => scoreEntry(round, player.id, hole)?.strokes != null,
    );
  });
}

/** Holes with at least one score entered — drives "thru N" summaries. */
export function holesStarted(round: StoredRound): number {
  return round.holeNumbers.filter((hole) =>
    round.players.some((p) => scoreEntry(round, p.id, hole)?.strokes != null),
  ).length;
}
