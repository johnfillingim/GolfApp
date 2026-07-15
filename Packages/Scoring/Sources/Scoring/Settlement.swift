import Foundation

/// One "X pays Y $Z" instruction in the end-of-round settlement.
public struct Transfer: Hashable, Codable, Sendable, Identifiable {
    public let from: PlayerID
    public let to: PlayerID
    public let amount: Money

    public var id: String { "\(from.uuidString)>\(to.uuidString):\(amount.cents)" }

    public init(from: PlayerID, to: PlayerID, amount: Money) {
        self.from = from
        self.to = to
        self.amount = amount
    }
}

/// Consolidates every bet's balances into per-player nets and reduces them to
/// a near-minimal list of payments (the Splitwise problem).
public enum Settlement {

    /// Sums balance maps from all bets into one net position per player.
    public static func netBalances(_ maps: [[PlayerID: Money]]) -> [PlayerID: Money] {
        var net: [PlayerID: Money] = [:]
        for map in maps {
            net.add(map)
        }
        return net
    }

    /// Greedy debt consolidation: repeatedly match the largest debtor with
    /// the largest creditor. Produces at most (players − 1) transfers, which
    /// is optimal whenever no strict subset of players nets to zero — the
    /// overwhelmingly common case for a golf group. (True minimality is
    /// NP-hard via subset-sum; not worth it for 8 players.)
    ///
    /// `playerOrder` breaks amount ties so every device emits the identical
    /// payment list.
    public static func minimalTransfers(
        balances: [PlayerID: Money],
        playerOrder: [PlayerID] = []
    ) -> [Transfer] {
        func orderIndex(_ id: PlayerID) -> Int {
            playerOrder.firstIndex(of: id) ?? playerOrder.count
        }

        // Balance maps are zero-sum by construction (asserted in
        // BetEvaluator), so creditors and creditors always pair off exactly.
        var creditors = balances.filter { $0.value.isPositive }
            .map { (id: $0.key, amount: $0.value) }
        var debtors = balances.filter { $0.value.isNegative }
            .map { (id: $0.key, amount: -$0.value) } // stored positive

        func sortQueues() {
            creditors.sort { ($0.amount.cents, -orderIndex($0.id), $0.id.uuidString) > ($1.amount.cents, -orderIndex($1.id), $1.id.uuidString) }
            debtors.sort { ($0.amount.cents, -orderIndex($0.id), $0.id.uuidString) > ($1.amount.cents, -orderIndex($1.id), $1.id.uuidString) }
        }

        var transfers: [Transfer] = []
        while !creditors.isEmpty && !debtors.isEmpty {
            sortQueues()
            var creditor = creditors.removeFirst()
            var debtor = debtors.removeFirst()

            let amount = min(creditor.amount, debtor.amount)
            transfers.append(Transfer(from: debtor.id, to: creditor.id, amount: amount))

            creditor.amount -= amount
            debtor.amount -= amount
            if creditor.amount.isPositive { creditors.append(creditor) }
            if debtor.amount.isPositive { debtors.append(debtor) }
        }

        return transfers
    }
}
