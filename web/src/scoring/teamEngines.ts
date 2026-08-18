import type { BetEvaluation, SegmentLine, StandingLine } from './evaluation';
import { perLoserStake, sideName } from './engineSupport';
import { computeMatch } from './matchEngine';
import { addAll, describeMoney, type Balances } from './money';
import { netScorer } from './pointsSupport';
import { activePlayers, type RoundSnapshot } from './snapshot';
import {
  holeAt,
  type Bet,
  type PlayerID,
  type ScotchConfig,
  type SixesConfig,
} from './types';

/**
 * Sixes and Scotch: the two formats built out of team play rather than
 * individual points.
 */

/**
 * Sixes (round robin): four players, three partnerships, six holes each, so
 * everyone plays with everyone. Each segment is its own best-ball match settled
 * per man, exactly like a Nassau segment.
 *
 * The rotation is derived from tee order: A+B vs C+D, then A+C vs B+D, then
 * A+D vs B+C. With a hole count that isn't divisible by three the segments are
 * split as evenly as possible, earliest segments taking the extra holes.
 */
export function evaluateSixes(
  bet: Bet,
  config: SixesConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const players = config.players;
  const holes = snapshot.holeNumbers;

  // Four players is what makes the rotation work; anything else can't pair up.
  if (players.length !== 4) {
    return {
      betID: bet.id,
      betName: bet.name,
      kindName: 'Sixes',
      headline: 'Needs exactly four players',
      lines: [],
      settled: {},
      projected: {},
      events: [],
      detail: { type: 'segments', value: { segments: [] } },
    };
  }

  const [a, b, c, d] = players as [PlayerID, PlayerID, PlayerID, PlayerID];
  const pairings: { sideA: PlayerID[]; sideB: PlayerID[] }[] = [
    { sideA: [a, b], sideB: [c, d] },
    { sideA: [a, c], sideB: [b, d] },
    { sideA: [a, d], sideB: [b, c] },
  ];

  const chunks = splitEvenly(holes, 3);
  const settled: Balances = {};
  const projected: Balances = {};
  const segments: SegmentLine[] = [];
  const lines: StandingLine[] = [];

  pairings.forEach((pairing, index) => {
    const segmentHoles = chunks[index] ?? [];
    if (segmentHoles.length === 0) return;

    const comp = computeMatch(
      pairing.sideA,
      pairing.sideB,
      segmentHoles,
      snapshot,
      config.handicapMode,
      config.allowance,
    );
    const decided = comp.status.closed || comp.status.remaining === 0;
    const leader =
      comp.status.winner ?? (comp.status.upA > 0 ? 'a' : comp.status.upA < 0 ? 'b' : null);

    if (decided && comp.status.winner !== null) {
      const winnerSide = comp.status.winner === 'a' ? pairing.sideA : pairing.sideB;
      const loserSide = comp.status.winner === 'a' ? pairing.sideB : pairing.sideA;
      const move = perLoserStake(winnerSide, loserSide, config.stakePerPlayer);
      addAll(settled, move);
      addAll(projected, move);
    } else if (!decided && leader !== null) {
      const winnerSide = leader === 'a' ? pairing.sideA : pairing.sideB;
      const loserSide = leader === 'a' ? pairing.sideB : pairing.sideA;
      addAll(projected, perLoserStake(winnerSide, loserSide, config.stakePerPlayer));
    }

    const label = `Holes ${segmentHoles[0]}–${segmentHoles[segmentHoles.length - 1]}`;
    const statusText =
      leader !== null
        ? `${sideName(snapshot, leader === 'a' ? pairing.sideA : pairing.sideB)} ${comp.status.display}`
        : comp.status.display;

    segments.push({
      label,
      holes: segmentHoles,
      sideA: pairing.sideA,
      sideB: pairing.sideB,
      status: statusText,
      margin: comp.status.upA,
      isSettled: decided,
    });

    lines.push({
      id: `${bet.id}-seg-${index}`,
      title: `${label} · ${sideName(snapshot, pairing.sideA)} v ${sideName(snapshot, pairing.sideB)}`,
      status: statusText,
      leaders: leader !== null ? (leader === 'a' ? pairing.sideA : pairing.sideB) : [],
      isSettled: decided,
    });
  });

  const decidedCount = segments.filter((s) => s.isSettled).length;
  const headline =
    segments.length === 0
      ? 'Not started'
      : `${decidedCount} of ${segments.length} segments decided`;

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Sixes',
    headline,
    lines,
    settled,
    projected,
    events: [],
    detail: { type: 'segments', value: { segments } },
  };
}

