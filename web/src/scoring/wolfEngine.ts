import type {
  BetEvaluation,
  ScoringEvent,
  StandingLine,
  WolfHoleLine,
} from './evaluation';
import { pairwise, shortName } from './engineSupport';
import { strokeTable, strokesReceived } from './handicapping';
import { addAll, balanceOf, describeMoney, type Balances } from './money';
import {
  activePlayers,
  gross,
  isActive,
  orderIndex,
  participantsOf,
  type RoundSnapshot,
} from './snapshot';
import { holeAt, type Bet, type PlayerID, type WolfConfig } from './types';

/**
 * Wolf: the tee order rotates a "wolf" each hole. After watching tee shots the
 * wolf either picks a partner (2 vs rest, best ball) or goes lone for a
 * multiplier; declaring blind before anyone tees off earns a bigger one.
 *
 * Money is **pairwise per hole**: every member of the losing team pays
 * `stakePerHole × multiplier × carried units` to every member of the winning
 * team. Pairwise transfers are zero-sum for any team split, including the lone
 * wolf's 1-vs-N.
 *
 * Rules encoded here:
 * - The wolf on the Nth hole this bet covers is `rotation[(N-1) % count]` (tee
 *   order wraps).
 * - A hole is `pending` until the wolf has declared *and* every active player
 *   has a score. With `carryTies` on, an unresolved hole freezes the ones after
 *   it (their value depends on the carry).
 * - If the wolf has withdrawn (or fewer than 2 opponents remain), the hole is
 *   void; any carried units ride through to the next live hole.
 * - Halved holes: units carry when `carryTies` is on, otherwise the hole simply
 *   pushes.
 */
