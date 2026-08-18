import type { Money } from './money';

/**
 * Stable identity for a player. The Swift app used `UUID`; on the web these are
 * UUID strings produced by `crypto.randomUUID()`. The scoring engines never see
 * anything but these IDs.
 */
export type PlayerID = string;

/**
 * A participant in a round, as the scoring engines see them.
 *
 * `playingHandicap` is the *course* handicap already resolved to whole strokes
 * for this round (9-hole rounds should already carry a 9-hole handicap).
 * Engines allocate those strokes to holes by stroke index — see `allocation`.
 */
export interface ScoringPlayer {
  id: PlayerID;
  name: string;
  playingHandicap: number;
}

export function makePlayer(id: PlayerID, name: string, playingHandicap = 0): ScoringPlayer {
  return { id, name, playingHandicap };
}

/**
 * One hole of a course. `strokeIndex` is the hole's handicap ranking on the
 * *full course* (1 = hardest). Engines rank the holes actually being played, so
 * a back-nine-only round with stroke indexes {2,4,…,18} still allocates
 * strokes sensibly.
 */
export interface HoleInfo {
  number: number;
  par: number;
  strokeIndex: number;
  yardage?: number;
}

/**
 * Course data as needed for scoring. Richer course metadata lives in the app
 * layer; the engines only need par and stroke index.
 */
export interface CourseInfo {
  name: string;
  holes: HoleInfo[];
}

export function makeCourse(name: string, holes: HoleInfo[]): CourseInfo {
  return { name, holes: [...holes].sort((a, b) => a.number - b.number) };
}

export function holeAt(course: CourseInfo, number: number): HoleInfo | undefined {
  return course.holes.find((h) => h.number === number);
}

/** Total par over a subset of holes (used for "to par thru N" displays). */
export function parOver(course: CourseInfo, holeNumbers: Iterable<number>): number {
  let total = 0;
  for (const n of holeNumbers) total += holeAt(course, n)?.par ?? 0;
  return total;
}

// MARK: - Handicapping

/** Whether a bet is played on gross scores or net (handicap-adjusted) scores. */
export type HandicapMode = 'gross' | 'net';

/**
 * How playing handicaps are applied in head-to-head formats.
 *
 * - `full`: every player receives their full allocation (skins, stroke play, wolf).
 * - `offLow`: handicaps are reduced by the lowest handicap among the bet's
 *   participants, so the best player plays at scratch (the USGA convention for
 *   match play and Nassau).
 */
export type HandicapAllowance = 'full' | 'offLow';

// MARK: - Sides (shared by Nassau & Match Play)

export type MatchSide = 'a' | 'b';

export function opponent(side: MatchSide): MatchSide {
  return side === 'a' ? 'b' : 'a';
}

// MARK: - Bets

/**
 * A configured bet on a round. `kind` is polymorphic over the five supported
 * formats; each config is a self-contained plain object so the app can persist
 * it as an opaque payload.
 *
 * Bets are immutable once the round starts. Mid-round additions are allowed
 * (that is how a late joiner gets into the action — see `firstHole`);
 * mid-round *edits* are not, because retroactively changing stakes would
 * corrupt already-settled results.
 */
export interface Bet {
  id: string;
  name: string;
  kind: BetKind;
}

export type BetKind =
  | { type: 'nassau'; config: NassauConfig }
  | { type: 'skins'; config: SkinsConfig }
  | { type: 'matchPlay'; config: MatchPlayConfig }
  | { type: 'wolf'; config: WolfConfig }
  | { type: 'strokePlay'; config: StrokePlayConfig }
  | { type: 'snake'; config: SnakeConfig }
  | { type: 'vegas'; config: VegasConfig }
  | { type: 'ninePoint'; config: NinePointConfig }
  | { type: 'sixes'; config: SixesConfig }
  | { type: 'splitSixes'; config: SplitSixesConfig }
  | { type: 'scotch'; config: ScotchConfig }
  | { type: 'junk'; config: JunkConfig }
  | { type: 'quota'; config: QuotaConfig };

export type BetType = BetKind['type'];

export function betDisplayName(kind: BetKind): string {
  switch (kind.type) {
    case 'nassau':
      return 'Nassau';
    case 'skins':
      return 'Skins';
    case 'matchPlay':
      return 'Match Play';
    case 'wolf':
      return 'Wolf';
    case 'strokePlay':
      return 'Stroke Play';
    case 'snake':
      return 'Snake';
    case 'vegas':
      return 'Vegas';
    case 'ninePoint':
      return 'Nine Point';
    case 'sixes':
      return 'Sixes';
    case 'splitSixes':
      return 'Split Sixes';
    case 'scotch':
      return 'Scotch';
    case 'junk':
      return 'Junk';
    case 'quota':
      return 'Quota';
  }
}

