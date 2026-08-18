import { addTo, split, type Balances, type Money } from './money';
import { playerIn, type RoundSnapshot } from './snapshot';
import type { PlayerID } from './types';

/**
 * "Per man" match payout: each loser pays `stakePerLoser`; the pot is split
 * evenly across the winners (odd cents to the earliest winner in the given
 * order, which callers keep stable).
 */
export function perLoserStake(
  winners: PlayerID[],
  losers: PlayerID[],
  stakePerLoser: Money,
): Balances {
  if (winners.length === 0 || losers.length === 0 || stakePerLoser === 0) return {};
  const balances: Balances = {};
  const pot = stakePerLoser * losers.length;
  for (const loser of losers) {
    addTo(balances, loser, -stakePerLoser);
  }
  const shares = split(pot, winners.length);
  winners.forEach((winner, index) => {
    addTo(balances, winner, shares[index] ?? 0);
  });
  return balances;
}

/**
 * Pairwise payout (used by Skins and Wolf): every payer sends `amount` to every
 * payee.
 */
export function pairwise(
  payees: PlayerID[],
  payers: PlayerID[],
  amount: Money,
): Balances {
  if (payees.length === 0 || payers.length === 0 || amount === 0) return {};
  const balances: Balances = {};
  for (const payer of payers) {
    addTo(balances, payer, -(amount * payees.length));
  }
  for (const payee of payees) {
    addTo(balances, payee, amount * payers.length);
  }
  return balances;
}

/** First name (or full name if a single token) for compact status strings. */
export function shortName(snapshot: RoundSnapshot, id: PlayerID): string {
  const name = playerIn(snapshot, id)?.name;
  if (!name) return '?';
  const first = name.split(' ').filter(Boolean)[0];
  return first ?? name;
}

/** Compact label for a side: "Jack", "Jack & Jill", "Jack +2". */
export function sideName(snapshot: RoundSnapshot, ids: PlayerID[]): string {
  switch (ids.length) {
    case 0:
      return '—';
    case 1:
      return shortName(snapshot, ids[0]!);
    case 2:
      return `${shortName(snapshot, ids[0]!)} & ${shortName(snapshot, ids[1]!)}`;
    default:
      return `${shortName(snapshot, ids[0]!)} +${ids.length - 1}`;
  }
}
