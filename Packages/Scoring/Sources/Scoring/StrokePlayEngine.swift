import Foundation

/// Pot-based stroke play: every player antes in; the low total (net or gross)
/// over the round takes the pot. Ties split it evenly, with odd cents going
/// to the earlier tee order — arbitrary but identical on every device.
///
/// Live standings compare players **to par through the holes each has
/// completed** — the only fair mid-round comparison when the group is spread
/// across holes.
///
/// Withdrawn players forfeit their ante (it stays in the pot) and cannot win.
/// If nobody finishes the round, the bet voids and no money moves.
public enum StrokePlayEngine {

    public static func evaluate(bet: Bet, config: StrokePlayConfig, snapshot: RoundSnapshot) -> BetEvaluation {
        let allHoles = snapshot.holeNumbers
        let firstHole = config.firstHole ?? allHoles.first ?? 1
        let holes = allHoles.filter { $0 >= firstHole }

        let participants = config.players.compactMap { snapshot.player($0) }
        let courseHoles = snapshot.holeNumbers.compactMap { snapshot.course.hole($0) }
        let strokes = StrokeAllocator.table(
            for: participants, holes: courseHoles,
            mode: config.handicapMode, allowance: .full
        )

        var rows: [StrokePlayEvaluation.Row] = []
        for player in config.players {
            let isWithdrawn = snapshot.withdrawals[player] != nil
            var gross = 0
            var net = 0
            var par = 0
            var completed = 0
            for hole in holes {
                guard snapshot.isActive(player, atHole: hole),
                      let strokesTaken = snapshot.gross(player, hole: hole)
                else { continue }
                completed += 1
                gross += strokesTaken
                net += strokesTaken - (strokes[player]?[hole] ?? 0)
                par += snapshot.course.hole(hole)?.par ?? 0
            }
            let counted = config.handicapMode == .net ? net : gross
            rows.append(.init(
                player: player,
                holesCompleted: completed,
                grossTotal: gross,
                netTotal: net,
                toPar: counted - par,
                isWithdrawn: isWithdrawn
            ))
        }

        // Leaderboard order: players with scores by to-par, then players who
        // haven't started (their to-par of 0 would otherwise outrank anyone
        // over par), withdrawn at the end.
        rows.sort { lhs, rhs in
            if lhs.isWithdrawn != rhs.isWithdrawn { return !lhs.isWithdrawn }
            if (lhs.holesCompleted > 0) != (rhs.holesCompleted > 0) { return lhs.holesCompleted > 0 }
            if lhs.toPar != rhs.toPar { return lhs.toPar < rhs.toPar }
            if lhs.holesCompleted != rhs.holesCompleted { return lhs.holesCompleted > rhs.holesCompleted }
            return snapshot.orderIndex(of: lhs.player) < snapshot.orderIndex(of: rhs.player)
        }

        let pot = config.ante * config.players.count
        let finishers = rows.filter { !$0.isWithdrawn && $0.holesCompleted == holes.count }
        let everyoneDone = rows.allSatisfy { $0.isWithdrawn || $0.holesCompleted == holes.count }
        let isFinal = everyoneDone && !finishers.isEmpty

        var settled: [PlayerID: Money] = [:]
        var projected: [PlayerID: Money] = [:]

        func payout(to winners: [PlayerID]) -> [PlayerID: Money] {
            guard !winners.isEmpty else { return [:] }
            var balances: [PlayerID: Money] = [:]
            for player in config.players {
                balances.add(-config.ante, to: player)
            }
            // Winners in tee order so the odd-cent rule is deterministic.
            let ordered = winners.sorted { snapshot.orderIndex(of: $0) < snapshot.orderIndex(of: $1) }
            for (winner, share) in zip(ordered, Money.split(pot, ways: ordered.count)) {
                balances.add(share, to: winner)
            }
            return balances
        }

        if isFinal {
            let best = finishers.map(\.toPar).min()!
            let winners = finishers.filter { $0.toPar == best }.map(\.player)
            settled = payout(to: winners)
            projected = settled
        } else if let leader = rows.first, !leader.isWithdrawn, leader.holesCompleted > 0 {
            let best = rows.filter { !$0.isWithdrawn && $0.holesCompleted > 0 }.map(\.toPar).min()!
            let leaders = rows.filter { !$0.isWithdrawn && $0.holesCompleted > 0 && $0.toPar == best }.map(\.player)
            projected = payout(to: leaders)
        }

        func toParText(_ value: Int) -> String {
            value == 0 ? "E" : (value > 0 ? "+\(value)" : "\(value)")
        }

        let lines: [StandingLine] = rows.map { row in
            let statusText: String
            if row.isWithdrawn {
                statusText = "WD"
            } else if row.holesCompleted == 0 {
                statusText = "—"
            } else {
                let total = config.handicapMode == .net ? row.netTotal : row.grossTotal
                statusText = "\(toParText(row.toPar)) (\(total)) thru \(row.holesCompleted)"
            }
            return StandingLine(
                id: "\(bet.id)-row-\(row.player)",
                title: snapshot.shortName(row.player),
                status: statusText,
                leaders: [],
                isSettled: isFinal
            )
        }

        let headline: String
        if let leader = rows.first, leader.holesCompleted > 0, !leader.isWithdrawn {
            let verb = isFinal ? "wins" : "leads"
            headline = "\(snapshot.shortName(leader.player)) \(verb) at \(toParText(leader.toPar)) · \(pot) pot"
        } else {
            headline = "\(pot) pot · no scores yet"
        }

        return BetEvaluation(
            betID: bet.id,
            betName: bet.name,
            kindName: config.handicapMode == .net ? "Net Stroke Play" : "Gross Stroke Play",
            headline: headline,
            lines: lines,
            settled: settled,
            projected: projected,
            events: [],
            detail: .strokePlay(StrokePlayEvaluation(rows: rows, pot: pot, isFinal: isFinal))
        )
    }
}
