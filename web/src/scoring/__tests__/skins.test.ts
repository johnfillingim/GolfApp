import { describe, expect, it } from 'vitest';
import type { BetEvaluation, SkinsEvaluation } from '../evaluation';
import { evaluateBet } from '../evaluator';
import { dollars } from '../money';
import type { Bet, HandicapMode, PlayerID, ScoringPlayer } from '../types';
import { _, bob, bobID, jack, jackID, jill, jillID, snapshot, sue, sueID } from './fixtures';

const BET_ID = 'BBBBBBBB-0000-0000-0000-000000000001';

function makeBet(options: {
  players: PlayerID[];
  carryover?: boolean;
  validation?: boolean;
  mode?: HandicapMode;
}): Bet {
  return {
    id: BET_ID,
    name: 'Skins',
    kind: {
      type: 'skins',
      config: {
        players: options.players,
        stakePerHole: dollars(2),
        handicapMode: options.mode ?? 'gross',
        carryover: options.carryover ?? true,
        requireValidation: options.validation ?? false,
      },
    },
  };
}

const fourPlayers = (): ScoringPlayer[] => [jack(), jill(), bob(), sue()];

function skinsDetail(evaluation: BetEvaluation): SkinsEvaluation {
  if (evaluation.detail.type !== 'skins') throw new Error('expected skins detail');
  return evaluation.detail.value;
}

