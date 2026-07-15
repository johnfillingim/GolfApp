import XCTest
@testable import Scoring

final class WolfTests: XCTestCase {

    private let betID = UUID(uuidString: "CCCCCCCC-0000-0000-0000-000000000001")!
    private let rotation = [Fixtures.jackID, Fixtures.jillID, Fixtures.bobID, Fixtures.sueID]

    private func makeBet(carryTies: Bool = false) -> Bet {
        Bet(id: betID, name: "Wolf", kind: .wolf(WolfConfig(
            rotation: rotation,
            stakePerHole: .dollars(1),
            handicapMode: .gross,
            loneMultiplier: 2,
            blindMultiplier: 3,
            carryTies: carryTies
        )))
    }

    private func players() -> [ScoringPlayer] {
        [Fixtures.jack(), Fixtures.jill(), Fixtures.bob(), Fixtures.sue()]
    }

    /// Worked example over four holes:
    ///  H1 Jack (wolf) takes Sue as partner and they win     → ±$1 pairwise
    ///  H2 Jill goes lone and wins                           → +$6 at 2×
    ///  H3 Bob goes lone and loses                           → −$6 at 2×
    ///  H4 Sue goes blind and the hole halves                → push
    ///  H5 Jack is wolf again (rotation wraps) — undeclared  → pending
    func testWorkedExample() {
        let bet = makeBet()
        let events = RoundEvents(wolfDecisions: [
            WolfDecision(betID: betID, hole: 1, wolf: Fixtures.jackID, choice: .partner(Fixtures.sueID)),
            WolfDecision(betID: betID, hole: 2, wolf: Fixtures.jillID, choice: .lone),
            WolfDecision(betID: betID, hole: 3, wolf: Fixtures.bobID, choice: .lone),
            WolfDecision(betID: betID, hole: 4, wolf: Fixtures.sueID, choice: .blindLone),
        ])
        let snapshot = Fixtures.snapshot(
            players: players(),
            scores: [
                Fixtures.jackID: [4, 4, 4, 4].optional,
                Fixtures.jillID: [5, 3, 4, 4].optional,
                Fixtures.bobID: [5, 4, 5, 4].optional,
                Fixtures.sueID: [5, 4, 4, 4].optional,
            ],
            events: events
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .wolf(let detail) = eval.detail else { return XCTFail("expected wolf detail") }

        XCTAssertEqual(detail.holes[0].outcome, .wolfTeamWon(multiplier: 1, units: 1))
        XCTAssertEqual(detail.holes[1].outcome, .wolfTeamWon(multiplier: 2, units: 1))
        XCTAssertEqual(detail.holes[2].outcome, .othersWon(multiplier: 2, units: 1))
        XCTAssertEqual(detail.holes[3].outcome, .halved(carried: false))
        XCTAssertEqual(detail.holes[4].outcome, .pending)
        XCTAssertEqual(detail.holes[4].wolf, Fixtures.jackID, "rotation wraps at hole 5")

        // Hand-computed balances:
        // Jack: +2 (h1) −2 (h2) +2 (h3)          = +2
        // Jill: −2 (h1) +6 (h2) +2 (h3)          = +6
        // Bob:  −2 (h1) −2 (h2) −6 (h3)          = −10
        // Sue:  +2 (h1) −2 (h2) +2 (h3)          = +2
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(2))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(6))
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(-10))
        XCTAssertEqual(eval.settled[Fixtures.sueID], .dollars(2))
        XCTAssertEqual(eval.settled.totalCents, 0)

        // The lone-wolf win is celebration-worthy; the loss is not.
        let wolfEvents = eval.events.filter {
            if case .wolfWon = $0.kind { return true }
            return false
        }
        XCTAssertEqual(wolfEvents.count, 1)
        XCTAssertEqual(wolfEvents[0].players, [Fixtures.jillID])
        XCTAssertEqual(wolfEvents[0].amount, .dollars(6))
    }

    func testBlindWolfTriplesTheStake() {
        let bet = makeBet()
        let events = RoundEvents(wolfDecisions: [
            WolfDecision(betID: betID, hole: 1, wolf: Fixtures.jackID, choice: .blindLone),
        ])
        let snapshot = Fixtures.snapshot(
            players: players(),
            scores: [
                Fixtures.jackID: [3],
                Fixtures.jillID: [4],
                Fixtures.bobID: [4],
                Fixtures.sueID: [4],
            ],
            events: events
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(9))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(-3))
    }

    func testCarriedTieDoublesNextHole() {
        let bet = makeBet(carryTies: true)
        let events = RoundEvents(wolfDecisions: [
            WolfDecision(betID: betID, hole: 1, wolf: Fixtures.jackID, choice: .partner(Fixtures.sueID)),
            WolfDecision(betID: betID, hole: 2, wolf: Fixtures.jillID, choice: .lone),
        ])
        let snapshot = Fixtures.snapshot(
            players: players(),
            scores: [
                Fixtures.jackID: [4, 4].optional,
                Fixtures.jillID: [4, 3].optional,
                Fixtures.bobID: [4, 4].optional,
                Fixtures.sueID: [4, 4].optional,
            ],
            events: events
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .wolf(let detail) = eval.detail else { return XCTFail("expected wolf detail") }
        XCTAssertEqual(detail.holes[0].outcome, .halved(carried: true))
        // Two units at 2× lone: Jill collects $4 from each of three players.
        XCTAssertEqual(detail.holes[1].outcome, .wolfTeamWon(multiplier: 2, units: 2))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(12))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(-4))
    }

    func testWithdrawnWolfVoidsHoleAndCarryRidesThrough() {
        let bet = makeBet(carryTies: true)
        let events = RoundEvents(wolfDecisions: [
            WolfDecision(betID: betID, hole: 1, wolf: Fixtures.jackID, choice: .partner(Fixtures.sueID)),
            WolfDecision(betID: betID, hole: 3, wolf: Fixtures.bobID, choice: .lone),
        ])
        let snapshot = Fixtures.snapshot(
            players: players(),
            scores: [
                Fixtures.jackID: [4, 4, 5].optional,
                Fixtures.jillID: [4].optional,
                Fixtures.bobID: [4, 4, 4].optional,
                Fixtures.sueID: [4, 4, 5].optional,
            ],
            withdrawals: [Fixtures.jillID: 1],
            events: events
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .wolf(let detail) = eval.detail else { return XCTFail("expected wolf detail") }
        XCTAssertEqual(detail.holes[0].outcome, .halved(carried: true))
        XCTAssertEqual(detail.holes[1].outcome, .void, "hole 2's wolf (Jill) has withdrawn")
        // Bob's lone win on hole 3 carries the units from hole 1: 2 units × 2×
        // × $1 from Jack and Sue (Jill is out).
        XCTAssertEqual(detail.holes[2].outcome, .wolfTeamWon(multiplier: 2, units: 2))
        XCTAssertEqual(eval.settled[Fixtures.bobID], .dollars(8))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(-4))
        XCTAssertEqual(eval.settled[Fixtures.sueID], .dollars(-4))
    }

    func testInvalidPartnerIsPending() {
        let bet = makeBet()
        let events = RoundEvents(wolfDecisions: [
            WolfDecision(betID: betID, hole: 1, wolf: Fixtures.jackID, choice: .partner(Fixtures.jackID)),
        ])
        let snapshot = Fixtures.snapshot(
            players: players(),
            scores: [
                Fixtures.jackID: [3],
                Fixtures.jillID: [4],
                Fixtures.bobID: [4],
                Fixtures.sueID: [4],
            ],
            events: events
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .wolf(let detail) = eval.detail else { return XCTFail("expected wolf detail") }
        XCTAssertEqual(detail.holes[0].outcome, .pending)
        XCTAssertTrue(eval.settled.values.allSatisfy(\.isZero))
    }
}
