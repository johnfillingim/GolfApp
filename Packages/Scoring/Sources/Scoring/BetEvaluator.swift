import Foundation

/// Front door of the scoring module: turns (bet, snapshot) into a
/// `BetEvaluation`. Pure and deterministic — same inputs, same standings,
/// on every phone in the group.
public enum BetEvaluator {

    public static func evaluate(_ bet: Bet, snapshot: RoundSnapshot) -> BetEvaluation {
        let evaluation: BetEvaluation
        switch bet.kind {
        case .nassau(let config):
            evaluation = NassauEngine.evaluate(bet: bet, config: config, snapshot: snapshot)
        case .skins(let config):
            evaluation = SkinsEngine.evaluate(bet: bet, config: config, snapshot: snapshot)
        case .matchPlay(let config):
            evaluation = MatchPlayEngine.evaluate(bet: bet, config: config, snapshot: snapshot)
        case .wolf(let config):
            evaluation = WolfEngine.evaluate(bet: bet, config: config, snapshot: snapshot)
        case .strokePlay(let config):
            evaluation = StrokePlayEngine.evaluate(bet: bet, config: config, snapshot: snapshot)
        }

        // The invariant every engine must uphold: money only moves between
        // players. If this ever fires, an engine is inventing or destroying
        // dollars.
        assert(evaluation.settled.totalCents == 0,
               "\(evaluation.kindName) settled balances leak \(evaluation.settled.totalCents)¢")
        assert(evaluation.projected.totalCents == 0,
               "\(evaluation.kindName) projected balances leak \(evaluation.projected.totalCents)¢")

        return evaluation
    }

    public static func evaluateAll(_ bets: [Bet], snapshot: RoundSnapshot) -> [BetEvaluation] {
        bets.map { evaluate($0, snapshot: snapshot) }
    }
}
