import type { BetEvaluation, StandingLine } from './evaluation';
import { shortName } from './engineSupport';
import { balanceOf, describeMoney, type Money } from './money';
import { netScorer, settlePointsPairwise, splitPositionPoints } from './pointsSupport';
import { activePlayers, orderIndex, type RoundSnapshot } from './snapshot';
import {
  holeAt,
  quotaPoints,
  type Bet,
  type HandicapMode,
  type NinePointConfig,
  type PlayerID,
  type QuotaConfig,
  type SplitSixesConfig,
} from './types';

/**
 * The formats that score in points rather than holes won: Nine Point, Split
 * Sixes, and Quota.
 *
 * All three settle pairwise, and all three treat an unscored hole as simply not
 * counted yet — there is no carry or freeze to reason about, so a partly played
 * round always displays sensibly.
 */

/** Points are held in tenths so tie splits stay exact. */
function formatPoints(tenths: number): string {
  if (tenths % 10 === 0) return String(tenths / 10);
  return (tenths / 10).toFixed(1);
}

interface PositionOptions {
  players: PlayerID[];
  positionPoints: number[];
  pointValue: Money;
  handicapMode: HandicapMode;
  firstHole: number | null;
  kindName: string;
}

/**
 * Nine Point: 5 for the best score on a hole, 3 for the middle, 1 for the worst,
 * with ties pooling the positions they cover and splitting them.
 */
export function evaluateNinePoint(
  bet: Bet,
  config: NinePointConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  return evaluatePositionPoints(bet, snapshot, {
    players: config.players,
    positionPoints: [5, 3, 1],
    pointValue: config.pointValue,
    handicapMode: config.handicapMode,
    firstHole: config.firstHole ?? null,
    kindName: 'Nine Point',
  });
}

/** Split Sixes: 4 for the best, 2 for the middle, 0 for the worst. */
export function evaluateSplitSixes(
  bet: Bet,
  config: SplitSixesConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  return evaluatePositionPoints(bet, snapshot, {
    players: config.players,
    positionPoints: [4, 2, 0],
    pointValue: config.pointValue,
    handicapMode: config.handicapMode,
    firstHole: config.firstHole ?? null,
    kindName: 'Split Sixes',
  });
}

function evaluatePositionPoints(
  bet: Bet,
  snapshot: RoundSnapshot,
  options: PositionOptions,
): BetEvaluation {
  const { players, positionPoints, pointValue, kindName } = options;
  const allHoles = snapshot.holeNumbers;
  const first = options.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= first);

  const net = netScorer(snapshot, players, options.handicapMode, 'full');
  const tenthsBy: Record<PlayerID, number> = {};
  for (const player of players) tenthsBy[player] = 0;
  let holesCounted = 0;

  for (const hole of holes) {
    const active = activePlayers(snapshot, players, hole);
    if (active.length < 2) continue;

    const scores: { player: PlayerID; net: number }[] = [];
    let missing = false;
    for (const player of active) {
      const value = net(player, hole);
      if (value === undefined) {
        missing = true;
        break;
      }
      scores.push({ player, net: value });
    }
    if (missing) continue;

    holesCounted += 1;
    const awarded = splitPositionPoints(scores, positionPoints);
    for (const player of Object.keys(awarded)) {
      tenthsBy[player] = (tenthsBy[player] ?? 0) + (awarded[player] ?? 0);
    }
  }

  // Points live in tenths, so settle at a tenth of the stake and the arithmetic
  // stays integer throughout: a half-point tie is worth exactly half a point.
  const balances = settlePointsPairwise(tenthsBy, players, pointValue / 10);

  const complete = holes.length > 0 && holesCounted === holes.length;
  const rows = players
    .map((player) => ({ player, tenths: tenthsBy[player] ?? 0 }))
    .sort(
      (a, b) =>
        b.tenths - a.tenths ||
        orderIndex(snapshot, a.player) - orderIndex(snapshot, b.player),
    );

  const lines: StandingLine[] = rows.map((row) => ({
    id: `${bet.id}-row-${row.player}`,
    title: shortName(snapshot, row.player),
    status: `${formatPoints(row.tenths)} pts · ${describeMoney(balanceOf(balances, row.player))}`,
    leaders: balanceOf(balances, row.player) > 0 ? [row.player] : [],
    isSettled: complete,
  }));

  const leader = rows[0];
  const headline =
    holesCounted === 0 || !leader
      ? 'No holes scored yet'
      : `${shortName(snapshot, leader.player)} ${formatPoints(leader.tenths)} pts thru ${holesCounted}`;

  return {
    betID: bet.id,
    betName: bet.name,
    kindName,
    headline,
    lines,
    settled: balances,
    // Points already banked can't be taken back, so there is no open component
    // and the projected figure is the settled one.
    projected: { ...balances },
    events: [],
    detail: {
      type: 'points',
      value: {
        rows: rows.map((r) => ({ player: r.player, points: r.tenths / 10 })),
        holesCounted,
      },
    },
  };
}

