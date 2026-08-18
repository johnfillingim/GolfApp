import { describe, expect, it } from 'vitest';
import { allocation, strokeTable } from '../handicapping';
import { course18, jack, jackID, jill, jillID } from './fixtures';

const holes = course18().holes;

const sum = (table: Record<number, number>): number =>
  Object.values(table).reduce((a, b) => a + b, 0);

describe('StrokeAllocator', () => {
  it('gives a scratch player nothing', () => {
    const result = allocation(0, holes);
    expect(Object.values(result).every((v) => v === 0)).toBe(true);
  });

  it('gives a 13 handicap one stroke on the thirteen hardest holes', () => {
    const result = allocation(13, holes);
    // One stroke wherever stroke index ≤ 13, none on SI 14–18.
    for (const hole of holes) {
      const expected = hole.strokeIndex <= 13 ? 1 : 0;
      expect(result[hole.number], `hole ${hole.number} (SI ${hole.strokeIndex})`).toBe(
        expected,
      );
    }
    expect(sum(result)).toBe(13);
  });

  it('wraps a 20 handicap to a second stroke on the two hardest holes', () => {
    const result = allocation(20, holes);
    // Base stroke everywhere plus a second on SI 1 and SI 2.
    // SI 1 = hole 2, SI 2 = hole 12 on the fixture card.
    expect(result[2]).toBe(2);
    expect(result[12]).toBe(2);
    expect(result[3]).toBe(1); // SI 17
    expect(sum(result)).toBe(20);
  });

  it('gives strokes back on the easiest holes for a plus handicap', () => {
    const result = allocation(-2, holes);
    // SI 18 = hole 16, SI 17 = hole 3 give a stroke back.
    expect(result[16]).toBe(-1);
    expect(result[3]).toBe(-1);
    expect(sum(result)).toBe(-2);
    expect(Object.values(result).filter((v) => v !== 0).length).toBe(2);
  });

  it('ranks within the holes actually played on a back-nine round', () => {
    const backNine = course18().holes.filter((h) => h.number >= 10);
    const result = allocation(3, backNine);
    // Back-nine stroke indexes are {6,16,2,10,14,4,18,8,12}; the three hardest
    // played holes are SI 2 (hole 12), SI 4 (hole 15), SI 6 (hole 10) — raw
    // SI ≤ 3 would misfire here.
    expect(result[12]).toBe(1);
    expect(result[15]).toBe(1);
    expect(result[10]).toBe(1);
    expect(result[17]).toBe(0); // SI 8 — fourth hardest, gets nothing
    expect(sum(result)).toBe(3);
  });

  it('reduces by the lowest handicap under the off-low allowance', () => {
    const table = strokeTable([jack(3), jill(8)], holes, 'net', 'offLow');
    // Jack plays at scratch; Jill gets 8 − 3 = 5 strokes.
    expect(sum(table[jackID]!)).toBe(0);
    expect(sum(table[jillID]!)).toBe(5);
  });

  it('zeroes everything in gross mode', () => {
    const table = strokeTable([jack(3), jill(8)], holes, 'gross');
    expect(Object.values(table).every((t) => Object.keys(t).length === 0)).toBe(true);
  });
});
