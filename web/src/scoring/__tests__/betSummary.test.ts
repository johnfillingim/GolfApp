import { describe, expect, it } from 'vitest';
import { describeBet } from '../betSummary';
import { dollars } from '../money';
import type { Bet } from '../types';
import { bob, jack, jackID, jill, jillID, sue } from './fixtures';

const players = [jack(), jill(), bob(), sue()];
const ids = players.map((p) => p.id);

describe('BetSummary', () => {
  it('describes a Nassau', () => {
    const bet: Bet = {
      id: 'SUM-N',
      name: 'Nassau',
      kind: {
        type: 'nassau',
        config: {
          sideA: [jackID],
          sideB: [jillID],
          stakePerPlayer: dollars(5),
          handicapMode: 'net',
          allowance: 'offLow',
          autoPressTrigger: 2,
        },
      },
    };
    const text = describeBet(bet, players);
    expect(text, text).toContain('$5.00 Nassau');
    expect(text, text).toContain('Jack Palmer vs Jill Hogan');
    expect(text, text).toContain('Auto-press when a side goes 2 down');
    expect(text, text).toContain('off the low ball');
  });

  it('describes skins', () => {
    const bet: Bet = {
      id: 'SUM-S',
      name: 'Skins',
      kind: {
        type: 'skins',
        config: {
          players: ids,
          stakePerHole: dollars(2),
          handicapMode: 'gross',
          carryover: true,
          requireValidation: true,
        },
      },
    };
    const text = describeBet(bet, players);
    expect(text, text).toContain('$2.00 skins');
    expect(text, text).toContain('Ties carry over');
    expect(text, text).toContain('par or better');
  });

  it('describes wolf', () => {
    const bet: Bet = {
      id: 'SUM-W',
      name: 'Wolf',
      kind: {
        type: 'wolf',
        config: {
          rotation: ids,
          stakePerHole: dollars(1),
          handicapMode: 'net',
          loneMultiplier: 2,
          blindMultiplier: 3,
          carryTies: false,
        },
      },
    };
    const text = describeBet(bet, players);
    expect(text, text).toContain('Lone wolf 2×');
    expect(text, text).toContain('blind wolf 3×');
    expect(text, text).toContain('push');
  });

  it('describes stroke play', () => {
    const bet: Bet = {
      id: 'SUM-P',
      name: 'Medal',
      kind: {
        type: 'strokePlay',
        config: { players: ids, ante: dollars(10), handicapMode: 'net' },
      },
    };
    const text = describeBet(bet, players);
    expect(text, text).toContain('$40.00 pot');
    expect(text, text).toContain('ties split');
  });
});
