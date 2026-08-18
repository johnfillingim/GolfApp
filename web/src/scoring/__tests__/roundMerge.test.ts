import { describe, expect, it } from 'vitest';
import { emptyEvents } from '../snapshot';
import {
  emptyChangeSet,
  mergeChangeSets,
  newerCell,
  scoreTableFrom,
  type RoundChangeSet,
  type ScoreCell,
} from '../roundMerge';
import { jackID, jillID } from './fixtures';

function cell(options: {
  player?: string;
  hole?: number;
  strokes: number | null;
  at: number;
  editor: string;
}): ScoreCell {
  return {
    playerID: options.player ?? jackID,
    hole: options.hole ?? 1,
    strokes: options.strokes,
    updatedAt: options.at * 1000,
    editorID: options.editor,
  };
}

const changeSet = (partial: Partial<RoundChangeSet>): RoundChangeSet => ({
  ...emptyChangeSet(),
  ...partial,
});

describe('RoundMerge', () => {
  it('resolves score cells last-write-wins', () => {
    const older = cell({ strokes: 5, at: 100, editor: 'phone-A' });
    const newer = cell({ strokes: 4, at: 200, editor: 'phone-B' });
    expect(newerCell(older, newer).strokes).toBe(4);
    expect(
      newerCell(newer, older).strokes,
      'winner must not depend on argument order',
    ).toBe(4);
  });

  it('breaks a timestamp tie by editor ID', () => {
    const a = cell({ strokes: 5, at: 100, editor: 'phone-A' });
    const b = cell({ strokes: 4, at: 100, editor: 'phone-B' });
    expect(newerCell(a, b).strokes, 'higher editor ID wins the tie').toBe(4);
    expect(newerCell(b, a).strokes).toBe(4);
  });

  it('merges commutatively', () => {
    const setA = changeSet({
      cells: [
        cell({ hole: 1, strokes: 5, at: 100, editor: 'A' }),
        cell({ hole: 2, strokes: 4, at: 300, editor: 'A' }),
      ],
    });
    const setB = changeSet({
      cells: [
        cell({ hole: 1, strokes: 4, at: 200, editor: 'B' }),
        cell({ player: jillID, hole: 1, strokes: 6, at: 150, editor: 'B' }),
      ],
    });

    const ab = mergeChangeSets(setA, setB);
    const ba = mergeChangeSets(setB, setA);
    expect(ab.cells).toEqual(ba.cells);

    const table = scoreTableFrom(ab.cells);
    expect(table[jackID]?.[1], "B's later edit wins hole 1").toBe(4);
    expect(table[jackID]?.[2]).toBe(4);
    expect(table[jillID]?.[1]).toBe(6);
  });

  it('unions events idempotently', () => {
    const press = {
      id: 'PRESS-1',
      betID: 'BET-1',
      segment: 'back' as const,
      firstHole: 12,
      pressedBy: 'a' as const,
    };
    const a = changeSet({ events: { ...emptyEvents(), presses: [press] } });
    const b = changeSet({ events: { ...emptyEvents(), presses: [press] } });
    expect(mergeChangeSets(a, b).events.presses.length).toBe(1);
  });

  it('deduplicates wolf decisions by bet and hole', () => {
    // Two phones record a pick for the same hole (a true race). Exactly one
    // must survive.
    const decision = {
      betID: 'BET-1',
      hole: 3,
      wolf: jackID,
      choice: { type: 'lone' as const },
    };
    const a = changeSet({ events: { ...emptyEvents(), wolfDecisions: [decision] } });
    const b = changeSet({ events: { ...emptyEvents(), wolfDecisions: [decision] } });
    expect(mergeChangeSets(a, b).events.wolfDecisions.length).toBe(1);
  });

  it('keeps the earliest withdrawal hole', () => {
    const a = changeSet({ withdrawals: { [jillID]: 5 } });
    const b = changeSet({ withdrawals: { [jillID]: 3 } });
    expect(mergeChangeSets(a, b).withdrawals[jillID]).toBe(3);
    expect(mergeChangeSets(b, a).withdrawals[jillID]).toBe(3);
  });

  it('drops a cleared score from the table', () => {
    const cleared = cell({ strokes: null, at: 300, editor: 'A' });
    const table = scoreTableFrom([cleared]);
    expect(table[jackID]?.[1]).toBeUndefined();
  });
});
