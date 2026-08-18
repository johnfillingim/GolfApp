import { addAll, type Balances, type Money } from './money';
import type { PlayerID } from './types';

/** One "X pays Y $Z" instruction in the end-of-round settlement. */
export interface Transfer {
  from: PlayerID;
  to: PlayerID;
  amount: Money;
}

export function transferID(transfer: Transfer): string {
  return `${transfer.from}>${transfer.to}:${transfer.amount}`;
}

/** Sums balance maps from all bets into one net position per player. */
export function netBalances(maps: Balances[]): Balances {
  const net: Balances = {};
  for (const map of maps) addAll(net, map);
  return net;
}

/**
 * Greedy debt consolidation: repeatedly match the largest debtor with the
 * largest creditor. Produces at most (players − 1) transfers, which is optimal
 * whenever no strict subset of players nets to zero — the overwhelmingly common
 * case for a golf group. (True minimality is NP-hard via subset-sum; not worth
 * it for 8 players.)
 *
 * `playerOrder` breaks amount ties so the payment list is deterministic.
 */
export function minimalTransfers(
  balances: Balances,
  playerOrder: PlayerID[] = [],
): Transfer[] {
  const orderIndexOf = (id: PlayerID): number => {
    const index = playerOrder.indexOf(id);
    return index === -1 ? playerOrder.length : index;
  };

  interface Entry {
    id: PlayerID;
    amount: Money;
  }

  // Balance maps are zero-sum by construction (asserted in `evaluate`), so
  // debtors and creditors always pair off exactly.
  const creditors: Entry[] = [];
  const debtors: Entry[] = [];
  for (const id of Object.keys(balances)) {
    const amount = balances[id] ?? 0;
    if (amount > 0) creditors.push({ id, amount });
    else if (amount < 0) debtors.push({ id, amount: -amount }); // stored positive
  }

  // Largest amount first; ties by tee order, then by ID descending — a total
  // order, so the emitted list is identical for identical input.
  const compare = (x: Entry, y: Entry): number =>
    y.amount - x.amount ||
    orderIndexOf(x.id) - orderIndexOf(y.id) ||
    (x.id < y.id ? 1 : x.id > y.id ? -1 : 0);

  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    creditors.sort(compare);
    debtors.sort(compare);
    const creditor = creditors.shift()!;
    const debtor = debtors.shift()!;

    const amount = Math.min(creditor.amount, debtor.amount);
    transfers.push({ from: debtor.id, to: creditor.id, amount });

    creditor.amount -= amount;
    debtor.amount -= amount;
    if (creditor.amount > 0) creditors.push(creditor);
    if (debtor.amount > 0) debtors.push(debtor);
  }

  return transfers;
}
