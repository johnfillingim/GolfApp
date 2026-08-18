import type { BetEvaluation, SnakePass, StandingLine } from './evaluation';
import { pairwise, shortName } from './engineSupport';
import { addAll, describeMoney, type Balances } from './money';
import { activePlayers, type RoundSnapshot } from './snapshot';
import type { Bet, PlayerID, SnakeConfig } from './types';

/**
 * The snake: a three-putt penalty that keeps moving. Whoever three-putts last is
 * holding it, and whoever holds it when the round ends pays everyone else.
 *
 * This is the only format that reads putts rather than strokes, so a hole with
 * no putt count entered simply can't move the snake — which is the honest
 * behavior, since "did anyone three-putt?" is unknowable from a total.
 *
 * With `growPerPass` the value climbs by the base stake on every handoff, so
 * picking it up on 17 is what everyone is afraid of.
 */
export function evaluateSnake(
  bet: Bet,
  config: SnakeConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const first = config.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= first);
  const threshold = Math.max(2, config.threePuttThreshold);

  const passes: SnakePass[] = [];
  let holder: PlayerID | null = null;

  for (const hole of holes) {
    // Within one hole, tee order decides who ends up holding it — the app can't
    // know the true order of play, and tee order is the convention every other
    // tiebreak here already uses.
    for (const player of activePlayers(snapshot, config.players, hole)) {
      const putts = snapshot.putts?.[player]?.[hole];
      if (putts === undefined || putts < threshold) continue;
      passes.push({ hole, player, putts });
      holder = player;
    }
  }

  // Every hole scored means the snake can no longer change hands.
  const isFinal =
    holes.length > 0 &&
    holes.every((hole) =>
      activePlayers(snapshot, config.players, hole).every(
        (player) => snapshot.scores[player]?.[hole] !== undefined,
      ),
    );

  // The pot grows on each handoff after the first pickup.
  const multiplier = config.growPerPass ? Math.max(1, passes.length) : 1;
  const valuePerPlayer = config.stakePerPlayer * multiplier;

  const balances: Balances = {};
  if (holder !== null && isFinal) {
    const others = config.players.filter((p) => p !== holder);
    addAll(balances, pairwise(others, [holder], valuePerPlayer));
  }

  // Until the round ends the snake is a live threat, not a debt: projected
  // shows what the current holder would pay, settled stays empty.
  const projected: Balances = {};
  if (holder !== null) {
    const others = config.players.filter((p) => p !== holder);
    addAll(projected, pairwise(others, [holder], valuePerPlayer));
  }

  const lines: StandingLine[] = passes.map((pass) => ({
    id: `${bet.id}-pass-${pass.hole}-${pass.player}`,
    title: `Hole ${pass.hole}`,
    status: `${shortName(snapshot, pass.player)} three-putted (${pass.putts})`,
    leaders: [],
    isSettled: false,
  }));

  if (holder !== null) {
    lines.push({
      id: `${bet.id}-holder`,
      title: isFinal ? 'Stuck with it' : 'Holding the snake',
      status: `${shortName(snapshot, holder)} — ${describeMoney(valuePerPlayer)} to each player`,
      leaders: [],
      isSettled: isFinal,
    });
  }

  const headline =
    holder === null
      ? passes.length === 0
        ? 'No three-putts yet'
        : 'Snake is loose'
      : `${shortName(snapshot, holder)} has the snake · ${describeMoney(valuePerPlayer)} each`;

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Snake',
    headline,
    lines,
    settled: balances,
    projected,
    events: [],
    detail: {
      type: 'snake',
      value: { passes, holder, valuePerPlayer, isFinal },
    },
  };
}
