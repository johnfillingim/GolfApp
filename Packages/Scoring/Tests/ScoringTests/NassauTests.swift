import XCTest
@testable import Scoring

/// The full worked Nassau example. Jack vs Jill, $5 per man, gross,
/// auto-press at 2 down.
///
/// Hole-by-hole winners from Jack's perspective (W win / L loss / H halve):
///
///   Front:  L L H L W H H H H   → Jill wins 2&1 (closes at hole 8)
///   Back:   W W H W H H H H H   → Jack wins 3&2 (closes at hole 16)
///   Total:  net +1 for Jack     → Jack wins 1 UP on 18
///
/// Press timeline the engine must derive:
///   • Front, auto: Jack falls 2 down at hole 2 → press from hole 3.
///     That press runs H L W H H H H → halved (no money). Jack later falls
///     3 down on the *original* (hole 4) — no new press, because auto-press
///     watches the most recent bet, which is the hole-3 press.
///   • Back, auto: Jill falls 2 down at hole 11 → press from hole 12.
///     It ends +1 Jack → Jack wins $5.
///   • Back, manual: Jill presses again from hole 16 (event) → halved.
///
/// Money: Jack −5 (front) +5 (back) +5 (back press) +5 (total) = **+$10**.
final class NassauTests: XCTestCase {

    private let jackCard: [Int?] = [5, 5, 3, 5, 4, 4, 4, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4].optional
    private let jillCard: [Int?] = [4, 4, 3, 4, 5, 4, 4, 5, 4, 5, 4, 5, 5, 4, 5, 3, 4, 4].optional

    private func makeBet() -> Bet {
        Bet(
            id: UUID(uuidString: "AAAAAAAA-0000-0000-0000-000000000001")!,
            name: "The Usual",
            kind: .nassau(NassauConfig(
                sideA: [Fixtures.jackID],
                sideB: [Fixtures.jillID],
                stakePerPlayer: .dollars(5),
                handicapMode: .gross,
                allowance: .offLow,
                autoPressTrigger: 2
            ))
        )
    }

