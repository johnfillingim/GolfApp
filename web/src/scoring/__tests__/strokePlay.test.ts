import { describe, expect, it } from 'vitest';
import type { BetEvaluation, StrokePlayEvaluation } from '../evaluation';
import { evaluateBet } from '../evaluator';
import { dollars, type Money } from '../money';
import type { Bet, HandicapMode, PlayerID } from '../types';
import { bob, bobID, jack, jackID, jill, jillID, pars, snapshot } from './fixtures';

function makeBet(options: {
  players: PlayerID[];
  mode?: HandicapMode;
  ante?: Money;
}): Bet {
  return {
    id: '11111111-0000-0000-0000-000000000001',
    name: 'Medal',
    kind: {
      type: 'strokePlay',
      config: {
        players: options.players,
        ante: options.ante ?? dollars(10),
        handicapMode: options.mode ?? 'net',
      },
    },
  };
}

function strokePlayDetail(evaluation: BetEvaluation): StrokePlayEvaluation {
  if (evaluation.detail.type !== 'strokePlay') {
    throw new Error('expected stroke play detail');
  }
  return evaluation.detail.value;
}

/** Par card with a bogey on the first `count` holes. */
const bogeyThrough = (count: number): number[] =>
  pars.map((par, index) => (index < count ? par + 1 : par));

describe('Stroke play', () => {
  it('splits the pot on a net tie', () => {
    // Jack (0) shoots even 72; Jill (9) shoots 80 → net 71; Bob (18) shoots
    // 89 → net 71. Jill and Bob split the $30 pot.
    const players = [jack(0), jill(9), bob(18)];
    const bet = makeBet({ players: players.map((p) => p.id) });

    const snap = snapshot({
      players,
      scores: {
        [jackID]: [...pars], // 72
        [jillID]: bogeyThrough(8), // 80
        [bobID]: bogeyThrough(17), // 89
      },
    });
    const result = evaluateBet(bet, snap);
    const detail = strokePlayDetail(result);

    expect(detail.isFinal).toBe(true);
    expect(detail.pot).toBe(dollars(30));
    expect(detail.rows[0]!.player, 'tie broken by tee order for display').toBe(jillID);
    expect(detail.rows[0]!.toPar).toBe(-1);
    expect(detail.rows[1]!.toPar).toBe(-1);

    // Winners net +$5 each (+$15 pot share − $10 ante); Jack loses his ante.
    expect(result.settled[jillID]).toBe(dollars(5));
    expect(result.settled[bobID]).toBe(dollars(5));
    expect(result.settled[jackID]).toBe(dollars(-10));
  });

  it('compares to par through holes completed on the live leaderboard', () => {
    const players = [jack(0), jill(0), bob(0)];
    const bet = makeBet({ players: players.map((p) => p.id), mode: 'gross' });
    // Jack: even thru 3. Jill: −1 thru 2. Bob: nothing yet.
    const snap = snapshot({
      players,
      scores: {
        [jackID]: [4, 5, 3],
        [jillID]: [3, 5],
      },
    });
    const result = evaluateBet(bet, snap);
    const detail = strokePlayDetail(result);

    expect(detail.isFinal).toBe(false);
    expect(detail.rows.map((r) => r.player)).toEqual([jillID, jackID, bobID]);
    expect(Object.keys(result.settled).length).toBe(0);
    // Jill leads: projected +$20 (pot 30 − ante 10); everyone else −$10.
    expect(result.projected[jillID]).toBe(dollars(20));
    expect(result.projected[jackID]).toBe(dollars(-10));
    expect(result.projected[bobID]).toBe(dollars(-10));
  });

  it('forfeits a withdrawn player’s ante without blocking finality', () => {
    const players = [jack(0), jill(9), bob(18)];
    const bet = makeBet({ players: players.map((p) => p.id) });

    const snap = snapshot({
      players,
      scores: {
        [jackID]: [...pars],
        [jillID]: bogeyThrough(8),
        [bobID]: pars.slice(0, 9),
      },
      withdrawals: { [bobID]: 9 },
    });
    const result = evaluateBet(bet, snap);
    const detail = strokePlayDetail(result);

    expect(detail.isFinal, 'a withdrawal must not block finality').toBe(true);
    expect(detail.rows[detail.rows.length - 1]!.player).toBe(bobID);
    expect(detail.rows[detail.rows.length - 1]!.isWithdrawn).toBe(true);
    // Jill nets 71 (−1) and beats Jack's 72; the pot still includes Bob's ante.
    expect(result.settled[jillID]).toBe(dollars(20));
    expect(result.settled[jackID]).toBe(dollars(-10));
    expect(result.settled[bobID]).toBe(dollars(-10));
  });

  it('uses gross totals in gross mode', () => {
    const players = [jack(0), jill(9)];
    const bet = makeBet({ players: players.map((p) => p.id), mode: 'gross' });
    const snap = snapshot({
      players,
      scores: {
        [jackID]: [...pars],
        [jillID]: bogeyThrough(8),
      },
    });
    const result = evaluateBet(bet, snap);
    expect(result.kindName).toBe('Gross Stroke Play');
    expect(result.settled[jackID]).toBe(dollars(10));
    expect(result.settled[jillID]).toBe(dollars(-10));
  });
});
