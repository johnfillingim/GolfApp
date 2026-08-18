import { describe, expect, it } from 'vitest';
import { evaluateBet } from '../evaluator';
import { dollars, totalCents } from '../money';
import { makeSnapshot } from '../snapshot';
import { vegasNumber } from '../vegasEngine';
import type { Bet, JunkClaim, PlayerID } from '../types';
import {
  _,
  bob,
  bobID,
  course18,
  jack,
  jackID,
  jill,
  jillID,
  pars,
  scoresFrom,
  snapshot,
  sue,
  sueID,
  type Card,
} from './fixtures';

/**
 * Worked examples for the eight formats added after the Swift port. These have
 * no XCTest ancestor, so the expectations here are hand-computed the same way
 * the originals were — the arithmetic is written out in each comment so a
 * disagreement can be settled by reading rather than by debugging.
 */

const four = () => [jack(), jill(), bob(), sue()];
const three = () => [jack(), jill(), bob()];

describe('Snake', () => {
  const bet = (growPerPass: boolean): Bet => ({
    id: 'SNAKE-1',
    name: 'Snake',
    kind: {
      type: 'snake',
      config: {
        players: [jackID, jillID, bobID],
        stakePerPlayer: dollars(2),
        threePuttThreshold: 3,
        growPerPass: growPerPass,
      },
    },
  });

  /** A one-hole round keeps "every hole scored" easy to reason about. */
  function oneHoleSnapshot(putts: Record<PlayerID, Record<number, number>>) {
    return makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1],
      scores: scoresFrom({ [jackID]: [4], [jillID]: [4], [bobID]: [4] }),
      putts,
    });
  }

  it('sticks the last three-putter with the bill', () => {
    const snap = oneHoleSnapshot({ [jillID]: { 1: 3 } });
    const result = evaluateBet(bet(false), snap);
    // Jill pays $2 to each of the other two.
    expect(result.settled[jillID]).toBe(dollars(-4));
    expect(result.settled[jackID]).toBe(dollars(2));
    expect(result.settled[bobID]).toBe(dollars(2));
    expect(totalCents(result.settled)).toBe(0);
  });

  it('passes the snake to whoever three-putted most recently', () => {
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1, 2],
      scores: scoresFrom({ [jackID]: [4, 4], [jillID]: [4, 4], [bobID]: [4, 4] }),
      putts: { [jillID]: { 1: 3 }, [bobID]: { 2: 3 } },
    });
    const result = evaluateBet(bet(false), snap);
    // Bob picked it up on 2 and never handed it on.
    expect(result.settled[bobID]).toBe(dollars(-4));
    expect(result.settled[jillID]).toBe(dollars(2));
  });

  it('grows the pot on every pass when configured', () => {
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1, 2],
      scores: scoresFrom({ [jackID]: [4, 4], [jillID]: [4, 4], [bobID]: [4, 4] }),
      putts: { [jillID]: { 1: 3 }, [bobID]: { 2: 3 } },
    });
    const result = evaluateBet(bet(true), snap);
    // Two passes → $4 a head, so Bob is out $8.
    expect(result.settled[bobID]).toBe(dollars(-8));
  });

  it('cannot move on a hole with no putts recorded', () => {
    const snap = oneHoleSnapshot({});
    const result = evaluateBet(bet(false), snap);
    expect(Object.keys(result.settled).length).toBe(0);
    expect(result.headline).toBe('No three-putts yet');
  });

  it('only projects while the round is still open', () => {
    // Hole 2 unscored, so the snake could still be passed on.
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1, 2],
      scores: scoresFrom({ [jackID]: [4, _], [jillID]: [4, _], [bobID]: [4, _] }),
      putts: { [jillID]: { 1: 3 } },
    });
    const result = evaluateBet(bet(false), snap);
    expect(Object.keys(result.settled).length).toBe(0);
    expect(result.projected[jillID]).toBe(dollars(-4));
  });
});

