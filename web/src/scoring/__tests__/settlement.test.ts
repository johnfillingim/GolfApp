import { describe, expect, it } from 'vitest';
import { dollars } from '../money';
import { minimalTransfers, netBalances } from '../settlement';
import { bobID, jackID, jillID, sueID } from './fixtures';

describe('Settlement', () => {
  it('sums balances across bets', () => {
    const net = netBalances([
      { [jackID]: dollars(5) },
      { [jackID]: dollars(-2), [jillID]: dollars(2) },
      { [jillID]: dollars(-5) },
    ]);
    expect(net[jackID]).toBe(dollars(3));
    expect(net[jillID]).toBe(dollars(-3));
  });

  it('consolidates greedily, largest debt first', () => {
    const transfers = minimalTransfers({
      [jackID]: dollars(20),
      [jillID]: dollars(-5),
      [bobID]: dollars(-15),
    });
    // Largest debtor pays first: Bob $15 → Jack, then Jill $5 → Jack.
    expect(transfers).toEqual([
      { from: bobID, to: jackID, amount: dollars(15) },
      { from: jillID, to: jackID, amount: dollars(5) },
    ]);
  });

  it('keeps the transfer count under the player count', () => {
    const transfers = minimalTransfers({
      [jackID]: dollars(10),
      [jillID]: dollars(10),
      [bobID]: dollars(-10),
      [sueID]: dollars(-10),
    });
    expect(transfers.length).toBe(2);
    // Conservation: total paid equals total received.
    const paid = transfers.reduce((sum, t) => sum + t.amount, 0);
    expect(paid).toBe(dollars(20));
  });

  it('breaks ties deterministically by tee order', () => {
    const order = [jackID, jillID, bobID];
    const transfers = minimalTransfers(
      {
        [jackID]: dollars(10),
        [jillID]: dollars(10),
        [bobID]: dollars(-20),
      },
      order,
    );
    // Jack and Jill are tied at +$10; tee order puts Jack first — always.
    expect(transfers).toEqual([
      { from: bobID, to: jackID, amount: dollars(10) },
      { from: bobID, to: jillID, amount: dollars(10) },
    ]);
  });

  it('produces no transfers for zero balances', () => {
    expect(minimalTransfers({})).toEqual([]);
    expect(minimalTransfers({ [jackID]: 0 })).toEqual([]);
  });

  it('settles odd cents exactly', () => {
    // Three-way skins-like outcome that doesn't divide evenly.
    const transfers = minimalTransfers({
      [jackID]: 1001,
      [jillID]: -500,
      [bobID]: -501,
    });
    const paid = transfers.reduce((sum, t) => sum + t.amount, 0);
    expect(paid).toBe(1001);
    expect(transfers.length).toBe(2);
  });
});