export function evaluateWolf(
  bet: Bet,
  config: WolfConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const firstHole = config.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= firstHole);

  const participants = participantsOf(snapshot, config.rotation);
  const courseHoles = snapshot.holeNumbers
    .map((n) => holeAt(snapshot.course, n))
    .filter((h): h is NonNullable<typeof h> => h !== undefined);
  const strokes = strokeTable(participants, courseHoles, config.handicapMode, 'full');

  const net = (player: PlayerID, hole: number): number | undefined => {
    const raw = gross(snapshot, player, hole);
    if (raw === undefined) return undefined;
    return raw - strokesReceived(strokes, player, hole);
  };

  const holeLines: WolfHoleLine[] = [];
  const balances: Balances = {};
  const events: ScoringEvent[] = [];
  let units = 1;
  let frozen = false;

  if (config.rotation.length === 0) {
    return {
      betID: bet.id,
      betName: bet.name,
      kindName: 'Wolf',
      headline: 'No players',
      lines: [],
      settled: {},
      projected: {},
      events: [],
      detail: { type: 'wolf', value: { holes: [], unitsRiding: 0, points: {} } },
    };
  }

  holes.forEach((hole, index) => {
    const expectedWolf = config.rotation[index % config.rotation.length]!;
    const decision = snapshot.events.wolfDecisions.find(
      (d) => d.betID === bet.id && d.hole === hole,
    );

    if (frozen) {
      holeLines.push({
        hole,
        wolf: expectedWolf,
        choice: decision?.choice ?? null,
        outcome: { type: 'pending' },
      });
      return;
    }

    const active = activePlayers(snapshot, config.rotation, hole);

    // Void: wolf gone, or not enough opposition for a game.
    const playable =
      isActive(snapshot, expectedWolf, hole) &&
      (active.length >= 3 || (active.length === 2 && active.includes(expectedWolf)));
    if (!playable) {
      holeLines.push({ hole, wolf: expectedWolf, choice: null, outcome: { type: 'void' } });
      return;
    }

    // Need the wolf's declaration first.
    if (!decision || decision.wolf !== expectedWolf) {
      holeLines.push({ hole, wolf: expectedWolf, choice: null, outcome: { type: 'pending' } });
      if (config.carryTies) frozen = true;
      return;
    }

    // Build teams.
    const wolfTeam: PlayerID[] = [expectedWolf];
    let multiplier: number;
    if (decision.choice.type === 'partner') {
      const partner = decision.choice.partner;
      if (
        partner === expectedWolf ||
        !config.rotation.includes(partner) ||
        !isActive(snapshot, partner, hole)
      ) {
        // Corrupt / stale pick — treat as undeclared.
        holeLines.push({
          hole,
          wolf: expectedWolf,
          choice: decision.choice,
          outcome: { type: 'pending' },
        });
        if (config.carryTies) frozen = true;
        return;
      }
      wolfTeam.push(partner);
      multiplier = 1;
    } else if (decision.choice.type === 'lone') {
      multiplier = config.loneMultiplier;
    } else {
      multiplier = config.blindMultiplier;
    }

    const opponents = active.filter((p) => !wolfTeam.includes(p));
    if (opponents.length === 0) {
      holeLines.push({
        hole,
        wolf: expectedWolf,
        choice: decision.choice,
        outcome: { type: 'void' },
      });
      return;
    }

    // Everyone active must have posted.
    const wolfNets = wolfTeam.map((p) => net(p, hole)).filter((n): n is number => n !== undefined);
    const oppNets = opponents.map((p) => net(p, hole)).filter((n): n is number => n !== undefined);
    if (wolfNets.length !== wolfTeam.length || oppNets.length !== opponents.length) {
      holeLines.push({
        hole,
        wolf: expectedWolf,
        choice: decision.choice,
        outcome: { type: 'pending' },
      });
      if (config.carryTies) frozen = true;
      return;
    }

    const wolfBest = Math.min(...wolfNets);
    const oppBest = Math.min(...oppNets);
    const amount = config.stakePerHole * multiplier * units;

    if (wolfBest < oppBest) {
      addAll(balances, pairwise(wolfTeam, opponents, amount));
      holeLines.push({
        hole,
        wolf: expectedWolf,
        choice: decision.choice,
        outcome: { type: 'wolfTeamWon', multiplier, units },
      });
      if (multiplier > 1) {
        events.push({
          id: `${bet.id}-wolf-${hole}`,
          kind: { type: 'wolfWon', multiplier },
          betID: bet.id,
          players: [expectedWolf],
          hole,
          amount: amount * opponents.length,
        });
      }
      units = 1;
    } else if (oppBest < wolfBest) {
      addAll(balances, pairwise(opponents, wolfTeam, amount));
      holeLines.push({
        hole,
        wolf: expectedWolf,
        choice: decision.choice,
        outcome: { type: 'othersWon', multiplier, units },
      });
      units = 1;
    } else {
      const carried = config.carryTies;
      if (carried) units += 1;
      holeLines.push({
        hole,
        wolf: expectedWolf,
        choice: decision.choice,
        outcome: { type: 'halved', carried },
      });
    }
  });

  const roundComplete = !holeLines.some((l) => l.outcome.type === 'pending');
  const unitsRiding = roundComplete ? 0 : units;

  // Standings rows: money order, best first; ties broken by tee order.
  const ordered = [...config.rotation].sort(
    (x, y) =>
      balanceOf(balances, y) - balanceOf(balances, x) ||
      orderIndex(snapshot, x) - orderIndex(snapshot, y),
  );
  const lines: StandingLine[] = ordered.map((player) => {
    const money = balanceOf(balances, player);
    return {
      id: `${bet.id}-row-${player}`,
      title: shortName(snapshot, player),
      status: describeMoney(money),
      leaders: money > 0 ? [player] : [],
      isSettled: roundComplete,
    };
  });
  if (unitsRiding > 1) {
    lines.push({
      id: `${bet.id}-riding`,
      title: 'Carrying',
      status: `${unitsRiding}× next hole`,
      leaders: [],
      isSettled: false,
    });
  }

  const played = holeLines.filter(
    (l) =>
      l.outcome.type === 'wolfTeamWon' ||
      l.outcome.type === 'othersWon' ||
      l.outcome.type === 'halved',
  ).length;

  const top = ordered[0];
  let headline: string;
  if (top !== undefined && balanceOf(balances, top) > 0) {
    headline = `${shortName(snapshot, top)} +${describeMoney(balanceOf(balances, top))} thru ${played} hole${played === 1 ? '' : 's'}`;
  } else if (played === 0) {
    headline = 'Waiting on the first pick';
  } else {
    headline = `All square thru ${played}`;
  }

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Wolf',
    headline,
    lines,
    settled: balances,
    projected: { ...balances }, // hole results are final as they happen
    events,
    detail: { type: 'wolf', value: { holes: holeLines, unitsRiding, points: balances } },
  };
}
