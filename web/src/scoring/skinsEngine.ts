import type {
  BetEvaluation,
  ScoringEvent,
  SkinsEvaluation,
  SkinsHoleOutcome,
  StandingLine,
} from './evaluation';
import { pairwise, shortName } from './engineSupport';
import { strokeTable, strokesReceived } from './handicapping';
import { addAll, describeMoney, type Balances } from './money';
import {
  activePlayers,
  gross,
  orderIndex,
  participantsOf,
  type RoundSnapshot,
} from './snapshot';
import { holeAt, type Bet, type PlayerID, type SkinsConfig } from './types';

/**
 * Skins: lowest unique score on a hole takes the skin. Ties carry the skin
 * forward when carryover is on, so a hole can be worth several skins.
 *
 * Money model: a skin is worth `stakePerHole` **from each other active player**
 * per unit — the standard "everyone pays the winner" convention. This keeps the
 * pot proportional to group size and stays zero-sum for any number of players.
 *
 * Rules encoded here:
 * - A hole only awards once **every active participant** has a score (a skin
 *   "won" before the last score posts could be taken back — never show money
 *   that can silently vanish).
 * - With carryover on, an unscored hole freezes later holes: the carried count
 *   depends on it. Without carryover, holes are independent, so later completed
 *   holes resolve immediately.
 * - Validation (optional): the winning score must be net par or better; a "win"
 *   with net bogey counts as a tie (carries if carryover is on).
 * - Withdrawn players stop paying and stop winning from the hole after their
 *   withdrawal. If fewer than two players remain, holes are void.
 * - A carryover left riding after the last hole dies (no rollover between
 *   rounds).
 */
export function evaluateSkins(
  bet: Bet,
  config: SkinsConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const firstHole = config.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= firstHole);

  const participants = participantsOf(snapshot, config.players);
  const courseHoles = snapshot.holeNumbers
    .map((n) => holeAt(snapshot.course, n))
    .filter((h): h is NonNullable<typeof h> => h !== undefined);
  // Skins is played at full allowance by convention.
  const strokes = strokeTable(participants, courseHoles, config.handicapMode, 'full');

  const outcomes: { hole: number; outcome: SkinsHoleOutcome }[] = [];
  const balances: Balances = {};
  const skinCounts: Record<PlayerID, number> = {};
  const events: ScoringEvent[] = [];
  let units = 1;
  let frozen = false;

  for (const hole of holes) {
    if (frozen) {
      outcomes.push({ hole, outcome: { type: 'pending' } });
      continue;
    }

    const active = activePlayers(snapshot, config.players, hole);
    if (active.length < 2) {
      outcomes.push({ hole, outcome: { type: 'void' } });
      continue;
    }

    // Every active player must have posted.
    const nets: { player: PlayerID; net: number }[] = [];
    let missing = false;
    for (const player of active) {
      const raw = gross(snapshot, player, hole);
      if (raw === undefined) {
        missing = true;
        break;
      }
      nets.push({ player, net: raw - strokesReceived(strokes, player, hole) });
    }
    if (missing) {
      outcomes.push({ hole, outcome: { type: 'pending' } });
      // Carryover makes later holes depend on this one.
      if (config.carryover) frozen = true;
      continue;
    }

    const best = Math.min(...nets.map((n) => n.net));
    const leaders = nets.filter((n) => n.net === best).map((n) => n.player);
    const par = holeAt(snapshot.course, hole)?.par ?? 0;
    const validated = !config.requireValidation || best <= par;

    if (leaders.length === 1 && validated) {
      const winner = leaders[0]!;
      const payers = active.filter((p) => p !== winner);
      const perPlayer = config.stakePerHole * units;
      addAll(balances, pairwise([winner], payers, perPlayer));
      skinCounts[winner] = (skinCounts[winner] ?? 0) + units;
      outcomes.push({ hole, outcome: { type: 'won', winner, units, perPlayer } });
      events.push({
        id: `${bet.id}-skin-${hole}`,
        kind: { type: 'skinWon', units },
        betID: bet.id,
        players: [winner],
        hole,
        amount: perPlayer * payers.length,
      });
      units = 1;
    } else if (config.carryover) {
      units += 1;
      outcomes.push({ hole, outcome: { type: 'carried' } });
    } else {
      outcomes.push({ hole, outcome: { type: 'dead' } });
    }
  }

  // Every hole resolved (nothing pending) means the round is over for skins —
  // anything still riding dies with it (no rollover to the next round).
  const roundComplete = !outcomes.some((e) => e.outcome.type === 'pending');
  const unitsRiding = roundComplete ? 0 : units;

  // Standings rows: awarded skins plus a "riding" note.
  const lines: StandingLine[] = [];
  for (const entry of outcomes) {
    if (entry.outcome.type === 'won') {
      const { winner, units: wonUnits, perPlayer } = entry.outcome;
      lines.push({
        id: `${bet.id}-skin-${entry.hole}`,
        title: `Hole ${entry.hole}`,
        status: `${shortName(snapshot, winner)} — ${wonUnits} skin${wonUnits === 1 ? '' : 's'} (${describeMoney(perPlayer)}/player)`,
        leaders: [winner],
        isSettled: true,
      });
    } else if (entry.outcome.type === 'carried') {
      lines.push({
        id: `${bet.id}-carry-${entry.hole}`,
        title: `Hole ${entry.hole}`,
        status: 'Tied — carried',
        leaders: [],
        isSettled: true,
      });
    }
  }
  if (unitsRiding > 1) {
    lines.push({
      id: `${bet.id}-riding`,
      title: 'Riding',
      status: `${unitsRiding} skins on the next hole`,
      leaders: [],
      isSettled: false,
    });
  }

  // Most skins first; ties broken by tee order so every device agrees.
  const counts = Object.keys(skinCounts)
    .map((player) => ({ player, count: skinCounts[player] ?? 0 }))
    .sort(
      (x, y) =>
        y.count - x.count || orderIndex(snapshot, x.player) - orderIndex(snapshot, y.player),
    );

  let headline: string;
  if (counts.length === 0) {
    headline = unitsRiding > 1 ? `${unitsRiding} skins riding` : 'No skins yet';
  } else {
    const parts = counts.map((c) => `${shortName(snapshot, c.player)} ${c.count}`);
    if (unitsRiding > 1) parts.push(`${unitsRiding} riding`);
    headline = parts.join(' · ');
  }

  const evaluation: SkinsEvaluation = { outcomes, unitsRiding, skinCounts };

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Skins',
    headline,
    lines,
    settled: balances,
    projected: { ...balances }, // a skin not yet awarded projects to no one
    events,
    detail: { type: 'skins', value: evaluation },
  };
}