describe('Vegas', () => {
  const bet: Bet = {
    id: 'VEGAS-1',
    name: 'Vegas',
    kind: {
      type: 'vegas',
      config: {
        sideA: [jackID, jillID],
        sideB: [bobID, sueID],
        stakePerPoint: dollars(1),
        handicapMode: 'gross',
        allowance: 'offLow',
        flipOnBirdie: true,
      },
    },
  };

  it('builds numbers low digit first', () => {
    expect(vegasNumber([4, 6], false)).toBe(46);
    expect(vegasNumber([6, 4], false)).toBe(46);
    // A flip reverses it.
    expect(vegasNumber([4, 6], true)).toBe(64);
    // Double figures append rather than becoming a digit.
    expect(vegasNumber([4, 10], false)).toBe(410);
  });

  it('pays the difference between the two numbers', () => {
    // Hole 1 (par 4): A makes 4 and 5 → 45. B makes 5 and 6 → 56.
    // Nobody birdied, so no flip. Swing = 56 − 45 = 11 points to side A.
    const snap = snapshot({
      players: four(),
      scores: {
        [jackID]: [4],
        [jillID]: [5],
        [bobID]: [5],
        [sueID]: [6],
      },
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(11));
    expect(result.settled[jillID]).toBe(dollars(11));
    expect(result.settled[bobID]).toBe(dollars(-11));
    expect(totalCents(result.settled)).toBe(0);
  });

  it('flips the opponent number on a birdie', () => {
    // Hole 1 (par 4): A makes 3 and 4 → 34, and the 3 is a birdie, so B's
    // 5 and 6 flip from 56 to 65. Swing = 65 − 34 = 31 to side A.
    const snap = snapshot({
      players: four(),
      scores: {
        [jackID]: [3],
        [jillID]: [4],
        [bobID]: [5],
        [sueID]: [6],
      },
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(31));
    expect(result.settled[sueID]).toBe(dollars(-31));
  });
});

describe('Nine Point', () => {
  const bet: Bet = {
    id: 'NINE-1',
    name: 'Nine Point',
    kind: {
      type: 'ninePoint',
      config: {
        players: [jackID, jillID, bobID],
        pointValue: dollars(1),
        handicapMode: 'gross',
      },
    },
  };

  it('splits 5/3/1 and settles pairwise', () => {
    // One hole: Jack 3, Jill 4, Bob 5 → 5/3/1.
    // Pairwise at $1: Jack +2 vs Jill, +4 vs Bob; Jill +2 vs Bob.
    // Jack +6, Jill 0, Bob −6.
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1],
      scores: scoresFrom({ [jackID]: [3], [jillID]: [4], [bobID]: [5] }),
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(6));
    expect(result.settled[jillID]).toBe(dollars(0));
    expect(result.settled[bobID]).toBe(dollars(-6));
    expect(totalCents(result.settled)).toBe(0);
  });

  it('pools and splits a tie for the lead', () => {
    // Jack and Jill tie at 4, Bob makes 5: the 5 and 3 pool into 4 each.
    // Jack and Jill are level; each is 3 points up on Bob.
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1],
      scores: scoresFrom({ [jackID]: [4], [jillID]: [4], [bobID]: [5] }),
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(3));
    expect(result.settled[jillID]).toBe(dollars(3));
    expect(result.settled[bobID]).toBe(dollars(-6));
  });

  it('moves no money when all three tie', () => {
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1],
      scores: scoresFrom({ [jackID]: [4], [jillID]: [4], [bobID]: [4] }),
    });
    const result = evaluateBet(bet, snap);
    expect(Object.values(result.settled).every((v) => v === 0)).toBe(true);
  });
});