/**
 * Quota: each player starts at `quotaBase` minus their handicap and earns
 * Stableford points per hole. What settles is how far over (or under) quota each
 * player finished, compared pairwise.
 */
export function evaluateQuota(
  bet: Bet,
  config: QuotaConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const first = config.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= first);

  // Quota scores gross against par: the handicap is already spent setting the
  // target, so allocating strokes as well would count it twice.
  const earned: Record<PlayerID, number> = {};
  const quotaOf: Record<PlayerID, number> = {};
  const relative: Record<PlayerID, number> = {};
  let holesCounted = 0;

  for (const player of config.players) {
    const scoring = snapshot.players.find((p) => p.id === player);
    quotaOf[player] = config.quotaBase - (scoring?.playingHandicap ?? 0);
    earned[player] = 0;
  }

  for (const hole of holes) {
    const par = holeAt(snapshot.course, hole)?.par;
    if (par === undefined) continue;
    let anyScored = false;
    for (const player of activePlayers(snapshot, config.players, hole)) {
      const strokes = snapshot.scores[player]?.[hole];
      if (strokes === undefined) continue;
      anyScored = true;
      earned[player] = (earned[player] ?? 0) + quotaPoints(strokes, par);
    }
    if (anyScored) holesCounted += 1;
  }

  for (const player of config.players) {
    relative[player] = (earned[player] ?? 0) - (quotaOf[player] ?? 0);
  }

  const balances = settlePointsPairwise(relative, config.players, config.pointValue);

  const complete = holes.length > 0 && holesCounted === holes.length;
  const rows = [...config.players].sort(
    (a, b) =>
      (relative[b] ?? 0) - (relative[a] ?? 0) ||
      orderIndex(snapshot, a) - orderIndex(snapshot, b),
  );

  const lines: StandingLine[] = rows.map((player) => {
    const over = relative[player] ?? 0;
    return {
      id: `${bet.id}-row-${player}`,
      title: shortName(snapshot, player),
      status: `${earned[player] ?? 0} of ${quotaOf[player] ?? 0} · ${over >= 0 ? '+' : ''}${over} · ${describeMoney(balanceOf(balances, player))}`,
      leaders: balanceOf(balances, player) > 0 ? [player] : [],
      isSettled: complete,
    };
  });

  const leader = rows[0];
  const headline =
    holesCounted === 0 || !leader
      ? 'No holes scored yet'
      : `${shortName(snapshot, leader)} ${(relative[leader] ?? 0) >= 0 ? '+' : ''}${relative[leader] ?? 0} on quota thru ${holesCounted}`;

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Quota',
    headline,
    lines,
    settled: balances,
    projected: { ...balances },
    events: [],
    detail: {
      type: 'points',
      value: {
        rows: rows.map((player) => ({ player, points: relative[player] ?? 0 })),
        holesCounted,
      },
    },
  };
}