/** Splits a hole list into `parts` runs, earliest runs taking any remainder. */
function splitEvenly(holes: number[], parts: number): number[][] {
  const base = Math.floor(holes.length / parts);
  let extra = holes.length % parts;
  const chunks: number[][] = [];
  let cursor = 0;
  for (let i = 0; i < parts; i++) {
    const take = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    chunks.push(holes.slice(cursor, cursor + take));
    cursor += take;
  }
  return chunks;
}

/**
 * Scotch (also Umbrella or Bridge): team points per hole for low ball, low
 * total, and a birdie or better. A tied category awards nobody.
 *
 * `doubleOnSweep` doubles a hole where one side takes every available category —
 * the "umbrella" the game is named for.
 */
export function evaluateScotch(
  bet: Bet,
  config: ScotchConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const first = config.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= first);
  const members = [...config.sideA, ...config.sideB];
  const net = netScorer(snapshot, members, config.handicapMode, config.allowance);

  let pointsA = 0;
  let holesCounted = 0;
  const lines: StandingLine[] = [];

  for (const hole of holes) {
    const activeA = activePlayers(snapshot, config.sideA, hole);
    const activeB = activePlayers(snapshot, config.sideB, hole);
    const par = holeAt(snapshot.course, hole)?.par;
    if (activeA.length === 0 || activeB.length === 0 || par === undefined) continue;

    const netsA = activeA.map((p) => net(p, hole));
    const netsB = activeB.map((p) => net(p, hole));
    if (netsA.some((n) => n === undefined) || netsB.some((n) => n === undefined)) continue;

    const valuesA = netsA as number[];
    const valuesB = netsB as number[];

    // Low ball: the better single score on each side.
    const lowA = Math.min(...valuesA);
    const lowB = Math.min(...valuesB);
    const lowBall = lowA < lowB ? 1 : lowB < lowA ? -1 : 0;

    // Low total: combined.
    const totalA = valuesA.reduce((sum, v) => sum + v, 0);
    const totalB = valuesB.reduce((sum, v) => sum + v, 0);
    const lowTotal = totalA < totalB ? 1 : totalB < totalA ? -1 : 0;

    // Birdie: gross, and only when the other side doesn't also have one.
    const birdieA = hasBirdie(snapshot, activeA, hole, par);
    const birdieB = hasBirdie(snapshot, activeB, hole, par);
    const birdie = birdieA && !birdieB ? 1 : birdieB && !birdieA ? -1 : 0;

    const categories = [lowBall, lowTotal, birdie];
    let holePoints = categories.reduce((sum, v) => sum + v, 0);

    // A sweep is taking every category that was actually available: when
    // neither side birdied, that category isn't on the table.
    const available = categories.filter((_v, index) => index < 2 || birdieA || birdieB).length;
    const wonAll =
      available > 0 &&
      Math.abs(holePoints) === available &&
      categories.filter((v) => v !== 0).length === available;
    if (config.doubleOnSweep && wonAll) holePoints *= 2;

    pointsA += holePoints;
    holesCounted += 1;

    if (holePoints !== 0) {
      const winner = holePoints > 0 ? config.sideA : config.sideB;
      lines.push({
        id: `${bet.id}-hole-${hole}`,
        title: `Hole ${hole}`,
        status: `${sideName(snapshot, winner)} +${Math.abs(holePoints)}${config.doubleOnSweep && wonAll ? ' (umbrella)' : ''}`,
        leaders: winner,
        isSettled: true,
      });
    }
  }

  const balances: Balances = {};
  if (pointsA !== 0) {
    const winners = pointsA > 0 ? config.sideA : config.sideB;
    const losers = pointsA > 0 ? config.sideB : config.sideA;
    addAll(balances, perLoserStake(winners, losers, Math.abs(pointsA) * config.pointValue));
  }

  const headline =
    holesCounted === 0
      ? 'No holes scored yet'
      : pointsA === 0
        ? `All square thru ${holesCounted}`
        : `${sideName(snapshot, pointsA > 0 ? config.sideA : config.sideB)} +${Math.abs(pointsA)} pts · ${describeMoney(Math.abs(pointsA) * config.pointValue)}`;

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Scotch',
    headline,
    lines,
    settled: balances,
    projected: { ...balances },
    events: [],
    detail: {
      type: 'segments',
      value: {
        segments: [
          {
            label: 'Points',
            holes,
            sideA: config.sideA,
            sideB: config.sideB,
            status: headline,
            margin: pointsA,
            isSettled: holesCounted === holes.length && holes.length > 0,
          },
        ],
      },
    },
  };
}

function hasBirdie(
  snapshot: RoundSnapshot,
  side: PlayerID[],
  hole: number,
  par: number,
): boolean {
  return side.some((player) => {
    const strokes = snapshot.scores[player]?.[hole];
    return strokes !== undefined && strokes - par <= -1;
  });
}
