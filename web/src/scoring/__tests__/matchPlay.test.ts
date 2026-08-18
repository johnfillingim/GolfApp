import { describe, expect, it } from 'vitest';
import { evaluateBet } from '../evaluator';
import { dollars } from '../money';
import type { Bet } from '../types';
import { bob, bobID, jack, jackID, jill, jillID, snapshot, sue, sueID, type Card } from './fixtures';

const BET_ID = 'DDDDDDDD-0000-0000-0000-000000000001';

const repeat = (value: number, count: number): Card =>
  Array.from({ length: count }, () => value);

describe('Match play', () => {
  it('pays a team closeout per man', () => {
    // Jack & Jill vs Bob & Sue, $10 per man, gross best ball.
    // Side A's best ball (Jack's 3) beats side B's 4 on ten straight holes:
    // 10 up with 8 to play → closed 10&8.
    const bet: Bet = {
      id: BET_ID,
      name: 'The Grudge',
      kind: {
        type: 'matchPlay',
        config: {
          sideA: [jackID, jillID],
          sideB: [bobID, sueID],
          stakePerPlayer: dollars(10),
          handicapMode: 'gross',
          allowance: 'offLow',
        },
      },
    };
    const snap = snapshot({
      players: [jack(), jill(), bob(), sue()],
      scores: {
        [jackID]: repeat(3, 10),
        [jillID]: repeat(5, 10),
        [bobID]: repeat(4, 10),
        [sueID]: repeat(4, 10),
      },
    });
    const result = evaluateBet(bet, snap);
    if (result.detail.type !== 'matchPlay') throw new Error('expected match play detail');
    const detail = result.detail.value;

    expect(detail.match.status.closed).toBe(true);
    expect(detail.match.status.display).toBe('10&8');
    // Per man: each loser pays $10; each winner collects $10.
    expect(result.settled[jackID]).toBe(dollars(10));
    expect(result.settled[jillID]).toBe(dollars(10));
    expect(result.settled[bobID]).toBe(dollars(-10));
    expect(result.settled[sueID]).toBe(dollars(-10));
    expect(
      result.events.some(
        (e) =>
          e.id === `${BET_ID}-closed` &&
          e.kind.type === 'matchClosed' &&
          e.kind.margin === '10&8',
      ),
    ).toBe(true);
  });

  it('projects an open match for the leader', () => {
    const bet: Bet = {
      id: 'EEEEEEEE-0000-0000-0000-000000000001',
      name: 'Singles',
      kind: {
        type: 'matchPlay',
        config: {
          sideA: [jackID],
          sideB: [jillID],
          stakePerPlayer: dollars(10),
          handicapMode: 'gross',
          allowance: 'offLow',
        },
      },
    };
    const snap = snapshot({
      players: [jack(), jill()],
      scores: { [jackID]: [4, 4, 4], [jillID]: [5, 5, 5] },
    });
    const result = evaluateBet(bet, snap);
    expect(Object.keys(result.settled).length).toBe(0);
    expect(result.projected[jackID]).toBe(dollars(10));
    expect(result.projected[jillID]).toBe(dollars(-10));
    expect(result.headline).toContain('3 UP thru 3');
  });

  it('moves no money on a halved match', () => {
    const bet: Bet = {
      id: 'FFFFFFFF-0000-0000-0000-000000000001',
      name: 'Singles',
      kind: {
        type: 'matchPlay',
        config: {
          sideA: [jackID],
          sideB: [jillID],
          stakePerPlayer: dollars(10),
          handicapMode: 'gross',
          allowance: 'offLow',
        },
      },
    };
    const card = repeat(4, 18);
    const snap = snapshot({
      players: [jack(), jill()],
      scores: { [jackID]: card, [jillID]: card },
    });
    const result = evaluateBet(bet, snap);
    expect(Object.keys(result.settled).length).toBe(0);
    expect(Object.keys(result.projected).length).toBe(0);
    expect(result.headline).toBe('Halved');
  });
});
