import XCTest
@testable import Scoring

final class MatchEngineTests: XCTestCase {

    /// 1v1 gross over the front nine of the fixture course.
    private func compute(jack: [Int?], jill: [Int?], holes: [Int] = Array(1...9)) -> MatchComputation {
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill()],
            scores: [Fixtures.jackID: jack, Fixtures.jillID: jill]
        )
        return MatchEngine.compute(
            sideA: [Fixtures.jackID], sideB: [Fixtures.jillID],
            holes: holes, snapshot: snapshot, mode: .gross, allowance: .offLow
        )
    }

    func testRunningStatus() {
        // Jack wins 1 & 2, halves 3, loses 4.
        let comp = compute(
            jack: [4, 4, 3, 5].optional,
            jill: [5, 5, 3, 4].optional
        )
        XCTAssertEqual(comp.status.upA, 1)
        XCTAssertEqual(comp.status.holesDecided, 4)
        XCTAssertEqual(comp.status.remaining, 5)
        XCTAssertFalse(comp.status.closed)
        XCTAssertNil(comp.status.winner)
        XCTAssertEqual(comp.status.display, "1 UP thru 4")
    }

    func testDormie() {
        // Jack wins 1–3 then halves 4–6: 3 up, 3 to play.
        let comp = compute(
            jack: [4, 4, 3, 4, 4, 4].optional,
            jill: [5, 5, 4, 4, 4, 4].optional
        )
        XCTAssertEqual(comp.status.upA, 3)
        XCTAssertEqual(comp.status.dormieSide, .a)
        XCTAssertFalse(comp.status.closed)
        XCTAssertEqual(comp.status.display, "Dormie 3")
    }

    func testAutoCloseThreeAndTwo() {
        // W W H W H H H → 3 up with 2 to play after hole 7: closed 3&2.
        // Holes 8–9 have scores that must NOT count.
        let comp = compute(
            jack: [4, 4, 3, 4, 4, 4, 3, 9, 9].optional,
            jill: [5, 5, 3, 5, 4, 4, 3, 4, 4].optional
        )
        XCTAssertTrue(comp.status.closed)
        XCTAssertEqual(comp.status.winner, .a)
        XCTAssertEqual(comp.status.display, "3&2")
        XCTAssertEqual(comp.holeResults.count, 7, "results must stop when the match closes")
    }

    func testWinOnFinalHoleReadsUp() {
        // All square through 7, Jack wins 8 and 9 → "2 UP".
        let comp = compute(
            jack: [4, 4, 3, 4, 4, 4, 3, 4, 3].optional,
            jill: [4, 4, 3, 4, 4, 4, 3, 5, 4].optional
        )
        XCTAssertTrue(comp.status.closed)
        XCTAssertEqual(comp.status.remaining, 0)
        XCTAssertEqual(comp.status.display, "2 UP")
    }

    func testHalvedMatch() {
        let card = Array(repeating: 4, count: 9).optional
        let comp = compute(jack: card, jill: card)
        XCTAssertFalse(comp.status.closed)
        XCTAssertNil(comp.status.winner)
        XCTAssertEqual(comp.status.display, "Halved")
    }

    func testPendingHoleKeepsMatchOpen() {
        // Jack 1 up, but hole 2 unscored for Jill: 1 up with 1 undecided
        // hole is NOT closed — Jill could still halve the match by winning
        // hole 2 once it's filled in. It is, however, dormie: Jack can no
        // longer lose.
        var jill: [Int?] = Array(repeating: 4, count: 9)
        jill[1] = nil
        let comp = compute(jack: Array(repeating: 4, count: 9).optional.replacing(at: 0, with: 3), jill: jill.replacing(at: 0, with: 4))
        XCTAssertEqual(comp.status.upA, 1)
        XCTAssertEqual(comp.status.remaining, 1)
        XCTAssertFalse(comp.status.closed)
        XCTAssertNil(comp.status.winner)
        XCTAssertEqual(comp.pendingHoles, [2])
        XCTAssertEqual(comp.status.dormieSide, .a)
        XCTAssertEqual(comp.status.display, "Dormie 1")
    }

    func testBestBallNeedsAllScoresBeforeDeciding() {
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill(), Fixtures.bob(), Fixtures.sue()],
            scores: [
                Fixtures.jackID: [4],
                Fixtures.bobID: [5],
                Fixtures.sueID: [5],
                // Jill hasn't posted.
            ]
        )
        let pendingComp = MatchEngine.compute(
            sideA: [Fixtures.jackID, Fixtures.jillID],
            sideB: [Fixtures.bobID, Fixtures.sueID],
            holes: [1], snapshot: snapshot, mode: .gross, allowance: .offLow
        )
        XCTAssertEqual(pendingComp.pendingHoles, [1])
        XCTAssertEqual(pendingComp.status.holesDecided, 0)

        var withJill = snapshot
        withJill.scores[Fixtures.jillID] = [1: 6]
        let decided = MatchEngine.compute(
            sideA: [Fixtures.jackID, Fixtures.jillID],
            sideB: [Fixtures.bobID, Fixtures.sueID],
            holes: [1], snapshot: withJill, mode: .gross, allowance: .offLow
        )
        // Side A best ball 4 beats side B best ball 5.
        XCTAssertEqual(decided.status.upA, 1)
    }

    func testWithdrawalConcedesRemainingHoles() {
        // Halved 1–3 by scores, then Jill withdraws: holes 4+ conceded until
        // the match closes at hole 7 (4 up, 2 to play).
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(), Fixtures.jill()],
            scores: [
                Fixtures.jackID: [4, 4, 3].optional,
                Fixtures.jillID: [4, 4, 3].optional,
            ],
            withdrawals: [Fixtures.jillID: 3]
        )
        let comp = MatchEngine.compute(
            sideA: [Fixtures.jackID], sideB: [Fixtures.jillID],
            holes: Array(1...9), snapshot: snapshot, mode: .gross, allowance: .offLow
        )
        XCTAssertTrue(comp.status.closed)
        XCTAssertEqual(comp.status.winner, .a)
        XCTAssertEqual(comp.status.display, "4&2")
        XCTAssertTrue(comp.holeResults[3...].allSatisfy(\.byConcession))
    }

    func testNetOffLowMatch() {
        // Jack 0, Jill 9: Jill strokes on front holes with SI ≤ 9 —
        // holes 1 (SI5), 2 (SI1), 4 (SI9), 6 (SI7), 8 (SI3).
        // Everyone shoots gross 4s, so Jill nets out a win on each stroke
        // hole and the match closes at hole 6, 4 down with 3 to play.
        let card = Array(repeating: 4, count: 9).optional
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack(0), Fixtures.jill(9)],
            scores: [Fixtures.jackID: card, Fixtures.jillID: card]
        )
        let comp = MatchEngine.compute(
            sideA: [Fixtures.jackID], sideB: [Fixtures.jillID],
            holes: Array(1...9), snapshot: snapshot, mode: .net, allowance: .offLow
        )
        XCTAssertTrue(comp.status.closed)
        XCTAssertEqual(comp.status.winner, .b)
        XCTAssertEqual(comp.status.display, "4&3")
    }
}

private extension Array {
    func replacing(at index: Int, with element: Element) -> [Element] {
        var copy = self
        copy[index] = element
        return copy
    }
}
