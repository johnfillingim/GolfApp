import Foundation

/// Wolf: the tee order rotates a "wolf" each hole. After watching tee shots
/// the wolf either picks a partner (2 vs rest, best ball) or goes lone for a
/// multiplier; declaring blind before anyone tees off earns a bigger one.
///
/// Money is **pairwise per hole**: every member of the losing team pays
/// `stakePerHole × multiplier × carried units` to every member of the winning
/// team. Pairwise transfers are zero-sum for any team split, including the
/// lone wolf's 1-vs-N.
///
/// Rules encoded here:
/// - The wolf on the Nth hole this bet covers is `rotation[(N-1) % count]`
///   (tee order wraps, so on 18 holes with 4 players, holes 17–18 come back
///   around to players 1–2).
/// - A hole is `pending` until the wolf has declared *and* every active
///   player has a score. With `carryTies` on, an unresolved hole freezes the
///   ones after it (their value depends on the carry).
/// - If the wolf has withdrawn (or fewer than 2 opponents remain), the hole
///   is void; any carried units ride through to the next live hole.
/// - Halved holes: units carry when `carryTies` is on, otherwise the hole
///   simply pushes.
public enum WolfEngine {

    public static func evaluate(bet: Bet, config: WolfConfig, snapshot: RoundSnapshot) -> BetEvaluation {
        let allHoles = snapshot.holeNumbers
        let firstHole = config.firstHole ?? allHoles.first ?? 1
        let holes = allHoles.filter { $0 >= firstHole }

        let participants = config.rotation.compactMap { snapshot.player($0) }
        let courseHoles = snapshot.holeNumbers.compactMap { snapshot.course.hole($0) }
        let strokes = StrokeAllocator.table(
            for: participants, holes: courseHoles,
            mode: config.handicapMode, allowance: .full
        )

        func net(_ player: PlayerID, _ hole: Int) -> Int? {
            guard let gross = snapshot.gross(player, hole: hole) else { return nil }
            return gross - (strokes[player]?[hole] ?? 0)
        }

        var holeLines: [WolfEvaluation.HoleLine] = []
        var balances: [PlayerID: Money] = [:]
        var events: [ScoringEvent] = []
        var units = 1
        var frozen = false

        for (index, hole) in holes.enumerated() {
            let expectedWolf = config.rotation[index % config.rotation.count]
            let decision = snapshot.events.wolfDecisions.first { $0.betID == bet.id && $0.hole == hole }

            if frozen {
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: decision?.choice, outcome: .pending))
                continue
            }

            let active = snapshot.activePlayers(of: config.rotation, atHole: hole)

            // Void: wolf gone, or not enough opposition for a game.
            guard snapshot.isActive(expectedWolf, atHole: hole), active.count >= 3 || (active.count == 2 && active.contains(expectedWolf)) else {
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: nil, outcome: .void))
                continue
            }

            // Need the wolf's declaration first.
            guard let decision, decision.wolf == expectedWolf else {
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: nil, outcome: .pending))
                if config.carryTies { frozen = true }
                continue
            }

            // Build teams.
            var wolfTeam = [expectedWolf]
            let multiplier: Int
            switch decision.choice {
            case .partner(let partner):
                guard partner != expectedWolf,
                      config.rotation.contains(partner),
                      snapshot.isActive(partner, atHole: hole)
                else {
                    // Corrupt / stale pick — treat as undeclared.
                    holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: decision.choice, outcome: .pending))
                    if config.carryTies { frozen = true }
                    continue
                }
                wolfTeam.append(partner)
                multiplier = 1
            case .lone:
                multiplier = config.loneMultiplier
            case .blindLone:
                multiplier = config.blindMultiplier
            }

            let opponents = active.filter { !wolfTeam.contains($0) }
            guard !opponents.isEmpty else {
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: decision.choice, outcome: .void))
                continue
            }

            // Everyone active must have posted.
            let wolfNets = wolfTeam.compactMap { net($0, hole) }
            let oppNets = opponents.compactMap { net($0, hole) }
            guard wolfNets.count == wolfTeam.count, oppNets.count == opponents.count else {
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: decision.choice, outcome: .pending))
                if config.carryTies { frozen = true }
                continue
            }

            let wolfBest = wolfNets.min()!
            let oppBest = oppNets.min()!
            let amount = config.stakePerHole * multiplier * units

            if wolfBest < oppBest {
                balances.add(Transfers.pairwise(payees: wolfTeam, payers: opponents, amount: amount))
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: decision.choice, outcome: .wolfTeamWon(multiplier: multiplier, units: units)))
                if multiplier > 1 {
                    events.append(ScoringEvent(
                        id: "\(bet.id)-wolf-\(hole)",
                        kind: .wolfWon(multiplier: multiplier),
                        betID: bet.id,
                        players: [expectedWolf],
                        hole: hole,
                        amount: amount * opponents.count
                    ))
                }
                units = 1
            } else if oppBest < wolfBest {
                balances.add(Transfers.pairwise(payees: opponents, payers: wolfTeam, amount: amount))
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: decision.choice, outcome: .othersWon(multiplier: multiplier, units: units)))
                units = 1
            } else {
                let carried = config.carryTies
                if carried { units += 1 }
                holeLines.append(.init(hole: hole, wolf: expectedWolf, choice: decision.choice, outcome: .halved(carried: carried)))
            }
        }

        let roundComplete = !holeLines.contains { $0.outcome == .pending }
        let unitsRiding = roundComplete ? 0 : units

        // Standings rows: money order, best first.
        let ordered = config.rotation.sorted {
            (balances[$0, default: .zero].cents, -snapshot.orderIndex(of: $0))
                > (balances[$1, default: .zero].cents, -snapshot.orderIndex(of: $1))
        }
        var lines: [StandingLine] = ordered.map { player in
            let money = balances[player, default: .zero]
            return StandingLine(
                id: "\(bet.id)-row-\(player)",
                title: snapshot.shortName(player),
                status: money.description,
                leaders: money.isPositive ? [player] : [],
                isSettled: roundComplete
            )
        }
        if unitsRiding > 1 {
            lines.append(StandingLine(
                id: "\(bet.id)-riding",
                title: "Carrying",
                status: "\(unitsRiding)× next hole",
                leaders: [],
                isSettled: false
            ))
        }

        let played = holeLines.filter {
            switch $0.outcome {
            case .wolfTeamWon, .othersWon, .halved: return true
            case .pending, .void: return false
            }
        }.count

        let headline: String
        if let top = ordered.first, balances[top, default: .zero].isPositive {
            headline = "\(snapshot.shortName(top)) +\(balances[top, default: .zero]) thru \(played) hole\(played == 1 ? "" : "s")"
        } else if played == 0 {
            headline = "Waiting on the first pick"
        } else {
            headline = "All square thru \(played)"
        }

        return BetEvaluation(
            betID: bet.id,
            betName: bet.name,
            kindName: "Wolf",
            headline: headline,
            lines: lines,
            settled: balances,
            projected: balances, // hole results are final as they happen
            events: events,
            detail: .wolf(WolfEvaluation(holes: holeLines, unitsRiding: unitsRiding, points: balances))
        )
    }
}