    private func evaluate(throughHole lastHole: Int = 18, manualPress: Bool = true) -> BetEvaluation {
        let bet = makeBet()
        let events = manualPress
            ? RoundEvents(presses: [PressEvent(betID: bet.id, segment: .back, firstHole: 16, pressedBy: .b)])
            : RoundEvents()
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill()],
            scores: [
                Fixtures.jackID: Array(jackCard.prefix(lastHole)),
                Fixtures.jillID: Array(jillCard.prefix(lastHole)),
            ],
            events: events
        )
        return BetEvaluator.evaluate(bet, snapshot: snapshot)
    }

    func testWorkedExampleMoney() {
        let eval = evaluate()
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(10))
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(-10))
        // Round over: projection equals settlement.
        XCTAssertEqual(eval.projected[Fixtures.jackID], .dollars(10))
        XCTAssertEqual(eval.settled.totalCents, 0)
    }

    func testWorkedExampleLines() {
        let eval = evaluate()
        guard case .nassau(let detail) = eval.detail else {
            return XCTFail("expected nassau detail")
        }
        XCTAssertEqual(detail.pressCount, 3)

        let front = detail.segments.first { $0.segment == .front }!
        XCTAssertEqual(front.bets.count, 2)
        XCTAssertEqual(front.bets[0].match.status.display, "2&1")
        XCTAssertEqual(front.bets[0].match.status.winner, .b)
        XCTAssertEqual(front.bets[1].firstHole, 3)
        XCTAssertTrue(front.bets[1].isAutoPress)
        XCTAssertEqual(front.bets[1].match.status.display, "Halved")

        let back = detail.segments.first { $0.segment == .back }!
        XCTAssertEqual(back.bets.count, 3)
        XCTAssertEqual(back.bets[0].match.status.display, "3&2")
        XCTAssertEqual(back.bets[0].match.status.winner, .a)
        XCTAssertEqual(back.bets[1].firstHole, 12)
        XCTAssertTrue(back.bets[1].isAutoPress)
        XCTAssertEqual(back.bets[1].match.status.display, "1 UP")
        XCTAssertEqual(back.bets[1].match.status.winner, .a)
        XCTAssertEqual(back.bets[2].firstHole, 16)
        XCTAssertTrue(back.bets[2].isPress)
        XCTAssertFalse(back.bets[2].isAutoPress)
        XCTAssertEqual(back.bets[2].match.status.display, "Halved")

        let total = detail.segments.first { $0.segment == .total }!
        XCTAssertEqual(total.bets.count, 1, "no auto-press on the overall 18")
        XCTAssertEqual(total.bets[0].match.status.display, "1 UP")
        XCTAssertEqual(total.bets[0].match.status.winner, .a)
    }

    func testWorkedExampleEvents() {
        let eval = evaluate()
        let betID = makeBet().id

        let pressEvents = eval.events.filter {
            if case .pressStarted = $0.kind { return true }
            return false
        }
        XCTAssertEqual(pressEvents.count, 3)
        XCTAssertTrue(eval.events.contains { $0.id == "\(betID)-press-front-3" && $0.kind == .pressStarted(auto: true) })
        XCTAssertTrue(eval.events.contains { $0.id == "\(betID)-press-back-12" && $0.kind == .pressStarted(auto: true) })
        XCTAssertTrue(eval.events.contains { $0.id == "\(betID)-press-back-16" && $0.kind == .pressStarted(auto: false) })

        // All three segments decided, with the right winners.
        XCTAssertTrue(eval.events.contains { $0.id == "\(betID)-front-final" && $0.players == [Fixtures.jillID] })
        XCTAssertTrue(eval.events.contains { $0.id == "\(betID)-back-final" && $0.players == [Fixtures.jackID] })
        XCTAssertTrue(eval.events.contains { $0.id == "\(betID)-total-final" && $0.players == [Fixtures.jackID] })
    }

    func testMidRoundProjection() {
        // Through 6 holes: Jill leads the front 2 up and the total 2 up; the
        // front press is all square. Nothing is settled yet; projection has
        // Jill +$10 (front + total).
        let eval = evaluate(throughHole: 6, manualPress: false)
        XCTAssertTrue(eval.settled.isEmpty)
        XCTAssertEqual(eval.projected[Fixtures.jillID], .dollars(10))
        XCTAssertEqual(eval.projected[Fixtures.jackID], .dollars(-10))
    }

    func testNineHoleRoundCollapsesToSingleMatch() {
        let bet = Bet(
            name: "Nine",
            kind: .nassau(NassauConfig(
                sideA: [Fixtures.jackID],
                sideB: [Fixtures.jillID],
                stakePerPlayer: .dollars(5),
                handicapMode: .gross,
                autoPressTrigger: 2
            ))
        )
        // Jill wins holes 1–2, everything else halved.
        let snapshot = RoundSnapshot(
            course: Fixtures.course9(),
            players: [Fixtures.jack(), Fixtures.jill()],
            scores: Fixtures.scores([
                Fixtures.jackID: [5, 5, 4, 4, 4, 4, 4, 4, 4].optional,
                Fixtures.jillID: [4, 4, 4, 4, 4, 4, 4, 4, 4].optional,
            ])
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .nassau(let detail) = eval.detail else {
            return XCTFail("expected nassau detail")
        }
        // One segment ("Match"), with the auto-press still active on it.
        XCTAssertEqual(detail.segments.count, 1)
        XCTAssertEqual(detail.segments[0].segment, .total)
        XCTAssertEqual(detail.segments[0].bets.count, 2)
        XCTAssertTrue(detail.segments[0].bets[1].isAutoPress)
        // Original: Jill closes 2&1; press from hole 3 halves. Net Jill +$5.
        XCTAssertEqual(eval.settled[Fixtures.jillID], .dollars(5))
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(-5))
    }

    func testNoAutoPressWhenDisabled() {
        var config = NassauConfig(
            sideA: [Fixtures.jackID],
            sideB: [Fixtures.jillID],
            stakePerPlayer: .dollars(5),
            handicapMode: .gross
        )
        config.autoPressTrigger = nil
        let bet = Bet(name: "No presses", kind: .nassau(config))
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill()],
            scores: [Fixtures.jackID: jackCard, Fixtures.jillID: jillCard]
        )
        let eval = BetEvaluator.evaluate(bet, snapshot: snapshot)
        guard case .nassau(let detail) = eval.detail else {
            return XCTFail("expected nassau detail")
        }
        XCTAssertEqual(detail.pressCount, 0)
        // Original three bets only: front Jill, back Jack, total Jack → Jack +$5.
        XCTAssertEqual(eval.settled[Fixtures.jackID], .dollars(5))
    }
}