describe('Skins', () => {
  it('carries a chain and freezes on a missing score', () => {
    // Hole 1 ties (carry), hole 2 Bob wins two skins, hole 3 is missing Sue's
    // score → the carry chain freezes.
    const bet = makeBet({ players: fourPlayers().map((p) => p.id) });
    const snap = snapshot({
      players: fourPlayers(),
      scores: {
        [jackID]: [4, 4, 4, 3],
        [jillID]: [4, 4, 4, 4],
        [bobID]: [5, 3, 4, 4],
        [sueID]: [5, 4, _, 4],
      },
    });
    const result = evaluateBet(bet, snap);
    const detail = skinsDetail(result);

    expect(detail.outcomes[0]!.outcome).toEqual({ type: 'carried' });
    expect(detail.outcomes[1]!.outcome).toEqual({
      type: 'won',
      winner: bobID,
      units: 2,
      perPlayer: dollars(4),
    });
    expect(detail.outcomes[2]!.outcome).toEqual({ type: 'pending' });
    // Hole 4 has all four scores, but carryover makes it depend on hole 3.
    expect(detail.outcomes[3]!.outcome).toEqual({ type: 'pending' });

    // Bob collects 2 units × $2 from each of three players.
    expect(result.settled[bobID]).toBe(dollars(12));
    expect(result.settled[jackID]).toBe(dollars(-4));
    expect(result.settled[jillID]).toBe(dollars(-4));
    expect(result.settled[sueID]).toBe(dollars(-4));
    expect(detail.skinCounts).toEqual({ [bobID]: 2 });
    expect(
      result.events.some(
        (e) => e.id === `${BET_ID}-skin-2` && e.kind.type === 'skinWon' && e.kind.units === 2,
      ),
    ).toBe(true);
  });

  it('releases the freeze when the missing score posts', () => {
    // Hole 3 ties, so hole 4 is worth two skins to Jack.
    const bet = makeBet({ players: fourPlayers().map((p) => p.id) });
    const snap = snapshot({
      players: fourPlayers(),
      scores: {
        [jackID]: [4, 4, 4, 3],
        [jillID]: [4, 4, 4, 4],
        [bobID]: [5, 3, 4, 4],
        [sueID]: [5, 4, 4, 4],
      },
    });
    const result = evaluateBet(bet, snap);
    const detail = skinsDetail(result);

    expect(detail.outcomes[2]!.outcome).toEqual({ type: 'carried' });
    expect(detail.outcomes[3]!.outcome).toEqual({
      type: 'won',
      winner: jackID,
      units: 2,
      perPlayer: dollars(4),
    });
    expect(result.settled[jackID]).toBe(dollars(8)); // −4 on hole 2, +12 on hole 4
    expect(result.settled[bobID]).toBe(dollars(8)); // +12 on hole 2, −4 on hole 4
    expect(result.settled[jillID]).toBe(dollars(-8));
    expect(result.settled[sueID]).toBe(dollars(-8));
    expect(detail.skinCounts[jackID]).toBe(2);
  });

  it('treats holes independently without carryover', () => {
    const bet = makeBet({ players: fourPlayers().map((p) => p.id), carryover: false });
    const snap = snapshot({
      players: fourPlayers(),
      scores: {
        [jackID]: [4, 4, 4, 3],
        [jillID]: [4, 4, 4, 4],
        [bobID]: [5, 3, 4, 4],
        [sueID]: [5, 4, _, 4],
      },
    });
    const result = evaluateBet(bet, snap);
    const detail = skinsDetail(result);

    expect(detail.outcomes[0]!.outcome, 'tie without carryover kills the skin').toEqual({
      type: 'dead',
    });
    expect(detail.outcomes[1]!.outcome).toEqual({
      type: 'won',
      winner: bobID,
      units: 1,
      perPlayer: dollars(2),
    });
    expect(detail.outcomes[2]!.outcome).toEqual({ type: 'pending' });
    // Hole 4 resolves immediately — no chain dependency without carryover.
    expect(detail.outcomes[3]!.outcome).toEqual({
      type: 'won',
      winner: jackID,
      units: 1,
      perPlayer: dollars(2),
    });
    expect(result.settled[jackID]).toBe(dollars(4)); // −2 + 6
    expect(result.settled[bobID]).toBe(dollars(4));
  });

  it('requires par or better when validation is on', () => {
    // Hole 1 (par 4) is won with a 5 → carried; hole 2 (par 5) won with a
    // birdie 4 → two skins.
    const players = [jack(), jill(), bob()];
    const bet = makeBet({ players: players.map((p) => p.id), validation: true });
    const snap = snapshot({
      players,
      scores: {
        [jackID]: [5, 4],
        [jillID]: [6, 5],
        [bobID]: [6, 5],
      },
    });
    const result = evaluateBet(bet, snap);
    const detail = skinsDetail(result);

    expect(detail.outcomes[0]!.outcome, "bogey can't validate a skin").toEqual({
      type: 'carried',
    });
    expect(detail.outcomes[1]!.outcome).toEqual({
      type: 'won',
      winner: jackID,
      units: 2,
      perPlayer: dollars(4),
    });
    expect(result.settled[jackID]).toBe(dollars(8));
  });

  it('applies strokes in net mode', () => {
    // Jill gets a stroke on every hole at 18; identical gross 4s on hole 1 make
    // her net 3 the winner.
    const players = [jack(0), jill(18)];
    const bet = makeBet({ players: players.map((p) => p.id), mode: 'net' });
    const snap = snapshot({
      players,
      scores: { [jackID]: [4], [jillID]: [4] },
    });
    const result = evaluateBet(bet, snap);
    expect(result.settled[jillID]).toBe(dollars(2));
    expect(result.settled[jackID]).toBe(dollars(-2));
  });

  it('stops a withdrawn player paying and winning', () => {
    const players = [jack(), jill(), bob()];
    const bet = makeBet({ players: players.map((p) => p.id) });
    const snap = snapshot({
      players,
      scores: {
        [jackID]: [4, 3],
        [jillID]: [4, 4],
        [bobID]: [3],
      },
      withdrawals: { [bobID]: 1 },
    });
    const result = evaluateBet(bet, snap);
    // Hole 1: Bob wins while still in → +$4 from the other two.
    // Hole 2: only Jack & Jill active; Jack wins $2 from Jill alone.
    expect(result.settled[bobID]).toBe(dollars(4));
    expect(result.settled[jackID]).toBe(dollars(0));
    expect(result.settled[jillID]).toBe(dollars(-4));
  });

  it('voids holes with fewer than two active players', () => {
    const players = [jack(), jill()];
    const bet = makeBet({ players: players.map((p) => p.id) });
    const snap = snapshot({
      players,
      scores: { [jackID]: [4, 4], [jillID]: [5] },
      withdrawals: { [jillID]: 1 },
    });
    const result = evaluateBet(bet, snap);
    const detail = skinsDetail(result);
    expect(detail.outcomes[0]!.outcome).toEqual({
      type: 'won',
      winner: jackID,
      units: 1,
      perPlayer: dollars(2),
    });
    expect(detail.outcomes[1]!.outcome).toEqual({ type: 'void' });
  });

  it('surfaces riding units mid-round', () => {
    const players = [jack(), jill()];
    const bet = makeBet({ players: players.map((p) => p.id) });
    const snap = snapshot({
      players,
      scores: { [jackID]: [4, 4], [jillID]: [4, 4] },
    });
    const result = evaluateBet(bet, snap);
    const detail = skinsDetail(result);
    expect(detail.unitsRiding, 'two carried ties put three skins on hole 3').toBe(3);
    expect(result.headline).toContain('3 skins riding');
  });
});
