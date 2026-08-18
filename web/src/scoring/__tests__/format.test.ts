import { describe, expect, it } from 'vitest';
import { dollars, formatMoney, formatSigned } from '../money';

/**
 * These two have no Swift counterpart — the iOS app formatted money in its view
 * layer. They are covered here because a dropped or wrong sign on a money label
 * is the single worst bug this app can ship.
 */
describe('UI money formatting', () => {
  it('drops trailing zero cents but keeps odd cents', () => {
    expect(formatMoney(dollars(5))).toBe('$5');
    expect(formatMoney(dollars(-5))).toBe('-$5');
    expect(formatMoney(450)).toBe('$4.50');
    expect(formatMoney(-450)).toBe('-$4.50');
    expect(formatMoney(0)).toBe('$0');
  });

  it('always carries the sign, and never renders a loss as a gain', () => {
    expect(formatSigned(dollars(5))).toBe('+$5');
    expect(formatSigned(dollars(-5))).toBe('-$5');
    expect(formatSigned(-1000)).toBe('-$10');
    expect(formatSigned(-1)).toBe('-$0.01');
    expect(formatSigned(0)).toBe('even');
  });
});
