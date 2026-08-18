import { describe, expect, it } from 'vitest';
import type { BetEvaluation, NassauEvaluation } from '../evaluation';
import { nassauPressCount } from '../evaluation';
import { evaluateBet } from '../evaluator';
import { dollars, totalCents } from '../money';
import { makeSnapshot, type RoundEvents } from '../snapshot';
import type { Bet } from '../types';
import {
  course9,
  jack,
  jackID,
  jill,
  jillID,
  scoresFrom,
  snapshot,
  type Card,
} from './fixtures';

/**
 * The full worked Nassau example. Jack vs Jill, $5 per man, gross, auto-press
 * at 2 down.
 *
 * Hole-by-hole winners from Jack's perspective (W win / L loss / H halve):
 *
 *   Front:  L L H L W H H H H   → Jill wins 2&1 (closes at hole 8)
 *   Back:   W W H W H H H H H   → Jack wins 3&2 (closes at hole 16)
 *   Total:  net +1 for Jack     → Jack wins 1 UP on 18
 *
 * Press timeline the engine must derive:
 *   • Front, auto: Jack falls 2 down at hole 2 → press from hole 3. That press
 *     runs H L W H H H H → halved (no money). Jack later falls 3 down on the
 *     *original* (hole 4) — no new press, because auto-press watches the most
 *     recent bet, which is the hole-3 press.
 *   • Back, auto: Jill falls 2 down at hole 11 → press from hole 12. It ends
 *     +1 Jack → Jack wins $5.
 *   • Back, manual: Jill presses again from hole 16 (event) → halved.
 *
 * Money: Jack −5 (front) +5 (back) +5 (back press) +5 (total) = **+$10**.
 */

const jackCard: Card = [5, 5, 3, 5, 4, 4, 4, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4];
const jillCard: Card = [4, 4, 3, 4, 5, 4, 4, 5, 4, 5, 4, 5, 5, 4, 5, 3, 4, 4];

const BET_ID = 'AAAAAAAA-0000-0000-0000-000000000001';

function makeBet(): Bet {
  return {
    id: BET_ID,
    name: 'The Usual',
    kind: {
      type: 'nassau',
      config: {
        sideA: [jackID],
        sideB: [jillID],
        stakePerPlayer: dollars(5),
        handicapMode: 'gross',
        allowance: 'offLow',
        autoPressTrigger: 2,
      },
    },
  };
}

function evaluate(lastHole = 18, manualPress = true): BetEvaluation {
  const bet = makeBet();
  const events: RoundEvents = manualPress
    ? {
        presses: [
          {
            id: 'PRESS-0000-0000-0000-000000000001',
            betID: bet.id,
            segment: 'back',
            firstHole: 16,
            pressedBy: 'b',
          },
        ],
        wolfDecisions: [],
      }
    : { presses: [], wolfDecisions: [] };
  const snap = snapshot({
    players: [jack(), jill()],
    scores: {
      [jackID]: jackCard.slice(0, lastHole),
      [jillID]: jillCard.slice(0, lastHole),
    },
    events,
  });
  return evaluateBet(bet, snap);
}

function nassauDetail(evaluation: BetEvaluation): NassauEvaluation {
  if (evaluation.detail.type !== 'nassau') throw new Error('expected nassau detail');
  return evaluation.detail.value;
}

