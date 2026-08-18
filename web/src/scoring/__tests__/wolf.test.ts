import { describe, expect, it } from 'vitest';
import type { BetEvaluation, WolfEvaluation } from '../evaluation';
import { evaluateBet } from '../evaluator';
import { dollars, totalCents } from '../money';
import type { RoundEvents } from '../snapshot';
import type { Bet, PlayerID, ScoringPlayer, WolfDecision } from '../types';
import { bob, bobID, jack, jackID, jill, jillID, snapshot, sue, sueID } from './fixtures';

const BET_ID = 'CCCCCCCC-0000-0000-0000-000000000001';
const rotation: PlayerID[] = [jackID, jillID, bobID, sueID];

function makeBet(carryTies = false): Bet {
  return {
    id: BET_ID,
    name: 'Wolf',
    kind: {
      type: 'wolf',
      config: {
        rotation,
        stakePerHole: dollars(1),
        handicapMode: 'gross',
        loneMultiplier: 2,
        blindMultiplier: 3,
        carryTies,
      },
    },
  };
}

const players = (): ScoringPlayer[] => [jack(), jill(), bob(), sue()];

const withDecisions = (decisions: WolfDecision[]): RoundEvents => ({
  presses: [],
  wolfDecisions: decisions,
  junkClaims: [],
});

function wolfDetail(evaluation: BetEvaluation): WolfEvaluation {
  if (evaluation.detail.type !== 'wolf') throw new Error('expected wolf detail');
  return evaluation.detail.value;
}

