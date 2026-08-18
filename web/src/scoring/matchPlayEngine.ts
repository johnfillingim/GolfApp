import type { BetEvaluation, ScoringEvent, StandingLine } from './evaluation';
import { perLoserStake, sideName } from './engineSupport';
import { computeMatch } from './matchEngine';
import { addAll, type Balances } from './money';
import type { RoundSnapshot } from './snapshot';
import {
  matchPlayMembers,
  opponent,
  type Bet,
  type MatchPlayConfig,
} from './types';

/**
 * Head-to-head (or team best-ball) match play over the whole round. Tracks
 * holes up/down/halved, dormie, and closes the match the moment it is
 * mathematically decided ("4&3"). All the hole logic lives in the match engine;
 * this engine adds money and presentation.
 */
export function evaluateMatchPlay(
  bet: Bet,
  config: MatchPlayConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const comp = computeMatch(
    config.sideA,
    config.sideB,
    snapshot.holeNumbers,
    snapshot,
    config.handicapMode,
    config.allowance,
  );

  const status = comp.status;
  const decided = status.closed || status.remaining === 0;

  const settled: Balances = {};
  const projected: Balances = {};
  const events: ScoringEvent[] = [];

  const leaderSide =
    status.winner ?? (status.upA > 0 ? 'a' : status.upA < 0 ? 'b' : null);

  if (decided && status.winner !== null) {
    const winner = status.winner;
    const move = perLoserStake(
      matchPlayMembers(config, winner),
      matchPlayMembers(config, opponent(winner)),
      config.stakePerPlayer,
    );
    addAll(settled, move);
    addAll(projected, move);
    events.push({
      id: `${bet.id}-closed`,
      kind: { type: 'matchClosed', margin: status.display },
      betID: bet.id,
      players: matchPlayMembers(config, winner),
      ...(status.thruHole !== null ? { hole: status.thruHole } : {}),
      amount:
        config.stakePerPlayer * matchPlayMembers(config, opponent(winner)).length,
    });
  } else if (!decided && leaderSide !== null) {
    addAll(
      projected,
      perLoserStake(
        matchPlayMembers(config, leaderSide),
        matchPlayMembers(config, opponent(leaderSide)),
        config.stakePerPlayer,
      ),
    );
  }

  const headline =
    leaderSide !== null
      ? `${sideName(snapshot, matchPlayMembers(config, leaderSide))} ${status.display}`
      : status.display;

  const line: StandingLine = {
    id: `${bet.id}-match`,
    title: `${sideName(snapshot, config.sideA)} vs ${sideName(snapshot, config.sideB)}`,
    status: headline,
    leaders: leaderSide !== null ? matchPlayMembers(config, leaderSide) : [],
    isSettled: decided,
  };

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Match Play',
    headline,
    lines: [line],
    settled,
    projected,
    events,
    detail: { type: 'matchPlay', value: { match: comp } },
  };
}
