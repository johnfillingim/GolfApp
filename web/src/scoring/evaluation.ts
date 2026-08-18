import type { Balances, Money } from './money';
import type { MatchSide, NassauSegment, PlayerID, WolfChoice } from './types';

/**
 * The uniform output of evaluating one bet against a `RoundSnapshot`.
 *
 * Two money views are exposed:
 * - `settled`: components that are mathematically final (a closed-out match, an
 *   awarded skin). This is what "you can't lose it anymore" means.
 * - `projected`: settled money *plus* open components assuming the current
 *   leaders hold. This is the number the live standings screen leads with.
 *
 * Both maps are zero-sum across players — verified on every evaluation.
 */
export interface BetEvaluation {
  betID: string;
  betName: string;
  kindName: string;
  /** One-line status, e.g. "F: Jack 2↑ · B: AS · T: Jack 1↑ · 2 presses". */
  headline: string;
  /** Per-component rows for detail UI. */
  lines: StandingLine[];
  settled: Balances;
  projected: Balances;
  /**
   * Deterministic, stably-identified moments (skin won, match closed, press
   * started…) for the celebration engine. Because IDs are stable,
   * re-evaluations never double-fire a celebration.
   */
  events: ScoringEvent[];
  detail: BetDetail;
}

/** A single display row in the standings detail for a bet. */
export interface StandingLine {
  id: string;
  /** Row label, e.g. "Front 9", "Press #2 (from 7)", "Hole 4 — 3 skins". */
  title: string;
  /** Row status, e.g. "Jack 2 UP thru 8", "Carried", "Dormie". */
  status: string;
  /** Players currently winning this component. */
  leaders: PlayerID[];
  isSettled: boolean;
}

/** Format-specific payloads for UIs that want more than the generic lines. */
export type BetDetail =
  | { type: 'nassau'; value: NassauEvaluation }
  | { type: 'skins'; value: SkinsEvaluation }
  | { type: 'matchPlay'; value: MatchPlayEvaluation }
  | { type: 'wolf'; value: WolfEvaluation }
  | { type: 'strokePlay'; value: StrokePlayEvaluation }
  | { type: 'points'; value: PointsEvaluation }
  | { type: 'snake'; value: SnakeEvaluation }
  | { type: 'vegas'; value: VegasEvaluation }
  | { type: 'segments'; value: SegmentsEvaluation }
  | { type: 'junk'; value: JunkEvaluation };

// MARK: - Scoring events

export type ScoringEventKind =
  /** `units` skins taken on one hole. */
  | { type: 'skinWon'; units: number }
  /** A press opened (auto or manual). */
  | { type: 'pressStarted'; auto: boolean }
  /** A match or segment became mathematically decided. */
  | { type: 'matchClosed'; margin: string }
  /** A Nassau segment finished with a winner. */
  | { type: 'segmentDecided'; segment: NassauSegment }
  /** Lone/blind wolf took the hole at a multiplier. */
  | { type: 'wolfWon'; multiplier: number };

/**
 * A discrete bet moment with a *stable identity*. The celebration engine keeps
 * a set of already-fired IDs per round; because evaluation is deterministic, an
 * event either exists with the same ID every time or not at all.
 */
export interface ScoringEvent {
  id: string;
  kind: ScoringEventKind;
  betID: string;
  /** The players being celebrated (winners). */
  players: PlayerID[];
  hole?: number;
  /** Headline money attached to the moment, when meaningful. */
  amount?: Money;
}

// MARK: - Match status (shared by Nassau / Match Play)

/**
 * Running state of one match (an original segment bet, a press, or a full
 * match-play bet).
 */
export interface MatchStatus {
  /** Holes with a decided result so far. */
  holesDecided: number;
  /** Positive = side A leads by that many holes. */
  upA: number;
  /**
   * Holes that can still change the result (includes not-yet-entered holes
   * earlier in the range — a skipped hole can still be filled in later).
   */
  remaining: number;
  /** Mathematically over: |upA| > remaining. */
  closed: boolean;
  /** Set when closed, or when all holes are decided and one side leads. */
  winner: MatchSide | null;
  /** The side that is dormie (leading by exactly the holes remaining). */
  dormieSide: MatchSide | null;
  /** Highest hole number with a decided result (drives "thru N"). */
  thruHole: number | null;
  /** Human status: "2 UP thru 12", "3&2", "Dormie 2", "AS thru 4". */
  display: string;
}

export function matchLeader(status: MatchStatus): MatchSide | null {
  if (status.upA > 0) return 'a';
  if (status.upA < 0) return 'b';
  return null;
}

/** Margin in holes from the leader's perspective. */
export function matchMargin(status: MatchStatus): number {
  return Math.abs(status.upA);
}

// MARK: - Per-format evaluation payloads

