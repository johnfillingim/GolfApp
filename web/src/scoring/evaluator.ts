import type { BetEvaluation } from './evaluation';
import { totalCents } from './money';
import { evaluateJunk } from './junkEngine';
import { evaluateMatchPlay } from './matchPlayEngine';
import { evaluateNinePoint, evaluateQuota, evaluateSplitSixes } from './pointsEngines';
import { evaluateScotch, evaluateSixes } from './teamEngines';
import { evaluateSnake } from './snakeEngine';
import { evaluateVegas } from './vegasEngine';
import { evaluateNassau } from './nassauEngine';
import { evaluateSkins } from './skinsEngine';
import { evaluateStrokePlay } from './strokePlayEngine';
import { evaluateWolf } from './wolfEngine';
import type { RoundSnapshot } from './snapshot';
import type { Bet } from './types';

/**
 * When true, a zero-sum violation throws instead of logging. Tests and dev
 * builds want the throw (an engine inventing money is a real bug); a phone in
 * the middle of a round does not — there, the round keeps working and the
 * problem is reported to the console.
 *
 * The Swift original used `assert`, which is debug-only; this is the same
 * intent with an explicit switch.
 */
export const moneyChecks = { strict: true };

function checkZeroSum(evaluation: BetEvaluation): void {
  const leaks: [string, number][] = [
    ['settled', totalCents(evaluation.settled)],
    ['projected', totalCents(evaluation.projected)],
  ];
  for (const [label, leak] of leaks) {
    if (leak === 0) continue;
    const message = `${evaluation.kindName} ${label} balances leak ${leak}¢`;
    if (moneyChecks.strict) throw new Error(message);
    console.error(message);
  }
}

/**
 * Front door of the scoring module: turns (bet, snapshot) into a
 * `BetEvaluation`. Pure and deterministic — same inputs, same standings.
 */
export function evaluateBet(bet: Bet, snapshot: RoundSnapshot): BetEvaluation {
  let evaluation: BetEvaluation;
  switch (bet.kind.type) {
    case 'nassau':
      evaluation = evaluateNassau(bet, bet.kind.config, snapshot);
      break;
    case 'skins':
      evaluation = evaluateSkins(bet, bet.kind.config, snapshot);
      break;
    case 'matchPlay':
      evaluation = evaluateMatchPlay(bet, bet.kind.config, snapshot);
      break;
    case 'wolf':
      evaluation = evaluateWolf(bet, bet.kind.config, snapshot);
      break;
    case 'strokePlay':
      evaluation = evaluateStrokePlay(bet, bet.kind.config, snapshot);
      break;
    case 'snake':
      evaluation = evaluateSnake(bet, bet.kind.config, snapshot);
      break;
    case 'vegas':
      evaluation = evaluateVegas(bet, bet.kind.config, snapshot);
      break;
    case 'ninePoint':
      evaluation = evaluateNinePoint(bet, bet.kind.config, snapshot);
      break;
    case 'sixes':
      evaluation = evaluateSixes(bet, bet.kind.config, snapshot);
      break;
    case 'splitSixes':
      evaluation = evaluateSplitSixes(bet, bet.kind.config, snapshot);
      break;
    case 'scotch':
      evaluation = evaluateScotch(bet, bet.kind.config, snapshot);
      break;
    case 'junk':
      evaluation = evaluateJunk(bet, bet.kind.config, snapshot);
      break;
    case 'quota':
      evaluation = evaluateQuota(bet, bet.kind.config, snapshot);
      break;
  }

  // The invariant every engine must uphold: money only moves between players.
  // If this ever fires, an engine is inventing or destroying dollars.
  checkZeroSum(evaluation);

  return evaluation;
}

export function evaluateAll(bets: Bet[], snapshot: RoundSnapshot): BetEvaluation[] {
  return bets.map((bet) => evaluateBet(bet, snapshot));
}
