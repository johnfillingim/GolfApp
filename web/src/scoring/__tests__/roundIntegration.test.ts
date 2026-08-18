import { describe, expect, it } from 'vitest';
import { evaluateAll } from '../evaluator';
import { dollars, totalCents } from '../money';
import { minimalTransfers, netBalances } from '../settlement';
import type { Bet, PlayerID } from '../types';
import { _, bob, bobID, jack, jackID, jill, jillID, snapshot, sue, sueID, type Card } from './fixtures';

/**
 * End-to-end: several bets on one round, consolidated into a single
 * who-pays-whom settlement.
 */
describe('Round integration', () => {
  it('settles a multi-bet round to minimal transfers', () => {
    const players = [jack(), jill()];
    // Cards from the Nassau worked example: front to Jill, back and total to
    // Jack, one auto-press each way → Jack +$10 on the Nassau.
    const jackCard: Card = [5, 5, 3, 5, 4, 4, 4, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4];
    const jillCard: Card = [4, 4, 3, 4, 5, 4, 4, 5, 4, 5, 4, 5, 5, 4, 5, 3, 4, 4];

    const nassau: Bet = {
      id: 'INT-NASSAU',
      name: 'Nassau',
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
    const skins: Bet = {
      id: 'INT-SKINS',
      name: 'Skins',
      kind: {
        type: 'skins',
        config: {
          players: [jackID, jillID],
          stakePerHole: dollars(2),
          handicapMode: 'gross',
          carryover: false,
          requireValidation: false,
        },
      },
    };

    const snap = snapshot({
      players,
      scores: { [jackID]: jackCard, [jillID]: jillCard },
    });

    const evaluations = evaluateAll([nassau, skins], snap);

    // Skins (no carryover): Jill wins holes 1, 2, 4 ($2 each = $6); Jack wins
    // holes 5, 10, 11, 13 ($8). Net skins: Jack +$2.
    expect(evaluations[1]!.settled[jackID]).toBe(dollars(2));

    const net = netBalances(evaluations.map((e) => e.settled));
    expect(net[jackID]).toBe(dollars(12));
    expect(net[jillID]).toBe(dollars(-12));

    const transfers = minimalTransfers(
      net,
      players.map((p) => p.id),
    );
    expect(transfers).toEqual([{ from: jillID, to: jackID, amount: dollars(12) }]);
  });

  it('keeps every engine zero-sum under chaos', () => {
    // Withdrawals, missing scores, and mid-round state all at once.
    const players = [jack(2), jill(9), bob(14), sue(21)];
    const bets: Bet[] = [
      {
        id: 'CHAOS-N',
        name: 'N',
        kind: {
          type: 'nassau',
          config: {
            sideA: [jackID, bobID],
            sideB: [jillID, sueID],
            stakePerPlayer: dollars(5),
            handicapMode: 'net',
            allowance: 'offLow',
            autoPressTrigger: 2,
          },
        },
      },
      {
        id: 'CHAOS-S',
        name: 'S',
        kind: {
          type: 'skins',
          config: {
            players: players.map((p) => p.id),
            stakePerHole: dollars(1),
            handicapMode: 'net',
            carryover: true,
            requireValidation: false,
          },
        },
      },
      {
        id: 'CHAOS-M',
        name: 'M',
        kind: {
          type: 'matchPlay',
          config: {
            sideA: [jackID],
            sideB: [bobID],
            stakePerPlayer: dollars(10),
            handicapMode: 'net',
            allowance: 'offLow',
          },
        },
      },
      {
        id: 'CHAOS-P',
        name: 'P',
        kind: {
          type: 'strokePlay',
          config: {
            players: players.map((p) => p.id),
            ante: dollars(5),
            handicapMode: 'net',
          },
        },
      },
    ];

    // Scores with gaps; Sue withdraws after hole 6.
    const cards: Card[] = [
      [4, 5, 3, 4, 5, 4, 3, 6, 4, 4, 3, _, 4, 5, 5, 3, 4, 4],
      [5, 6, 4, 5, 5, 5, 4, 6, 5, 5, _, 6, 5, 5, 6, 4, 5, 5],
      [6, 6, 4, 5, 6, 5, 4, 7, 5, 5, 4, 6, 5, 6, 6, 4, 5, 6],
      [6, 7, 5, 6, 6, 6, _, _, _, _, _, _, _, _, _, _, _, _],
    ];
    const scores: Record<PlayerID, Card> = {};
    players.forEach((player, index) => {
      scores[player.id] = cards[index]!;
    });

    const snap = snapshot({
      players,
      scores,
      withdrawals: { [sueID]: 6 },
    });

    for (const evaluation of evaluateAll(bets, snap)) {
      expect(totalCents(evaluation.settled), `${evaluation.kindName} settled leaks money`).toBe(0);
      expect(
        totalCents(evaluation.projected),
        `${evaluation.kindName} projected leaks money`,
      ).toBe(0);
    }
  });
});