describe('Split Sixes', () => {
  const bet: Bet = {
    id: 'SPLIT-1',
    name: 'Split Sixes',
    kind: {
      type: 'splitSixes',
      config: {
        players: [jackID, jillID, bobID],
        pointValue: dollars(1),
        handicapMode: 'gross',
      },
    },
  };

  it('splits 4/2/0 and settles pairwise', () => {
    // Jack 3, Jill 4, Bob 5 → 4/2/0.
    // Jack +2 vs Jill, +4 vs Bob; Jill +2 vs Bob → Jack +6, Jill 0, Bob −6.
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1],
      scores: scoresFrom({ [jackID]: [3], [jillID]: [4], [bobID]: [5] }),
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(6));
    expect(result.settled[bobID]).toBe(dollars(-6));
  });

  it('splits the bottom two positions on a tie for last', () => {
    // Jack 3 takes 4; Jill and Bob tie at 5 and pool 2+0 into 1 each.
    const snap = makeSnapshot({
      course: course18(),
      players: three(),
      holeNumbers: [1],
      scores: scoresFrom({ [jackID]: [3], [jillID]: [5], [bobID]: [5] }),
    });
    const result = evaluateBet(bet, snap);
    // Jack is 3 up on each of them; they are level with each other.
    expect(result.settled[jackID]).toBe(dollars(6));
    expect(result.settled[jillID]).toBe(dollars(-3));
    expect(result.settled[bobID]).toBe(dollars(-3));
  });
});

describe('Sixes', () => {
  const bet: Bet = {
    id: 'SIXES-1',
    name: 'Sixes',
    kind: {
      type: 'sixes',
      config: {
        players: [jackID, jillID, bobID, sueID],
        stakePerPlayer: dollars(5),
        handicapMode: 'gross',
        allowance: 'offLow',
      },
    },
  };

  it('rotates partners every six holes', () => {
    if (bet.kind.type !== 'sixes') throw new Error('bad fixture');
    // Jack alone breaks par everywhere, so his partner wins every segment:
    // Jill for 1–6, Bob for 7–12, Sue for 13–18. Each segment pays $5 a man,
    // so Jack collects three times and each other player wins once and loses
    // twice: Jack +15, everyone else −5.
    const jackCard: Card = pars.map((p) => p - 1);
    const flat: Card = pars.map((p) => p + 1);
    const snap = snapshot({
      players: four(),
      scores: {
        [jackID]: jackCard,
        [jillID]: flat,
        [bobID]: flat,
        [sueID]: flat,
      },
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(15));
    expect(result.settled[jillID]).toBe(dollars(-5));
    expect(result.settled[bobID]).toBe(dollars(-5));
    expect(result.settled[sueID]).toBe(dollars(-5));
    expect(totalCents(result.settled)).toBe(0);

    if (result.detail.type !== 'segments') throw new Error('expected segments');
    const segments = result.detail.value.segments;
    expect(segments.length).toBe(3);
    expect(segments[0]!.sideA).toEqual([jackID, jillID]);
    expect(segments[1]!.sideA).toEqual([jackID, bobID]);
    expect(segments[2]!.sideA).toEqual([jackID, sueID]);
  });

  it('refuses to guess a rotation for the wrong player count', () => {
    const threeHanded: Bet = {
      id: 'SIXES-2',
      name: 'Sixes',
      kind: {
        type: 'sixes',
        config: {
          players: [jackID, jillID, bobID],
          stakePerPlayer: dollars(5),
          handicapMode: 'gross',
          allowance: 'offLow',
        },
      },
    };
    const result = evaluateBet(threeHanded, snapshot({ players: three() }));
    expect(result.headline).toBe('Needs exactly four players');
    expect(Object.keys(result.settled).length).toBe(0);
  });
});

describe('Scotch', () => {
  const bet = (doubleOnSweep: boolean): Bet => ({
    id: 'SCOTCH-1',
    name: 'Scotch',
    kind: {
      type: 'scotch',
      config: {
        sideA: [jackID, jillID],
        sideB: [bobID, sueID],
        pointValue: dollars(2),
        handicapMode: 'gross',
        allowance: 'offLow',
        doubleOnSweep,
      },
    },
  });

  it('awards low ball and low total separately', () => {
    // Hole 1 (par 4): A 4 and 6 (low ball 4, total 10);
    //                 B 5 and 5 (low ball 5, total 10).
    // A takes low ball; low total is halved; no birdies. Net +1 to A.
    const snap = makeSnapshot({
      course: course18(),
      players: four(),
      holeNumbers: [1],
      scores: scoresFrom({
        [jackID]: [4],
        [jillID]: [6],
        [bobID]: [5],
        [sueID]: [5],
      }),
    });
    const result = evaluateBet(bet(false), snap);
    // One point at $2 a point, paid per man: each loser pays $2.
    expect(result.settled[jackID]).toBe(dollars(2));
    expect(result.settled[bobID]).toBe(dollars(-2));
    expect(totalCents(result.settled)).toBe(0);
  });

  it('doubles an umbrella when configured', () => {
    // A makes 3 and 4 → low ball, low total, and a birdie: all three
    // categories, so the hole doubles from 3 points to 6.
    const snap = makeSnapshot({
      course: course18(),
      players: four(),
      holeNumbers: [1],
      scores: scoresFrom({
        [jackID]: [3],
        [jillID]: [4],
        [bobID]: [5],
        [sueID]: [5],
      }),
    });
    const swept = evaluateBet(bet(true), snap);
    expect(swept.settled[jackID]).toBe(dollars(12)); // 6 points × $2
    const plain = evaluateBet(bet(false), snap);
    expect(plain.settled[jackID]).toBe(dollars(6)); // 3 points × $2
  });
});

describe('Junk', () => {
  const bet: Bet = {
    id: 'JUNK-1',
    name: 'Junk',
    kind: {
      type: 'junk',
      config: {
        players: [jackID, jillID, bobID],
        stakePerItem: dollars(1),
        enabled: ['greenie', 'sandy'],
      },
    },
  };

  const withClaims = (claims: JunkClaim[]) =>
    snapshot({
      players: three(),
      scores: { [jackID]: [4], [jillID]: [4], [bobID]: [4] },
      events: { presses: [], wolfDecisions: [], junkClaims: claims },
    });

  it('pays a claim by every other player', () => {
    const snap = withClaims([
      { betID: 'JUNK-1', hole: 1, kind: 'greenie', player: jackID },
    ]);
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(2));
    expect(result.settled[jillID]).toBe(dollars(-1));
    expect(result.settled[bobID]).toBe(dollars(-1));
    expect(totalCents(result.settled)).toBe(0);
  });

  it('ignores claims for kinds the group is not playing', () => {
    const snap = withClaims([
      { betID: 'JUNK-1', hole: 1, kind: 'barkie', player: jackID },
    ]);
    const result = evaluateBet(bet, snap);
    expect(Object.keys(result.settled).length).toBe(0);
  });

  it('ignores claims belonging to another bet', () => {
    const snap = withClaims([
      { betID: 'SOMETHING-ELSE', hole: 1, kind: 'greenie', player: jackID },
    ]);
    const result = evaluateBet(bet, snap);
    expect(Object.keys(result.settled).length).toBe(0);
  });
});

