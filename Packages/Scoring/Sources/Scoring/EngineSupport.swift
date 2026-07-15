import Foundation

/// Shared money-movement helpers. Every engine builds its balance maps from
/// symmetric transfers, which is what makes the zero-sum invariant hold by
/// construction.
enum Transfers {
    /// "Per man" match payout: each loser pays `stakePerLoser`; the pot is
    /// split evenly across the winners (odd cents to the earliest winner in
    /// the given order, which callers keep stable across devices).
    static func perLoserStake(
        winners: [PlayerID],
        losers: [PlayerID],
        stakePerLoser: Money
    ) -> [PlayerID: Money] {
        guard !winners.isEmpty, !losers.isEmpty, !stakePerLoser.isZero else { return [:] }
        var balances: [PlayerID: Money] = [:]
        let pot = stakePerLoser * losers.count
        for loser in losers {
            balances.add(-stakePerLoser, to: loser)
        }
        for (winner, share) in zip(winners, Money.split(pot, ways: winners.count)) {
            balances.add(share, to: winner)
        }
        return balances
    }

    /// Pairwise payout (used by Skins and Wolf): every payer sends `amount`
    /// to every payee.
    static func pairwise(
        payees: [PlayerID],
        payers: [PlayerID],
        amount: Money
    ) -> [PlayerID: Money] {
        guard !payees.isEmpty, !payers.isEmpty, !amount.isZero else { return [:] }
        var balances: [PlayerID: Money] = [:]
        for payer in payers {
            balances.add(-(amount * payees.count), to: payer)
        }
        for payee in payees {
            balances.add(amount * payers.count, to: payee)
        }
        return balances
    }
}

extension RoundSnapshot {
    /// First name (or full name if single token) for compact status strings.
    func shortName(_ id: PlayerID) -> String {
        guard let name = player(id)?.name, !name.isEmpty else { return "?" }
        return name.split(separator: " ").first.map(String.init) ?? name
    }

    /// Compact label for a side: "Jack", "Jack & Jill", "Jack +2".
    func sideName(_ ids: [PlayerID]) -> String {
        switch ids.count {
        case 0: return "—"
        case 1: return shortName(ids[0])
        case 2: return "\(shortName(ids[0])) & \(shortName(ids[1]))"
        default: return "\(shortName(ids[0])) +\(ids.count - 1)"
        }
    }
}
