import { describe, expect, it } from 'vitest';
import type { MatchComputation } from '../evaluation';
import { computeMatch } from '../matchEngine';
import { _, bob, bobID, jack, jackID, jill, jillID, snapshot, sue, sueID, type Card } from './fixtures';

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_v, i) => from + i);

const repeat = (value: number | null, count: number): Card =>
  Array.from({ length: count }, () => value);

/** 1v1 gross over the front nine of the fixture course. */
function compute(
  jackCard: Card,
  jillCard: Card,
  holes: number[] = range(1, 9),
): MatchComputation {
  const snap = snapshot({
    players: [jack(), jill()],
    scores: { [jackID]: jackCard, [jillID]: jillCard },
  });
  return computeMatch([jackID], [jillID], holes, snap, 'gross', 'offLow');
}

describe('MatchEngine', () => {
  it('tracks running status', () => {
    // Jack wins 1 & 2, halves 3, loses 4.
    const comp = compute([4, 4, 3, 5], [5, 5, 3, 4]);
    expect(comp.status.upA).toBe(1);
    expect(comp.status.holesDecided).toBe(4);
    expect(comp.status.remaining).toBe(5);
    expect(comp.status.closed).toBe(false);
    expect(comp.status.winner).toBeNull();
    expect(comp.status.display).toBe('1 UP thru 4');
  });

  it('reports dormie', () => {
    // Jack wins 1–3 then halves 4–6: 3 up, 3 to play.
    const comp = compute([4, 4, 3, 4, 4, 4], [5, 5, 4, 4, 4, 4]);
    expect(comp.status.upA).toBe(3);
    expect(comp.status.dormieSide).toBe('a');
    expect(comp.status.closed).toBe(false);
    expect(comp.status.display).toBe('Dormie 3');
  });

  it('auto-closes at 3&2 and ignores later holes', () => {
    // W W H W H H H → 3 up with 2 to play after hole 7: closed 3&2.
    // Holes 8–9 have scores that must NOT count.
    const comp = compute([4, 4, 3, 4, 4, 4, 3, 9, 9], [5, 5, 3, 5, 4, 4, 3, 4, 4]);
    expect(comp.status.closed).toBe(true);
    expect(comp.status.winner).toBe('a');
    expect(comp.status.display).toBe('3&2');
    expect(comp.holeResults.length, 'results must stop when the match closes').toBe(7);
  });

  it('reads a final-hole win as "2 UP"', () => {
    // All square through 7, Jack wins 8 and 9 → "2 UP".
    const comp = compute([4, 4, 3, 4, 4, 4, 3, 4, 3], [4, 4, 3, 4, 4, 4, 3, 5, 4]);
    expect(comp.status.closed).toBe(true);
    expect(comp.status.remaining).toBe(0);
    expect(comp.status.display).toBe('2 UP');
  });

  it('halves a tied match', () => {
    const card = repeat(4, 9);
    const comp = compute(card, card);
    expect(comp.status.closed).toBe(false);
    expect(comp.status.winner).toBeNull();
    expect(comp.status.display).toBe('Halved');
  });

  it('keeps the match open on a pending hole', () => {
    // Jack 1 up, but hole 2 unscored for Jill: 1 up with 1 undecided hole is
    // NOT closed — Jill could still halve the match by winning hole 2 once it's
    // filled in. It is, however, dormie: Jack can no longer lose.
    const jackCard = repeat(4, 9);
    jackCard[0] = 3;
    const jillCard = repeat(4, 9);
    jillCard[1] = _;
    const comp = compute(jackCard, jillCard);
    expect(comp.status.upA).toBe(1);
    expect(comp.status.remaining).toBe(1);
    expect(comp.status.closed).toBe(false);
    expect(comp.status.winner).toBeNull();
    expect(comp.pendingHoles).toEqual([2]);
    expect(comp.status.dormieSide).toBe('a');
    expect(comp.status.display).toBe('Dormie 1');
  });

  it('requires every best-ball score before deciding a hole', () => {
    const snap = snapshot({
      players: [jack(), jill(), bob(), sue()],
      scores: {
        [jackID]: [4],
        [bobID]: [5],
        [sueID]: [5],
        // Jill hasn't posted.
      },
    });
    const pendingComp = computeMatch(
      [jackID, jillID],
      [bobID, sueID],
      [1],
      snap,
      'gross',
      'offLow',
    );
    expect(pendingComp.pendingHoles).toEqual([1]);
    expect(pendingComp.status.holesDecided).toBe(0);

    const withJill = { ...snap, scores: { ...snap.scores, [jillID]: { 1: 6 } } };
    const decided = computeMatch(
      [jackID, jillID],
      [bobID, sueID],
      [1],
      withJill,
      'gross',
      'offLow',
    );
    // Side A best ball 4 beats side B best ball 5.
    expect(decided.status.upA).toBe(1);
  });

  it('concedes remaining holes after a withdrawal', () => {
    // Halved 1–3 by scores, then Jill withdraws: holes 4+ conceded until the
    // match closes at hole 7 (4 up, 2 to play).
    const snap = snapshot({
      players: [jack(), jill()],
      scores: {
        [jackID]: [4, 4, 3],
        [jillID]: [4, 4, 3],
      },
      withdrawals: { [jillID]: 3 },
    });
    const comp = computeMatch([jackID], [jillID], range(1, 9), snap, 'gross', 'offLow');
    expect(comp.status.closed).toBe(true);
    expect(comp.status.winner).toBe('a');
    expect(comp.status.display).toBe('4&2');
    expect(comp.holeResults.slice(3).every((r) => r.byConcession)).toBe(true);
  });

  it('applies off-low strokes in a net match', () => {
    // Jack 0, Jill 9: Jill strokes on front holes with SI ≤ 9 — holes 1 (SI5),
    // 2 (SI1), 4 (SI9), 6 (SI7), 8 (SI3). Everyone shoots gross 4s, so Jill
    // nets out a win on each stroke hole and the match closes at hole 6, 4 down
    // with 3 to play.
    const card = repeat(4, 9);
    const snap = snapshot({
      players: [jack(0), jill(9)],
      scores: { [jackID]: card, [jillID]: card },
    });
    const comp = computeMatch([jackID], [jillID], range(1, 9), snap, 'net', 'offLow');
    expect(comp.status.closed).toBe(true);
    expect(comp.status.winner).toBe('b');
    expect(comp.status.display).toBe('4&3');
  });
});