describe('Quota', () => {
  const bet: Bet = {
    id: 'QUOTA-1',
    name: 'Quota',
    kind: {
      type: 'quota',
      config: {
        players: [jackID, jillID],
        pointValue: dollars(1),
        quotaBase: 36,
      },
    },
  };

  it('scores Stableford points against a handicap target', () => {
    // Jack is scratch → quota 36. Jill is an 18 → quota 18.
    // Both par every hole: 2 points a hole × 18 = 36 points each.
    // Jack finishes exactly on quota (0); Jill is 18 over.
    // Jill is 18 points up on Jack → $18.
    const snap = snapshot({
      players: [jack(0), jill(18)],
      scores: { [jackID]: [...pars], [jillID]: [...pars] },
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jillID]).toBe(dollars(18));
    expect(result.settled[jackID]).toBe(dollars(-18));
    expect(totalCents(result.settled)).toBe(0);
  });

  it('rewards birdies at four points and gives nothing for a double', () => {
    // One hole, par 4. Jack birdies (4 points), Jill doubles (0).
    // Quotas are both 36 − 0, so both finish far under; what matters is the
    // 4-point gap between them.
    const snap = makeSnapshot({
      course: course18(),
      players: [jack(0), jill(0)],
      holeNumbers: [1],
      scores: scoresFrom({ [jackID]: [3], [jillID]: [6] }),
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(4));
    expect(result.settled[jillID]).toBe(dollars(-4));
  });
});