/** Every player with money in this bet. */
export function betParticipants(kind: BetKind): PlayerID[] {
  switch (kind.type) {
    case 'nassau':
      return [...kind.config.sideA, ...kind.config.sideB];
    case 'skins':
      return [...kind.config.players];
    case 'matchPlay':
      return [...kind.config.sideA, ...kind.config.sideB];
    case 'wolf':
      return [...kind.config.rotation];
    case 'strokePlay':
      return [...kind.config.players];
    case 'snake':
      return [...kind.config.players];
    case 'vegas':
      return [...kind.config.sideA, ...kind.config.sideB];
    case 'ninePoint':
      return [...kind.config.players];
    case 'sixes':
      return [...kind.config.players];
    case 'splitSixes':
      return [...kind.config.players];
    case 'scotch':
      return [...kind.config.sideA, ...kind.config.sideB];
    case 'junk':
      return [...kind.config.players];
    case 'quota':
      return [...kind.config.players];
  }
}

// MARK: Nassau

/**
 * Three matches in one: front nine, back nine, and overall — each for
 * `stakePerPlayer`. Presses open additional matches over the remaining holes of
 * a segment.
 *
 * Money semantics ("per man"): when a side loses a match, *each* of its members
 * pays `stakePerPlayer`; the pot is split evenly across the winning side. For a
 * 1v1 Nassau that is simply ±stake. For 2v2 at $5, each loser pays $5 and each
 * winner collects $5.
 */
export interface NassauConfig {
  sideA: PlayerID[];
  sideB: PlayerID[];
  stakePerPlayer: Money;
  handicapMode: HandicapMode;
  allowance: HandicapAllowance;
  /**
   * When set (classically 2), a new press starts automatically whenever the
   * trailing side of the segment's most recent open bet falls exactly this many
   * holes down with holes still to play. Auto-presses are *derived* from the
   * scorecard — never stored, so every device agrees without coordination.
   */
  autoPressTrigger?: number | null;
}

export type NassauSegment = 'front' | 'back' | 'total';

export function segmentLabel(segment: NassauSegment): string {
  switch (segment) {
    case 'front':
      return 'Front 9';
    case 'back':
      return 'Back 9';
    case 'total':
      return '18';
  }
}

export function nassauMembers(config: NassauConfig, side: MatchSide): PlayerID[] {
  return side === 'a' ? config.sideA : config.sideB;
}

/**
 * A manually declared press. Stored as an append-only event; the press covers
 * `firstHole` through the end of its segment at the segment's stake.
 */
export interface PressEvent {
  id: string;
  betID: string;
  segment: NassauSegment;
  firstHole: number;
  pressedBy: MatchSide;
}

// MARK: Skins

/**
 * Every hole is worth a skin; lowest unique score takes it. Ties carry the skin
 * to the next hole when `carryover` is on (so one hole can be worth several
 * skins), otherwise the skin dies.
 *
 * Money: a skin is worth `stakePerHole` *from each other participant* per
 * carried unit. Withdrawn players stop paying (and stop winning) from the hole
 * after they withdraw.
 */
export interface SkinsConfig {
  players: PlayerID[];
  stakePerHole: Money;
  handicapMode: HandicapMode;
  carryover: boolean;
  /**
   * "Validation": a skin only counts if the winning score is net par or better.
   * A hole "won" with a net bogey (everyone else doubled) is treated as a tie
   * instead — it carries when carryover is on.
   */
  requireValidation: boolean;
  /**
   * First hole this bet covers. Defaults to the round's first hole; a bet
   * created mid-round (e.g. to include a late joiner) starts here so the
   * unplayed early holes don't sit pending forever.
   */
  firstHole?: number | null;
}

// MARK: Match Play

/**
 * A head-to-head (or team best-ball) match over the whole round, tracked in
 * holes up/down with dormie and mathematical auto-close.
 */
export interface MatchPlayConfig {
  sideA: PlayerID[];
  sideB: PlayerID[];
  stakePerPlayer: Money;
  handicapMode: HandicapMode;
  allowance: HandicapAllowance;
}

export function matchPlayMembers(config: MatchPlayConfig, side: MatchSide): PlayerID[] {
  return side === 'a' ? config.sideA : config.sideB;
}

