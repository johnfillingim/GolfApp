/**
 * An exact currency amount stored as integer cents.
 *
 * Betting math must never accumulate floating-point error. In Swift this was a
 * `Money` struct wrapping `Int`; in TypeScript it is a plain number alias so
 * that `+`/`-`/`*` stay native, with the invariant that the value is always an
 * integer count of cents. All bet engines produce zero-sum balance maps — the
 * invariant "everything won was lost by someone" is asserted centrally in
 * `evaluateAll`.
 */
export type Money = number;

export const ZERO: Money = 0;

/** Convenience for whole-dollar stakes ("a $5 Nassau"). */
export function dollars(amount: number): Money {
  return Math.round(amount * 100);
}

/**
 * Splits `total` into `ways` shares that sum *exactly* to `total`.
 * Remainder cents go to the earliest shares, which keeps splits deterministic
 * across devices (callers pass a stable participant order).
 */
export function split(total: Money, ways: number): Money[] {
  if (ways <= 0) throw new Error('Cannot split money zero ways');
  // Swift's integer division truncates toward zero; JS `Math.trunc` matches,
  // so negative totals distribute their negative remainder the same way.
  const base = Math.trunc(total / ways);
  let remainder = total - base * ways;
  const step = remainder >= 0 ? 1 : -1;
  const shares: Money[] = [];
  for (let i = 0; i < ways; i++) {
    let share = base;
    if (remainder !== 0) {
      share += step;
      remainder -= step;
    }
    shares.push(share);
  }
  return shares;
}

/** Plain "$4.50" / "-$4.50" rendering, matching the Swift `description`. */
export function describeMoney(value: Money): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const dollarPart = Math.trunc(abs / 100);
  const centPart = abs % 100;
  return `${sign}$${dollarPart}.${String(centPart).padStart(2, '0')}`;
}

/**
 * UI-facing money: whole dollars stay bare ("$5"), odd cents keep both digits
 * ("$4.50"). The Swift app formatted in its view layer; this is the web
 * equivalent and is deliberately separate from `describeMoney` (logs/tests).
 */
export function formatMoney(value: Money): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs % 100 === 0) return `${sign}$${abs / 100}`;
  return describeMoney(value);
}

/** Signed rendering for standings ("+$5", "-$5", "even"). */
export function formatSigned(value: Money): string {
  if (value === 0) return 'even';
  return value > 0 ? `+${formatMoney(value)}` : formatMoney(value);
}

// MARK: - Balance maps

/** playerID → amount. Sparse: a missing key means zero. */
export type Balances = Record<string, Money>;

/** Adds `amount` to `key`, treating a missing key as zero. */
export function addTo(map: Balances, key: string, amount: Money): void {
  map[key] = (map[key] ?? 0) + amount;
}

/** Merges another balance map into this one by addition. */
export function addAll(map: Balances, other: Balances): void {
  for (const key of Object.keys(other)) {
    addTo(map, key, other[key] ?? 0);
  }
}

/** Sum of all values — engines assert this is zero for every balance map. */
export function totalCents(map: Balances): number {
  let sum = 0;
  for (const key of Object.keys(map)) sum += map[key] ?? 0;
  return sum;
}

/** Reads a balance, treating a missing key as zero. */
export function balanceOf(map: Balances, key: string): Money {
  return map[key] ?? 0;
}

/**
 * Records a symmetric transfer: `from` pays `amount` to `to`.
 * Every engine builds its books out of this helper, which is what makes the
 * zero-sum invariant true by construction rather than by arithmetic luck.
 */
export function transfer(map: Balances, from: string, to: string, amount: Money): void {
  addTo(map, from, -amount);
  addTo(map, to, amount);
}
