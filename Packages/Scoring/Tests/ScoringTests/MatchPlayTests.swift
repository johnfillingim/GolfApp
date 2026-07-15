import XCTest
@testable import Scoring

final class MatchPlayTests: XCTestCase {

    private let betID = UUID(uuidString: "DDDDDDDD-0000-0000-0000-000000000001")!

    func testTeamCloseoutPaysPerMan() {
        // Jack & Jill vs Bob & Sue, $10 per man, gross best ball.
        // Side A's best ball (Jack's 3) beats side B's 4 on ten straight
        // holes: 10 up with 8 to play → closed 10&8.
        let bet = Bet(id: betID, name: "The Grudge", kind: .matchPlay(MatchPlayConfig(
            sideA: [Fixtures.jackID, Fixtures.jillID],
            sideB: [Fixtures.bobID, Fixtures.sueID],
            stakePerPlayer: .dollars(10),
            handicapMode: .gross
        )))
        let ten = Array(repeating: 3, count: 10)
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill(), Fixtures.bob(), Fixtures.sue()],
            scores: [
                Fixtures.jackID: ten.optional,
                Fixtures.jillID: Array(repeating: 5, count: 10).optional,
                Fixtures.bobID: Array(repeating: 4, count: 10).optional,
                Fixtures.sueID: Array(repeating: 4, count: 10).optional,
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .matchPlay(let detail) = eval.detail else { return XCTFail("expected match play detail") }

        XCTAssertTrue(detail.match.status.closed)
        XCTAssertEqual(detail.match.status.display, "10&8")
        // Per man: each loser pays $10; each winner collects $10.
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(10))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(10))
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(-10))
        XCTAssertEqual(eval.settled[Fixtures.sueID], .dollars(-10))
        XCTAssertTrue(eval.events.contains {
            $0.id == "\(betID)-closed" && $0.kind == .matchClosed(margin: "10&8")
        })
    }

    func testOpenMatchProjectsForLeader() {
        let bet = Bet(name: "Singles", kind: .matchPlay(MatchPlayConfig(
            sideA: [Fixtures.jackID],
            sideB: [Fixtures.jillID],
            stakePerPlayer: .dollars(10),
            handicapMode: .gross
        )))
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill()],
            scores: [
                Fixtures.jackID: [4, 4, 4].optional,
                Fixtures.jillID: [5, 5, 5].optional,
            ]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        XCTAssertTrue(eval.settled.isEmpty)
        XCTAssertEqual(eval.projected[Fixtures.jackID], .dollars(10))
        XCTAssertEqual(eval.projected[Fixtures.jillID], .dollars(-10))
        XCTAssertTrue(eval.headline.contains("3 UP thru 3"))
    }

    func testHalvedMatchMovesNoMoney() {
        let bet = Bet(name: "Singles", kind: .matchPlay(MatchPlayConfig(
            sideA: [Fixtures.jackID],
            sideB: [Fixtures.jillID],
            stakePerPlayer: .dollars(10),
            handicapMode: .gross
        )))
        let card = Array(repeating: 4, count: 18).optional
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill()],
            scores: [Fixtures.jackID: card, Fixtures.jillID: card]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        XCTAssertTrue(eval.settled.isEmpty)
        XCTAssertTrue(eval.projected.isEmpty)
        XCTAssertEqual(eval.headline, "Halved")
    }
}
