import type { BetEvaluation, StandingLine, StrokePlayRow } from './evaluation';
import { shortName } from './engineSupport';
import { strokeTable, strokesReceived } from './handicapping';
import { addTo, describeMoney, split, type Balances } from './money';
import {
  gross as grossAt,
  isActive,
  orderIndex,
  participantsOf,
  type RoundSnapshot,
} from './snapshot';
import { holeAt, type Bet, type PlayerID, type StrokePlayConfig } from './types';

/**
 * Pot-based stroke play: every player antes in; the low total (net or gross)
 * over the round takes the pot. Ties split it evenly, with odd cents going to
 * the earlier tee order — arbitrary but identical on every device.
 *
 * Live standings compare players **to par through the holes each has
 * completed** — the only fair mid-round comparison when the group is spread
 * across holes.
 *
 * Withdrawn players forfeit their ante (it stays in the pot) and cannot win. If
 * nobody finishes the round, the bet voids and no money moves.
 */
export function evaluateStrokePlay(
  bet: Bet,
  config: StrokePlayConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const firstHole = config.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= firstHole);

  const participants = participantsOf(snapshot, config.players);
  const courseHoles = snapshot.holeNumbers
    .map((n) => holeAt(snapshot.course, n))
    .filter((h): h is NonNullable<typeof h> => h !== undefined);
  const strokes = strokeTable(participants, courseHoles, config.handicapMode, 'full');

  const rows: StrokePlayRow[] = [];
  for (const player of config.players) {
    const isWithdrawn = snapshot.withdrawals[player] !== undefined;
    let gross = 0;
    let net = 0;
    let par = 0;
    let completed = 0;
    for (const hole of holes) {
      if (!isActive(snapshot, player, hole)) continue;
      const strokesTaken = grossAt(snapshot, player, hole);
      if (strokesTaken === undefined) continue;
      completed += 1;
      gross += strokesTaken;
      net += strokesTaken - strokesReceived(strokes, player, hole);
      par += holeAt(snapshot.course, hole)?.par ?? 0;
    }
    const counted = config.handicapMode === 'net' ? net : gross;
    rows.push({
      player,
      holesCompleted: completed,
      grossTotal: gross,
      netTotal: net,
      toPar: counted - par,
      isWithdrawn,
    });
  }

  // Leaderboard order: players with scores by to-par, then players who haven't
  // started (their to-par of 0 would otherwise outrank anyone over par),
  // withdrawn at the end.
  rows.sort((lhs, rhs) => {
    if (lhs.isWithdrawn !== rhs.isWithdrawn) return lhs.isWithdrawn ? 1 : -1;
    const lhsStarted = lhs.holesCompleted > 0;
    const rhsStarted = rhs.holesCompleted > 0;
    if (lhsStarted !== rhsStarted) return lhsStarted ? -1 : 1;
    if (lhs.toPar !== rhs.toPar) return lhs.toPar - rhs.toPar;
    if (lhs.holesCompleted !== rhs.holesCompleted) {
      return rhs.holesCompleted - lhs.holesCompleted;
    }
    return orderIndex(snapshot, lhs.player) - orderIndex(snapshot, rhs.player);
  });

  const pot = config.ante * config.players.length;
  const finishers = rows.filter((r) => !r.isWithdrawn && r.holesCompleted === holes.length);
  const everyoneDone = rows.every(
    (r) => r.isWithdrawn || r.holesCompleted === holes.length,
  );
  const isFinal = everyoneDone && finishers.length > 0;

  let settled: Balances = {};
  let projected: Balances = {};

  const payout = (winners: PlayerID[]): Balances => {
    if (winners.length === 0) return {};
    const balances: Balances = {};
    for (const player of config.players) {
      addTo(balances, player, -config.ante);
    }
    // Winners in tee order so the odd-cent rule is deterministic.
    const ordered = [...winners].sort(
      (a, b) => orderIndex(snapshot, a) - orderIndex(snapshot, b),
    );
    const shares = split(pot, ordered.length);
    ordered.forEach((winner, index) => {
      addTo(balances, winner, shares[index] ?? 0);
    });
    return balances;
  };

  const leader = rows[0];
  if (isFinal) {
    const best = Math.min(...finishers.map((r) => r.toPar));
    const winners = finishers.filter((r) => r.toPar === best).map((r) => r.player);
    settled = payout(winners);
    projected = { ...settled };
  } else if (leader && !leader.isWithdrawn && leader.holesCompleted > 0) {
    const contenders = rows.filter((r) => !r.isWithdrawn && r.holesCompleted > 0);
    const best = Math.min(...contenders.map((r) => r.toPar));
    const leaders = contenders.filter((r) => r.toPar === best).map((r) => r.player);
    projected = payout(leaders);
  }

  const toParText = (value: number): string =>
    value === 0 ? 'E' : value > 0 ? `+${value}` : `${value}`;

  const lines: StandingLine[] = rows.map((row) => {
    let statusText: string;
    if (row.isWithdrawn) {
      statusText = 'WD';
    } else if (row.holesCompleted === 0) {
      statusText = '—';
    } else {
      const total = config.handicapMode === 'net' ? row.netTotal : row.grossTotal;
      statusText = `${toParText(row.toPar)} (${total}) thru ${row.holesCompleted}`;
    }
    return {
      id: `${bet.id}-row-${row.player}`,
      title: shortName(snapshot, row.player),
      status: statusText,
      leaders: [],
      isSettled: isFinal,
    };
  });

  let headline: string;
  if (leader && leader.holesCompleted > 0 && !leader.isWithdrawn) {
    const verb = isFinal ? 'wins' : 'leads';
    headline = `${shortName(snapshot, leader.player)} ${verb} at ${toParText(leader.toPar)} · ${describeMoney(pot)} pot`;
  } else {
    headline = `${describeMoney(pot)} pot · no scores yet`;
  }

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: config.handicapMode === 'net' ? 'Net Stroke Play' : 'Gross Stroke Play',
    headline,
    lines,
    settled,
    projected,
    events: [],
    detail: { type: 'strokePlay', value: { rows, pot, isFinal } },
  };
}
