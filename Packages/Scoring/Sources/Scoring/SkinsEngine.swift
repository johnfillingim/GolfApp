import Foundation

/// Skins: lowest unique score on a hole takes the skin. Ties carry the skin
/// forward when carryover is on, so a hole can be worth several skins.
///
/// Money model: a skin is worth `stakePerHole` **from each other active
/// player** per unit — the standard "everyone pays the winner" convention.
/// This keeps the pot proportional to group size and stays zero-sum for any
/// number of players.
///
/// Rules encoded here:
/// - A hole only awards once **every active participant** has a score
///   (a skin "won" before the last score posts could be taken back —
///   never show money that can silently vanish).
/// - With carryover on, an unscored hole freezes later holes: the carried
///   count depends on it. Without carryover, holes are independent, so later
///   completed holes resolve immediately.
/// - Validation (optional): the winning score must be net par or better;
///   a "win" with net bogey counts as a tie (carries if carryover is on).
/// - Withdrawn players stop paying and stop winning from the hole after
///   their withdrawal. If fewer than two players remain, holes are void.
/// - A carryover left riding after the last hole dies (no rollover between
///   rounds).
public enum SkinsEngine {

    public static func evaluate(bet: Bet, config: SkinsConfig, snapshot: RoundSnapshot) -> BetEvaluation {
        let allHoles = snapshot.holeNumbers
        let firstHole = config.firstHole ?? allHoles.first ?? 1
        let holes = allHoles.filter { $0 >= firstHole }

        let participants = config.players.compactMap { snapshot.player($0) }
        let courseHoles = snapshot.holeNumbers.compactMap { snapshot.course.hole($0) }
        // Skins is played at full allowance by convention.
        let strokes = StrokeAllocator.table(
            for: participants, holes: courseHoles,
            mode: config.handicapMode, allowance: .full
        )

        var outcomes: [(hole: Int, outcome: SkinsEvaluation.HoleOutcome)] = []
        var balances: [PlayerID: Money] = [:]
        var skinCounts: [PlayerID: Int] = [:]
        var events: [ScoringEvent] = []
        var units = 1
        var frozen = false

        for hole in holes {
            if frozen {
                outcomes.append((hole, .pending))
                continue
            }

            let active = snapshot.activePlayers(of: config.players, atHole: hole)
            guard active.count >= 2 else {
                outcomes.append((hole, .void))
                continue
            }

            // Every active player must have posted.
            var nets: [(PlayerID, Int)] = []
            var missing = false
            for player in active {
                guard let gross = snapshot.gross(player, hole: hole) else {
                    missing = true
                    break
                }
                nets.append((player, gross - (strokes[player]?[hole] ?? 0)))
            }
            if missing {
                outcomes.append((hole, .pending))
                // Carryover makes later holes depend on this one.
                if config.carryover { frozen = true }
                continue
            }

            let best = nets.map(\.1).min()!
            let leaders = nets.filter { $0.1 == best }.map(\.0)
            let par = snapshot.course.hole(hole)?.par ?? 0
            let validated = !config.requireValidation || best <= par

            if leaders.count == 1, validated {
                let winner = leaders[0]
                let payers = active.filter { $0 != winner }
                let perPlayer = config.stakePerHole * units
                balances.add(Transfers.pairwise(payees: [winner], payers: payers, amount: perPlayer))
                skinCounts[winner, default: 0] += units
                outcomes.append((hole, .won(winner: winner, units: units, perPlayer: perPlayer)))
                events.append(ScoringEvent(
                    id: "\(bet.id)-skin-\(hole)",
                    kind: .skinWon(units: units),
                    betID: bet.id,
                    players: [winner],
                    hole: hole,
                    amount: perPlayer * payers.count
                ))
                units = 1
            } else if config.carryover {
                units += 1
                outcomes.append((hole, .carried))
            } else {
                outcomes.append((hole, .dead))
            }
        }

        // Every hole resolved (nothing pending) means the round is over for
        // skins — anything still riding dies with it (no rollover to the
        // next round).
        let roundComplete = !outcomes.contains { entry in
            if case .pending = entry.outcome { return true }
            return false
        }
        let unitsRiding = roundComplete ? 0 : units

        // Standings rows: awarded skins plus a "riding" note.
        var lines: [StandingLine] = outcomes.compactMap { entry in
            switch entry.outcome {
            case .won(let winner, let units, let perPlayer):
                return StandingLine(
                    id: "\(bet.id)-skin-\(entry.hole)",
                    title: "Hole \(entry.hole)",
                    status: "\(snapshot.shortName(winner)) — \(units) skin\(units == 1 ? "" : "s") (\(perPlayer)/player)",
                    leaders: [winner],
                    isSettled: true
                )
            case .carried:
                return StandingLine(
                    id: "\(bet.id)-carry-\(entry.hole)",
                    title: "Hole \(entry.hole)",
                    status: "Tied — carried",
                    leaders: [],
                    isSettled: true
                )
            case .dead, .pending, .void:
                return nil
            }
        }
        if unitsRiding > 1 {
            lines.append(StandingLine(
                id: "\(bet.id)-riding",
                title: "Riding",
                status: "\(unitsRiding) skins on the next hole",
                leaders: [],
                isSettled: false
            ))
        }

        let headline: String
        let counts = skinCounts.sorted {
            ($0.value, -snapshot.orderIndex(of: $0.key)) > ($1.value, -snapshot.orderIndex(of: $1.key))
        }
        if counts.isEmpty {
            headline = unitsRiding > 1 ? "\(unitsRiding) skins riding" : "No skins yet"
        } else {
            var parts = counts.map { "\(snapshot.shortName($0.key)) \($0.value)" }
            if unitsRiding > 1 { parts.append("\(unitsRiding) riding") }
            headline = parts.joined(separator: " · ")
        }

        return BetEvaluation(
            betID: bet.id,
            betName: bet.name,
            kindName: "Skins",
            headline: headline,
            lines: lines,
            settled: balances,
            projected: balances, // a skin not yet awarded projects to no one
            events: events,
            detail: .skins(SkinsEvaluation(outcomes: outcomes, unitsRiding: unitsRiding, skinCounts: skinCounts))
        )
    }
}
