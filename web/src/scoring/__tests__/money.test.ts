import { describe, expect, it } from 'vitest';
import { addTo, describeMoney, dollars, split, totalCents, type Balances } from '../money';
import { jackID, jillID } from './fixtures';

describe('Money', () => {
  it('does exact integer arithmetic', () => {
    expect(dollars(5) + 50).toBe(550);
    expect(dollars(5) - dollars(7)).toBe(-200);
    expect(dollars(3) * 4).toBe(dollars(12));
    expect(-dollars(2)).toBe(-200);
    expect(1 > 0).toBe(true);
    expect(-1 < 0).toBe(true);
  });

  it('splits exactly, with the odd cent to the earliest share', () => {
    // $10 three ways: 334 + 333 + 333 = 1000, extra cent to the first share.
    expect(split(dollars(10), 3)).toEqual([334, 333, 333]);
    // Splits must always re-sum to the original total.
    expect(split(1001, 4).reduce((a, b) => a + b, 0)).toBe(1001);
    // Negative totals mirror the behavior.
    expect(split(-1000, 3)).toEqual([-334, -333, -333]);
    // Splitting one way is identity.
    expect(split(77, 1)).toEqual([77]);
  });

  it('renders amounts', () => {
    expect(describeMoney(dollars(5))).toBe('$5.00');
    expect(describeMoney(250)).toBe('$2.50');
    expect(describeMoney(-450)).toBe('-$4.50');
    expect(describeMoney(5)).toBe('$0.05');
  });

  it('accumulates balance maps', () => {
    const balances: Balances = {};
    addTo(balances, jackID, dollars(5));
    addTo(balances, jillID, dollars(-5));
    addTo(balances, jackID, dollars(2));
    expect(balances[jackID]).toBe(dollars(7));
    expect(totalCents(balances)).toBe(200);
  });
});