// MARK: Wolf

/**
 * Rotating-captain game. The wolf for each hole (rotation order, wrapping)
 * either picks a partner after tee shots or goes alone for a multiplier.
 *
 * Money is pairwise per hole: each member of the losing team pays
 * `stakePerHole` (times multiplier, times carried units) to each member of the
 * winning team. Pairwise transfers keep the books zero-sum for any team sizes,
 * including the 1-vs-3 lone wolf.
 */
export interface WolfConfig {
  /**
   * Tee order; the wolf on the Nth played hole is `rotation[(N-1) % count]`.
   * If that player has withdrawn, the hole is void for this bet.
   */
  rotation: PlayerID[];
  stakePerHole: Money;
  handicapMode: HandicapMode;
  /** Multiplier when the wolf declares lone after seeing tee shots. */
  loneMultiplier: number;
  /** Multiplier when the wolf declares blind (before anyone tees off). */
  blindMultiplier: number;
  /** When true, halved holes carry their units onto the next hole. */
  carryTies: boolean;
  /** See `SkinsConfig.firstHole`. */
  firstHole?: number | null;
}

export type WolfChoice =
  | { type: 'partner'; partner: PlayerID }
  | { type: 'lone' }
  | { type: 'blindLone' };

/**
 * The wolf's declared choice on one hole. Append-only event; exactly one per
 * (bet, hole) survives merge, so devices can't disagree.
 */
export interface WolfDecision {
  betID: string;
  hole: number;
  wolf: PlayerID;
  choice: WolfChoice;
}

// MARK: Stroke Play

/**
 * Everyone antes into a pot; low total (net or gross) over the round takes it.
 * Ties split the pot evenly (odd cents go to the earlier tee order —
 * deterministic on every device).
 */
export interface StrokePlayConfig {
  players: PlayerID[];
  ante: Money;
  handicapMode: HandicapMode;
  /** See `SkinsConfig.firstHole`. */
  firstHole?: number | null;
}

// MARK: Snake

/**
 * The three-putt penalty. Whoever three-putts most recently is "holding the
 * snake"; it passes to the next player who three-putts, and whoever is left
 * holding it at the end of the round pays out.
 *
 * Money: the holder pays `stakePerPlayer` to every other participant. With
 * `growPerPass` on, the pot grows by the base stake each time the snake changes
 * hands — the usual "it gets expensive late" house rule.
 *
 * This is the one format that needs putts, not just strokes. Holes with no putt
 * count entered simply can't move the snake.
 */
export interface SnakeConfig {
  players: PlayerID[];
  stakePerPlayer: Money;
  /** Putts on a hole at or above this count pass the snake. Classically 3. */
  threePuttThreshold: number;
  growPerPass: boolean;
  firstHole?: number | null;
}

// MARK: Vegas

/**
 * Two-on-two, where each side's hole score is its two scores read as a single
 * number — low digit first. A 4 and a 6 make 46. The difference between the two
 * numbers is the points swing, paid at `stakePerPoint`.
 *
 * `flipOnBirdie`: when a side makes birdie or better, the *opponent's* number is
 * flipped (65 instead of 56), which is what makes Vegas swing so violently.
 * Scores of 10+ are appended rather than concatenated as a digit, the standard
 * convention (a 10 and a 4 make 410).
 */
export interface VegasConfig {
  sideA: PlayerID[];
  sideB: PlayerID[];
  stakePerPoint: Money;
  handicapMode: HandicapMode;
  allowance: HandicapAllowance;
  flipOnBirdie: boolean;
  firstHole?: number | null;
}

// MARK: Nine Point

/**
 * Three-player game splitting nine points a hole: 5 to the best score, 3 to the
 * middle, 1 to the worst. Ties pool the points they cover and split them, so the
 * hole always distributes exactly nine (5/3/1 → 4/4/1 for a tie at the top,
 * 5/2/2 at the bottom, 3/3/3 all square).
 *
 * Money settles pairwise on point differences at `pointValue` each, which keeps
 * the books zero-sum without needing a pot.
 */
export interface NinePointConfig {
  players: PlayerID[];
  pointValue: Money;
  handicapMode: HandicapMode;
  firstHole?: number | null;
}

// MARK: Sixes

/**
 * Four players, three partnerships, six holes each — "round robin". Partners
 * rotate every six holes so everyone plays with everyone: A+B vs C+D, then
 * A+C vs B+D, then A+D vs B+C.
 *
 * Each six-hole segment is its own best-ball match at `stakePerPlayer`, settled
 * per man exactly like a Nassau segment.
 */