describe('Wolf', () => {
  it('pays the worked example', () => {
    // H1 Jack (wolf) takes Sue as partner and they win     → ±$1 pairwise
    // H2 Jill goes lone and wins                           → +$6 at 2×
    // H3 Bob goes lone and loses                           → −$6 at 2×
    // H4 Sue goes blind and the hole halves                → push
    // H5 Jack is wolf again (rotation wraps) — undeclared  → pending
    const bet = makeBet();
    const events = withDecisions([
      { betID: BET_ID, hole: 1, wolf: jackID, choice: { type: 'partner', partner: sueID } },
      { betID: BET_ID, hole: 2, wolf: jillID, choice: { type: 'lone' } },
      { betID: BET_ID, hole: 3, wolf: bobID, choice: { type: 'lone' } },
      { betID: BET_ID, hole: 4, wolf: sueID, choice: { type: 'blindLone' } },
    ]);
    const snap = snapshot({
      players: players(),
      scores: {
        [jackID]: [4, 4, 4, 4],
        [jillID]: [5, 3, 4, 4],
        [bobID]: [5, 4, 5, 4],
        [sueID]: [5, 4, 4, 4],
      },
      events,
    });
    const result = evaluateBet(bet, snap);
    const detail = wolfDetail(result);

    expect(detail.holes[0]!.outcome).toEqual({ type: 'wolfTeamWon', multiplier: 1, units: 1 });
    expect(detail.holes[1]!.outcome).toEqual({ type: 'wolfTeamWon', multiplier: 2, units: 1 });
    expect(detail.holes[2]!.outcome).toEqual({ type: 'othersWon', multiplier: 2, units: 1 });
    expect(detail.holes[3]!.outcome).toEqual({ type: 'halved', carried: false });
    expect(detail.holes[4]!.outcome).toEqual({ type: 'pending' });
    expect(detail.holes[4]!.wolf, 'rotation wraps at hole 5').toBe(jackID);

    // Hand-computed balances:
    // Jack: +2 (h1) −2 (h2) +2 (h3)          = +2
    // Jill: −2 (h1) +6 (h2) +2 (h3)          = +6
    // Bob:  −2 (h1) −2 (h2) −6 (h3)          = −10
    // Sue:  +2 (h1) −2 (h2) +2 (h3)          = +2
    expect(result.settled[jackID]).toBe(dollars(2));
    expect(result.settled[jillID]).toBe(dollars(6));
    expect(result.settled[bobID]).toBe(dollars(-10));
    expect(result.settled[sueID]).toBe(dollars(2));
    expect(totalCents(result.settled)).toBe(0);

    // The lone-wolf win is celebration-worthy; the loss is not.
    const wolfEvents = result.events.filter((e) => e.kind.type === 'wolfWon');
    expect(wolfEvents.length).toBe(1);
    expect(wolfEvents[0]!.players).toEqual([jillID]);
    expect(wolfEvents[0]!.amount).toBe(dollars(6));
  });

  it('triples the stake for a blind wolf', () => {
    const bet = makeBet();
    const events = withDecisions([
      { betID: BET_ID, hole: 1, wolf: jackID, choice: { type: 'blindLone' } },
    ]);
    const snap = snapshot({
      players: players(),
      scores: {
        [jackID]: [3],
        [jillID]: [4],
        [bobID]: [4],
        [sueID]: [4],
      },
      events,
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jackID]).toBe(dollars(9));
    expect(result.settled[jillID]).toBe(dollars(-3));
  });

  it('doubles the next hole after a carried tie', () => {
    const bet = makeBet(true);
    const events = withDecisions([
      { betID: BET_ID, hole: 1, wolf: jackID, choice: { type: 'partner', partner: sueID } },
      { betID: BET_ID, hole: 2, wolf: jillID, choice: { type: 'lone' } },
    ]);
    const snap = snapshot({
      players: players(),
      scores: {
        [jackID]: [4, 4],
        [jillID]: [4, 3],
        [bobID]: [4, 4],
        [sueID]: [4, 4],
      },
      events,
    });
    const result = evaluateBet(bet, snap);
    const detail = wolfDetail(result);
    expect(detail.holes[0]!.outcome).toEqual({ type: 'halved', carried: true });
    // Two units at 2× lone: Jill collects $4 from each of three players.
    expect(detail.holes[1]!.outcome).toEqual({ type: 'wolfTeamWon', multiplier: 2, units: 2 });
    expect(result.settled[jillID]).toBe(dollars(12));
    expect(result.settled[jackID]).toBe(dollars(-4));
  });

  it('voids a withdrawn wolf hole and rides the carry through', () => {
    const bet = makeBet(true);
    const events = withDecisions([
      { betID: BET_ID, hole: 1, wolf: jackID, choice: { type: 'partner', partner: sueID } },
      { betID: BET_ID, hole: 3, wolf: bobID, choice: { type: 'lone' } },
    ]);
    const snap = snapshot({
      players: players(),
      scores: {
        [jackID]: [4, 4, 5],
        [jillID]: [4],
        [bobID]: [4, 4, 4],
        [sueID]: [4, 4, 5],
      },
      withdrawals: { [jillID]: 1 },
      events,
    });
    const result = evaluateBet(bet, snap);
    const detail = wolfDetail(result);
    expect(detail.holes[0]!.outcome).toEqual({ type: 'halved', carried: true });
    expect(detail.holes[1]!.outcome, "hole 2's wolf (Jill) has withdrawn").toEqual({
      type: 'void',
    });
    // Bob's lone win on hole 3 carries the units from hole 1: 2 units × 2× × $1
    // from Jack and Sue (Jill is out).
    expect(detail.holes[2]!.outcome).toEqual({ type: 'wolfTeamWon', multiplier: 2, units: 2 });
    expect(result.settled[bobID]).toBe(dollars(8));
    expect(result.settled[jackID]).toBe(dollars(-4));
    expect(result.settled[sueID]).toBe(dollars(-4));
  });

  it('treats an invalid partner pick as undeclared', () => {
    const bet = makeBet();
    const events = withDecisions([
      { betID: BET_ID, hole: 1, wolf: jackID, choice: { type: 'partner', partner: jackID } },
    ]);
    const snap = snapshot({
      players: players(),
      scores: {
        [jackID]: [3],
        [jillID]: [4],
        [bobID]: [4],
        [sueID]: [4],
      },
      events,
    });
    const result = evaluateBet(bet, snap);
    const detail = wolfDetail(result);
    expect(detail.holes[0]!.outcome).toEqual({ type: 'pending' });
    expect(Object.values(result.settled).every((v) => v === 0)).toBe(true);
  });
});