export interface MatchHoleResult {
  hole: number;
  /** null = halved. */
  winner: MatchSide | null;
  /** Cumulative up-count (A positive) after this hole. */
  upAAfter: number;
  /** True when decided by concession (withdrawal) rather than by scores. */
  byConcession: boolean;
}

/**
 * The result of running one match (side A vs side B over an ordered set of
 * holes). Shared by Match Play, every Nassau segment, and every press.
 */
export interface MatchComputation {
  status: MatchStatus;
  /** Decided holes in play order (stops at the point the match closed). */
  holeResults: MatchHoleResult[];
  /** Holes with no result yet (missing scores), still able to count. */
  pendingHoles: number[];
}

export interface NassauBetLine {
  label: string;
  segment: NassauSegment;
  firstHole: number;
  isPress: boolean;
  isAutoPress: boolean;
  match: MatchComputation;
}

export interface NassauSegmentResult {
  segment: NassauSegment;
  /** Original bet first, presses in the order they opened. */
  bets: NassauBetLine[];
}

export interface NassauEvaluation {
  segments: NassauSegmentResult[];
}

export function nassauPressCount(evaluation: NassauEvaluation): number {
  return evaluation.segments.reduce(
    (sum, segment) => sum + segment.bets.filter((b) => b.isPress).length,
    0,
  );
}

export type SkinsHoleOutcome =
  /** Winner took `units` skins worth `perPlayer` from each other player. */
  | { type: 'won'; winner: PlayerID; units: number; perPlayer: Money }
  /** Tied; skin carried forward. */
  | { type: 'carried' }
  /** Tied in no-carryover mode, or validation failed — skin is gone. */
  | { type: 'dead' }
  /** Not all active players have scores yet. */
  | { type: 'pending' }
  /** Fewer than two active players — no contest. */
  | { type: 'void' };

export interface SkinsEvaluation {
  outcomes: { hole: number; outcome: SkinsHoleOutcome }[];
  /** Skins currently riding on the next playable hole. */
  unitsRiding: number;
  skinCounts: Record<PlayerID, number>;
}

export interface MatchPlayEvaluation {
  match: MatchComputation;
}

export type WolfHoleOutcome =
  | { type: 'wolfTeamWon'; multiplier: number; units: number }
  | { type: 'othersWon'; multiplier: number; units: number }
  | { type: 'halved'; carried: boolean }
  /** Waiting on a decision or scores. */
  | { type: 'pending' }
  /** Wolf withdrew / not enough opponents. */
  | { type: 'void' };

export interface WolfHoleLine {
  hole: number;
  wolf: PlayerID;
  choice: WolfChoice | null;
  outcome: WolfHoleOutcome;
}

export interface WolfEvaluation {
  holes: WolfHoleLine[];
  unitsRiding: number;
  points: Balances;
}

export interface StrokePlayRow {
  player: PlayerID;
  holesCompleted: number;
  grossTotal: number;
  netTotal: number;
  /**
   * Net (or gross, per mode) relative to par over completed holes — the fair
   * live comparison when players are thru different holes.
   */
  toPar: number;
  isWithdrawn: boolean;
}

export interface StrokePlayEvaluation {
  /** Sorted best-first by `toPar` (withdrawn players last). */
  rows: StrokePlayRow[];
  pot: Money;
  isFinal: boolean;
}

/** Shared shape for the points formats (Nine Point, Split Sixes, Quota). */
export interface PointsEvaluation {
  rows: { player: PlayerID; points: number }[];
  holesCounted: number;
}

export interface SnakePass {
  hole: number;
  /** Who picked the snake up on this hole. */
  player: PlayerID;
  putts: number;
}

export interface SnakeEvaluation {
  passes: SnakePass[];
  /** Whoever is stuck with it right now; null if nobody has three-putted. */
  holder: PlayerID | null;
  /** What the holder currently owes each other player. */
  valuePerPlayer: Money;
  /** True once every hole is scored, so the holder can no longer change. */
  isFinal: boolean;
}

export interface VegasHoleLine {
  hole: number;
  /** null when the hole isn't fully scored yet. */
  numberA: number | null;
  numberB: number | null;
  /** Positive = side A gained that many points. */
  swing: number;
  /** A flip fired against the named side because the other side birdied. */
  flipped: 'a' | 'b' | null;
}

export interface VegasEvaluation {
  holes: VegasHoleLine[];
  /** Cumulative points, side A's perspective. */
  totalSwing: number;
}

/** For formats built from several independent sub-matches (Sixes, Scotch). */
export interface SegmentLine {
  label: string;
  holes: number[];
  /** Who is on each side for this segment. */
  sideA: PlayerID[];
  sideB: PlayerID[];
  status: string;
  /** Positive = side A leads. */
  margin: number;
  isSettled: boolean;
}

export interface SegmentsEvaluation {
  segments: SegmentLine[];
}

export interface JunkEvaluation {
  claims: { hole: number; kind: string; player: PlayerID; amount: Money }[];
  counts: Record<PlayerID, number>;
}