export interface SixesConfig {
  /** Exactly four players, in tee order; the rotation is derived from this. */
  players: PlayerID[];
  stakePerPlayer: Money;
  handicapMode: HandicapMode;
  allowance: HandicapAllowance;
}

// MARK: Split Sixes

/**
 * Three-player game splitting six points a hole: 4 to the best, 2 to the middle,
 * 0 to the worst. Ties pool and split as in Nine Point (3/3/0 tied at the top,
 * 4/1/1 tied at the bottom, 2/2/2 all square).
 */
export interface SplitSixesConfig {
  players: PlayerID[];
  pointValue: Money;
  handicapMode: HandicapMode;
  firstHole?: number | null;
}

// MARK: Scotch

/**
 * Team points per hole, also called Umbrella or Bridge. Each hole awards a point
 * for low ball (best individual score), a point for low total (combined), and a
 * point for a birdie or better. Ties on a category award nobody.
 *
 * `doubleOnSweep`: taking every available category doubles the hole, the
 * "umbrella" that gives the game its other name.
 */
export interface ScotchConfig {
  sideA: PlayerID[];
  sideB: PlayerID[];
  pointValue: Money;
  handicapMode: HandicapMode;
  allowance: HandicapAllowance;
  doubleOnSweep: boolean;
  firstHole?: number | null;
}

// MARK: Junk

/** The side-bet achievements, each worth the stake from every other player. */
export type JunkKind =
  /** On the green in regulation on a par 3. */
  | 'greenie'
  /** Up and down from a bunker. */
  | 'sandy'
  /** Par or better after hitting a tree. */
  | 'barkie'
  /** Holed from off the green. */
  | 'chipIn'
  /** Made a putt longer than the flagstick. */
  | 'poley'
  /** Longest drive on the hole. */
  | 'longDrive'
  /** Closest to the pin on a par 3. */
  | 'closestToPin';

export const JUNK_KINDS: JunkKind[] = [
  'greenie',
  'sandy',
  'barkie',
  'chipIn',
  'poley',
  'longDrive',
  'closestToPin',
];

export function junkLabel(kind: JunkKind): string {
  switch (kind) {
    case 'greenie':
      return 'Greenie';
    case 'sandy':
      return 'Sandy';
    case 'barkie':
      return 'Barkie';
    case 'chipIn':
      return 'Chip-in';
    case 'poley':
      return 'Poley';
    case 'longDrive':
      return 'Long drive';
    case 'closestToPin':
      return 'Closest to pin';
  }
}

/**
 * The grab-bag of one-off achievements. Unlike every other format these can't be
 * derived from a scorecard — somebody has to say "that was a sandy" — so they
 * arrive as append-only claim events, the same conflict-free shape as Wolf picks.
 */
export interface JunkConfig {
  players: PlayerID[];
  /** Paid by every other participant, per claim. */
  stakePerItem: Money;
  /** Which achievements this group plays for. */
  enabled: JunkKind[];
  firstHole?: number | null;
}

/** One claimed piece of junk. Identity is (bet, hole, kind, player). */
export interface JunkClaim {
  betID: string;
  hole: number;
  kind: JunkKind;
  player: PlayerID;
}

export function junkClaimID(claim: JunkClaim): string {
  return `${claim.betID}|${claim.hole}|${claim.kind}|${claim.player}`;
}

// MARK: Quota

/**
 * Points against a target. Each player's quota is `quotaBase` minus their
 * playing handicap (36 for 18 holes is the standard), and they earn Stableford-
 * style points per hole. Finishing over quota is what pays.
 *
 * Money settles pairwise on the difference between players' over/under figures
 * at `pointValue` each.
 */
export interface QuotaConfig {
  players: PlayerID[];
  pointValue: Money;
  /** Target before handicap; 36 over 18 holes, 18 over 9. */
  quotaBase: number;
  firstHole?: number | null;
}

/**
 * Stableford-style points for a gross score against par: bogey 1, par 2,
 * birdie 4, eagle 6, albatross or better 8. Double bogey and worse score none.
 */
export function quotaPoints(strokes: number, par: number): number {
  const toPar = strokes - par;
  if (toPar <= -3) return 8;
  if (toPar === -2) return 6;
  if (toPar === -1) return 4;
  if (toPar === 0) return 2;
  if (toPar === 1) return 1;
  return 0;
}
