import { describe, expect, it } from 'vitest';
import { detectMilestones, type MilestoneKind } from '../milestones';
import { _, jack, jackID, jill, jillID, snapshot } from './fixtures';

describe('MilestoneDetector', () => {
  it('classifies scores and fires streaks at each extension', () => {
    // Fixture pars: h1=4, h2=5, h3=3, h4=4, h5=4, h6=4.
    // Jack: birdie, albatross, ACE, par, birdie, birdie.
    const snap = snapshot({
      players: [jack()],
      scores: { [jackID]: [3, 2, 1, 4, 3, 3] },
    });
    const milestones = detectMilestones(snap);
    const kinds: Record<string, MilestoneKind> = {};
    for (const milestone of milestones) kinds[milestone.id] = milestone.kind;

    expect(kinds[`birdie-${jackID}-1`]).toEqual({ type: 'birdie' });
    expect(kinds[`albatross-${jackID}-2`]).toEqual({ type: 'albatross' });
    expect(kinds[`ace-${jackID}-3`]).toEqual({ type: 'holeInOne' });
    expect(
      kinds[`eagle-${jackID}-3`],
      'an ace reports as an ace, not an eagle',
    ).toBeUndefined();

    // Streak fires at each extension: 2 at hole 2, 3 at hole 3, then par breaks
    // it; a fresh pair at holes 5–6 fires streak 2 again.
    expect(kinds[`streak-${jackID}-2-2`]).toEqual({ type: 'birdieStreak', count: 2 });
    expect(kinds[`streak-${jackID}-3-3`]).toEqual({ type: 'birdieStreak', count: 3 });
    expect(kinds[`streak-${jackID}-5-2`]).toBeUndefined();
    expect(kinds[`streak-${jackID}-6-2`]).toEqual({ type: 'birdieStreak', count: 2 });
    expect(milestones.length).toBe(8);
  });

  it('detects an eagle on a par five', () => {
    const snap = snapshot({
      players: [jill()],
      scores: { [jillID]: [_, 3] },
    });
    const milestones = detectMilestones(snap);
    expect(milestones.map((m) => m.kind)).toEqual([{ type: 'eagle' }]);
  });

  it('breaks a streak on an unscored hole', () => {
    // Birdie at 1, gap at 2, birdie at 3 → no streak milestone.
    const snap = snapshot({
      players: [jill()],
      scores: { [jillID]: [3, _, 2] },
    });
    const milestones = detectMilestones(snap);
    expect(milestones.some((m) => m.kind.type === 'birdieStreak')).toBe(false);
    expect(milestones.length).toBe(2);
  });

  it('produces stable IDs across evaluations', () => {
    const snap = snapshot({
      players: [jack()],
      scores: { [jackID]: [3] },
    });
    expect(
      detectMilestones(snap),
      'the celebration engine dedupes on these IDs — they must be stable',
    ).toEqual(detectMilestones(snap));
  });
});
