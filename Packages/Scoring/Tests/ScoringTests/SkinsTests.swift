import XCTest
@testable import Scoring

final class SkinsTests: XCTestCase {

    private let betID = UUID(uuidString: "BBBBBBBB-0000-0000-0000-000000000001")!

    private func makeBet(carryover: Bool = true, validation: Bool = false, mode: HandicapMode = .gross, players: [PlayerID]) -> Bet {
        Bet(id: betID, name: "Skins", kind: .skins(SkinsConfig(
            players: players,
            stakePerHole: .dollars(2),
            handicapMode: mode,
            carryover: carryover,
            requireValidation: validation
        )))
    }

    private func fourPlayers() -> [ScoringPlayer] {
        [Fixtures.jack(), Fixtures.jill(), Fixtures.bob(), Fixtures.sue()]
    }

    /// Worked example: hole 1 ties (carry), hole 2 Bob wins two skins,
    /// hole 3 is missing Sue's score → the carry chain freezes.
    func testCarryoverChainAndFreeze() {
        let bet = makeBet(players: fourPlayers().map(\.id))
        let snapshot = Fixtures.snapshot(
            players: fourPlayers(),
            scores: [
                Fixtures.jackID: [4, 4, 4, 3].optional,
                Fixtures.jillID: [4, 4, 4, 4].optional,
                Fixtures.bobID: [5, 3, 4, 4].optional,
                Fixtures.sueID: [5, 4, nil, 4],
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .skins(let detail) = eval.detail else { return XCTFail("expected skins detail") }

        XCTAssertEqual(detail.outcomes[0].outcome, .carried)
        XCTAssertEqual(detail.outcomes[1].outcome, .won(winner: Fixtures.bobID, units: 2, perPlayer: .dollars(4)))
        XCTAssertEqual(detail.outcomes[2].outcome, .pending)
        // Hole 4 has all four scores, but carryover makes it depend on hole 3.
        XCTAssertEqual(detail.outcomes[3].outcome, .pending)

        // Bob collects 2 units × $2 from each of three players.
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(12))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(-4))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(-4))
        XCTAssertEqual(eval.settled[Fixtures.sueID], .dollars(-4))
        XCTAssertEqual(detail.skinCounts, [Fixtures.bobID: 2])
        XCTAssertTrue(eval.events.contains { $0.id == "\(betID)-skin-2" && $0.kind == .skinWon(units: 2) })
    }

    /// Completing the frozen hole releases the chain: hole 3 ties, so hole 4
    /// is worth two skins to Jack.
    func testFreezeReleasesWhenScorePosts() {
        let bet = makeBet(players: fourPlayers().map(\.id))
        let snapshot = Fixtures.snapshot(
            players: fourPlayers(),
            scores: [
                Fixtures.jackID: [4, 4, 4, 3].optional,
                Fixtures.jillID: [4, 4, 4, 4].optional,
                Fixtures.bobID: [5, 3, 4, 4].optional,
                Fixtures.sueID: [5, 4, 4, 4].optional,
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .skins(let detail) = eval.detail else { return XCTFail("expected skins detail") }

        XCTAssertEqual(detail.outcomes[2].outcome, .carried)
        XCTAssertEqual(detail.outcomes[3].outcome, .won(winner: Fixtures.jackID, units: 2, perPlayer: .dollars(4)))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(8))   // −4 on hole 2, +12 on hole 4
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(8))    // +12 on hole 2, −4 on hole 4
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(-8))
        XCTAssertEqual(eval.settled[Fixtures.sueID], .dollars(-8))
        XCTAssertEqual(detail.skinCounts[Fixtures.jackID], 2)
    }

    func testNoCarryoverModeIsIndependentPerHole() {
        let bet = makeBet(carryover: false, players: fourPlayers().map(\.id))
        let snapshot = Fixtures.snapshot(
            players: fourPlayers(),
            scores: [
                Fixtures.jackID: [4, 4, 4, 3].optional,
                Fixtures.jillID: [4, 4, 4, 4].optional,
                Fixtures.bobID: [5, 3, 4, 4].optional,
                Fixtures.sueID: [5, 4, nil, 4],
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .skins(let detail) = eval.detail else { return XCTFail("expected skins detail") }

        XCTAssertEqual(detail.outcomes[0].outcome, .dead, "tie without carryover kills the skin")
        XCTAssertEqual(detail.outcomes[1].outcome, .won(winner: Fixtures.bobID, units: 1, perPlayer: .dollars(2)))
        XCTAssertEqual(detail.outcomes[2].outcome, .pending)
        // Hole 4 resolves immediately — no chain dependency without carryover.
        XCTAssertEqual(detail.outcomes[3].outcome, .won(winner: Fixtures.jackID, units: 1, perPlayer: .dollars(2)))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(4))   // −2 + 6
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(4))
    }

    /// Validation: a hole "won" over par is a tie. Hole 1 (par 4) is won
    /// with a 5 → carried; hole 2 (par 5) won with a birdie 4 → two skins.
    func testValidationRequiresParOrBetter() {
        let players = [Fixtures.jack(), Fixtures.jill(), Fixtures.bob()]
        let bet = makeBet(validation: true, players: players.map(\.id))
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [
                Fixtures.jackID: [5, 4].optional,
                Fixtures.jillID: [6, 5].optional,
                Fixtures.bobID: [6, 5].optional,
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .skins(let detail) = eval.detail else { return XCTFail("expected skins detail") }

        XCTAssertEqual(detail.outcomes[0].outcome, .carried, "bogey can't validate a skin")
        XCTAssertEqual(detail.outcomes[1].outcome, .won(winner: Fixtures.jackID, units: 2, perPlayer: .dollars(4)))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(8))
    }

    func testNetSkinsAppliesStrokes() {
        // Jill gets a stroke on every hole at 18; identical gross 4s on hole 1
        // make her net 3 the winner.
        let players = [Fixtures.jack(0), Fixtures.jill(18)]
        let bet = makeBet(mode: .net, players: players.map(\.id))
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [
                Fixtures.jackID: [4],
                Fixtures.jillID: [4],
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(2))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(-2))
    }

    func testWithdrawnPlayerStopsPayingAndWinning() {
        let players = [Fixtures.jack(), Fixtures.jill(), Fixtures.bob()]
        let bet = makeBet(players: players.map(\.id))
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [
                Fixtures.jackID: [4, 3].optional,
                Fixtures.jillID: [4, 4].optional,
                Fixtures.bobID: [3].optional,
            ],
            withdrawals: [Fixtures.bobID: 1]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        // Hole 1: Bob wins while still in → +$4 from the other two.
        // Hole 2: only Jack & Jill active; Jack wins $2 from Jill alone.
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(4))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(0))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(-4))
    }

    func testFewerThanTwoActivePlayersIsVoid() {
        let players = [Fixtures.jack(), Fixtures.jill()]
        let bet = makeBet(players: players.map(\.id))
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [Fixtures.jackID: [4, 4].optional, Fixtures.jillID: [5].optional],
            withdrawals: [Fixtures.jillID: 1]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .skins(let detail) = eval.detail else { return XCTFail("expected skins detail") }
        XCTAssertEqual(detail.outcomes[0].outcome, .won(winner: Fixtures.jackID, units: 1, perPlayer: .dollars(2)))
        XCTAssertEqual(detail.outcomes[1].outcome, .void)
    }

    func testRidingUnitsSurfaceMidRound() {
        let players = [Fixtures.jack(), Fixtures.jill()]
        let bet = makeBet(players: players.map(\.id))
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [Fixtures.jackID: [4, 4].optional, Fixtures.jillID: [4, 4].optional]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .skins(let detail) = eval.detail else { return XCTFail("expected skins detail") }
        XCTAssertEqual(detail.unitsRiding, 3, "two carried ties put three skins on hole 3")
        XCTAssertTrue(eval.headline.contains("3 skins riding"))
    }
}
