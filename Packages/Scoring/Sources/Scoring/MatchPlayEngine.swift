import Foundation

/// Head-to-head (or team best-ball) match play over the whole round.
/// Tracks holes up/down/halved, dormie, and closes the match the moment it
/// is mathematically decided ("4&3"). All the hole logic lives in
/// `MatchEngine`; this engine adds money and presentation.
public enum MatchPlayEngine {

    public static func evaluate(bet: Bet, config: MatchPlayConfig, snapshot: RoundSnapshot) -> BetEvaluation {
        let comp = MatchEngine.compute(
            sideA: config.sideA,
            sideB: config.sideB,
            holes: snapshot.holeNumbers,
            snapshot: snapshot,
            mode: config.handicapMode,
            allowance: config.allowance
        )

        let status = comp.status
        let decided = status.closed || status.remaining == 0

        var settled: [PlayerID: Money] = [:]
        var projected: [PlayerID: Money] = [:]
        var events: [ScoringEvent] = []

        if decided, let winner = status.winner {
            let transfer = Transfers.perLoserStake(
                winners: config.members(of: winner),
                losers: config.members(of: winner.opponent),
                stakePerLoser: config.stakePerPlayer
            )
            settled.add(transfer)
            projected.add(transfer)
            events.append(ScoringEvent(
                id: "\(bet.id)-closed",
                kind: .matchClosed(margin: status.display),
                betID: bet.id,
                players: config.members(of: winner),
                hole: status.thruHole,
                amount: config.stakePerPlayer * config.members(of: winner.opponent).count
            ))
        } else if !decided, let leader = status.leader {
            projected.add(Transfers.perLoserStake(
                winners: config.members(of: leader),
                losers: config.members(of: leader.opponent),
                stakePerLoser: config.stakePerPlayer
            ))
        }

        let leaderSide = status.winner ?? status.leader
        let headline: String
        if let side = leaderSide {
            headline = "\(snapshot.sideName(config.members(of: side))) \(status.display)"
        } else {
            headline = status.display
        }

        let line = StandingLine(
            id: "\(bet.id)-match",
            title: "\(snapshot.sideName(config.sideA)) vs \(snapshot.sideName(config.sideB))",
            status: headline,
            leaders: leaderSide.map { config.members(of: $0) } ?? [],
            isSettled: decided
        )

        return BetEvaluation(
            betID: bet.id,
            betName: bet.name,
            kindName: "Match Play",
            headline: headline,
            lines: [line],
            settled: settled,
            projected: projected,
            events: events,
            detail: .matchPlay(MatchPlayEvaluation(match: comp))
        )
    }
}