describe('Nassau', () => {
  it('pays the worked example correctly', () => {
    const result = evaluate();
    expect(result.settled[jackID]).toBe(dollars(10));
    expect(result.settled[jillID]).toBe(dollars(-10));
    // Round over: projection equals settlement.
    expect(result.projected[jackID]).toBe(dollars(10));
    expect(totalCents(result.settled)).toBe(0);
  });

  it('derives the worked example press timeline', () => {
    const detail = nassauDetail(evaluate());
    expect(nassauPressCount(detail)).toBe(3);

    const front = detail.segments.find((s) => s.segment === 'front')!;
    expect(front.bets.length).toBe(2);
    expect(front.bets[0]!.match.status.display).toBe('2&1');
    expect(front.bets[0]!.match.status.winner).toBe('b');
    expect(front.bets[1]!.firstHole).toBe(3);
    expect(front.bets[1]!.isAutoPress).toBe(true);
    expect(front.bets[1]!.match.status.display).toBe('Halved');

    const back = detail.segments.find((s) => s.segment === 'back')!;
    expect(back.bets.length).toBe(3);
    expect(back.bets[0]!.match.status.display).toBe('3&2');
    expect(back.bets[0]!.match.status.winner).toBe('a');
    expect(back.bets[1]!.firstHole).toBe(12);
    expect(back.bets[1]!.isAutoPress).toBe(true);
    expect(back.bets[1]!.match.status.display).toBe('1 UP');
    expect(back.bets[1]!.match.status.winner).toBe('a');
    expect(back.bets[2]!.firstHole).toBe(16);
    expect(back.bets[2]!.isPress).toBe(true);
    expect(back.bets[2]!.isAutoPress).toBe(false);
    expect(back.bets[2]!.match.status.display).toBe('Halved');

    const total = detail.segments.find((s) => s.segment === 'total')!;
    expect(total.bets.length, 'no auto-press on the overall 18').toBe(1);
    expect(total.bets[0]!.match.status.display).toBe('1 UP');
    expect(total.bets[0]!.match.status.winner).toBe('a');
  });

  it('emits stably-identified press and segment events', () => {
    const result = evaluate();

    const pressEvents = result.events.filter((e) => e.kind.type === 'pressStarted');
    expect(pressEvents.length).toBe(3);
    expect(
      result.events.some(
        (e) =>
          e.id === `${BET_ID}-press-front-3` &&
          e.kind.type === 'pressStarted' &&
          e.kind.auto,
      ),
    ).toBe(true);
    expect(
      result.events.some(
        (e) =>
          e.id === `${BET_ID}-press-back-12` &&
          e.kind.type === 'pressStarted' &&
          e.kind.auto,
      ),
    ).toBe(true);
    expect(
      result.events.some(
        (e) =>
          e.id === `${BET_ID}-press-back-16` &&
          e.kind.type === 'pressStarted' &&
          !e.kind.auto,
      ),
    ).toBe(true);

    // All three segments decided, with the right winners.
    expect(
      result.events.some(
        (e) => e.id === `${BET_ID}-front-final` && e.players.join() === jillID,
      ),
    ).toBe(true);
    expect(
      result.events.some(
        (e) => e.id === `${BET_ID}-back-final` && e.players.join() === jackID,
      ),
    ).toBe(true);
    expect(
      result.events.some(
        (e) => e.id === `${BET_ID}-total-final` && e.players.join() === jackID,
      ),
    ).toBe(true);
  });

  it('projects mid-round without settling anything', () => {
    // Through 6 holes: Jill leads the front 2 up and the total 2 up; the front
    // press is all square. Nothing is settled yet; projection has Jill +$10.
    const result = evaluate(6, false);
    expect(Object.keys(result.settled).length).toBe(0);
    expect(result.projected[jillID]).toBe(dollars(10));
    expect(result.projected[jackID]).toBe(dollars(-10));
  });

  it('collapses a nine-hole round to a single match', () => {
    const bet: Bet = {
      id: 'BBBBBBBB-0000-0000-0000-000000000001',
      name: 'Nine',
      kind: {
        type: 'nassau',
        config: {
          sideA: [jackID],
          sideB: [jillID],
          stakePerPlayer: dollars(5),
          handicapMode: 'gross',
          allowance: 'offLow',
          autoPressTrigger: 2,
        },
      },
    };
    // Jill wins holes 1–2, everything else halved.
    const snap = makeSnapshot({
      course: course9(),
      players: [jack(), jill()],
      scores: scoresFrom({
        [jackID]: [5, 5, 4, 4, 4, 4, 4, 4, 4],
        [jillID]: [4, 4, 4, 4, 4, 4, 4, 4, 4],
      }),
    });
    const result = evaluateBet(bet, snap);
    const detail = nassauDetail(result);
    // One segment ("Match"), with the auto-press still active on it.
    expect(detail.segments.length).toBe(1);
    expect(detail.segments[0]!.segment).toBe('total');
    expect(detail.segments[0]!.bets.length).toBe(2);
    expect(detail.segments[0]!.bets[1]!.isAutoPress).toBe(true);
    // Original: Jill closes 2&1; press from hole 3 halves. Net Jill +$5.
    expect(result.settled[jillID]).toBe(dollars(5));
    expect(result.settled[jackID]).toBe(dollars(-5));
  });

  it('opens no presses when auto-press is disabled', () => {
    const bet: Bet = {
      id: 'CCCCCCCC-0000-0000-0000-000000000001',
      name: 'No presses',
      kind: {
        type: 'nassau',
        config: {
          sideA: [jackID],
          sideB: [jillID],
          stakePerPlayer: dollars(5),
          handicapMode: 'gross',
          allowance: 'offLow',
          autoPressTrigger: null,
        },
      },
    };
    const snap = snapshot({
      players: [jack(), jill()],
      scores: { [jackID]: jackCard, [jillID]: jillCard },
    });
    const result = evaluateBet(bet, snap);
    expect(nassauPressCount(nassauDetail(result))).toBe(0);
    // Original three bets only: front Jill, back Jack, total Jack → Jack +$5.
    expect(result.settled[jackID]).toBe(dollars(5));
  });
});
