import XCTest
@testable import Scoring

final class StrokePlayTests: XCTestCase {

    private func makeBet(mode: HandicapMode = .net, players: [PlayerID], ante: Money = .dollars(10)) -> Bet {
        Bet(name: "Medal", kind: .strokePlay(StrokePlayConfig(players: players, ante: ante, handicapMode: mode)))
    }

    /// Jack (0) shoots even 72; Jill (9) shoots 80 → net 71; Bob (18) shoots
    /// 89 → net 71. Jill and Bob split the $30 pot.
    func testNetTieSplitsPot() {
        let players = [Fixtures.jack(0), Fixtures.jill(9), Fixtures.bob(18)]
        let bet = makeBet(players: players.map(\.id))

        let pars = Fixtures.pars
        let jackCard = pars                                     // 72
        let jillCard = pars.enumerated().map { $0.offset < 8 ? $0.element + 1 : $0.element }   // 80
        let bobCard = pars.enumerated().map { $0.offset < 17 ? $0.element + 1 : $0.element }   // 89

        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [
                Fixtures.jackID: jackCard.optional,
                Fixtures.jillID: jillCard.optional,
                Fixtures.bobID: bobCard.optional,
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .strokePlay(let detail) = eval.detail else { return XCTFail("expected stroke play detail") }

        XCTAssertTrue(detail.isFinal)
        XCTAssertEqual(detail.pot, .dollars(30))
        XCTAssertEqual(detail.rows[0].player, Fixtures.jillID, "tie broken by tee order for display")
        XCTAssertEqual(detail.rows[0].toPar, -1)
        XCTAssertEqual(detail.rows[1].toPar, -1)

        // Winners net +$5 each (+$15 pot share − $10 ante); Jack loses his ante.
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(5))
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(5))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(-10))
    }

    func testLiveLeaderboardComparesToParThru() {
        let players = [Fixtures.jack(0), Fixtures.jill(0), Fixtures.bob(0)]
        let bet = makeBet(mode: .gross, players: players.map(\.id))
        // Jack: even thru 3. Jill: −1 thru 2. Bob: nothing yet.
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [
                Fixtures.jackID: [4, 5, 3].optional,
                Fixtures.jillID: [3, 5].optional,
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .strokePlay(let detail) = eval.detail else { return XCTFail("expected stroke play detail") }

        XCTAssertFalse(detail.isFinal)
        XCTAssertEqual(detail.rows.map(\.player), [Fixtures.jillID, Fixtures.jackID, Fixtures.bobID])
        XCTAssertTrue(eval.settled.isEmpty)
        // Jill leads: projected +$20 (pot 30 − ante 10); everyone else −$10.
        XCTAssertEqual(eval.projected[Fixtures.jillID], .dollars(20))
        XCTAssertEqual(eval.projected[Fixtures.jackID], .dollars(-10))
        XCTAssertEqual(eval.projected[Fixtures.bobID], .dollars(-10))
    }

    func testWithdrawnPlayerForfeitsAnte() {
        let players = [Fixtures.jack(0), Fixtures.jill(9), Fixtures.bob(18)]
        let bet = makeBet(players: players.map(\.id))

        let pars = Fixtures.pars
        let jillCard = pars.enumerated().map { $0.offset < 8 ? $0.element + 1 : $0.element }
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [
                Fixtures.jackID: pars.optional,
                Fixtures.jillID: jillCard.optional,
                Fixtures.bobID: Array(pars.prefix(9)).optional,
            ],
            withdrawals: [Fixtures.bobID: 9]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .strokePlay(let detail) = eval.detail else { return XCTFail("expected stroke play detail") }

        XCTAssertTrue(detail.isFinal, "a withdrawal must not block finality")
        XCTAssertEqual(detail.rows.last?.player, Fixtures.bobID)
        XCTAssertTrue(detail.rows.last!.isWithdrawn)
        // Jill nets 71 (−1) and beats Jack's 72; the pot still includes Bob's ante.
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(20))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(-10))
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(-10))
    }

    func testGrossModeUsesGrossTotals() {
        let players = [Fixtures.jack(0), Fixtures.jill(9)]
        let bet = makeBet(mode: .gross, players: players.map(\.id))
        let pars = Fixtures.pars
        let jillCard = pars.enumerated().map { $0.offset < 8 ? $0.element + 1 : $0.element }
        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [
                Fixtures.jackID: pars.optional,
                Fixtures.jillID: jillCard.optional,
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        XCTAssertEqual(eval.kindName, "Gross Stroke Play")
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(10))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(-10))
    }
}
