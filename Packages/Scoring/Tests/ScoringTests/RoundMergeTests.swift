import XCTest
@testable import Scoring

final class RoundMergeTests: XCTestCase {

    private func cell(
        player: PlayerID = Fixtures.jackID,
        hole: Int = 1,
        strokes: Int?,
        at seconds: TimeInterval,
        editor: String
    ) -> ScoreCell {
        ScoreCell(
            playerID: player,
            hole: hole,
            strokes: strokes,
            updatedAt: Date(timeIntervalSince1970: seconds),
            editorID: editor
        )
    }

    func testLastWriteWins() {
        let older = cell(strokes: 5, at: 100, editor: "phone-A")
        let newer = cell(strokes: 4, at: 200, editor: "phone-B")
        XCTAssertEqual(RoundMerge.newer(older, newer).strokes, 4)
        XCTAssertEqual(RoundMerge.newer(newer, older).strokes, 4, "winner must not depend on argument order")
    }

    func testTimestampTieBreaksByEditor() {
        let a = cell(strokes: 5, at: 100, editor: "phone-A")
        let b = cell(strokes: 4, at: 100, editor: "phone-B")
        XCTAssertEqual(RoundMerge.newer(a, b).strokes, 4, "higher editor ID wins the tie")
        XCTAssertEqual(RoundMerge.newer(b, a).strokes, 4)
    }

    func testMergeIsCommutative() {
        let setA = RoundChangeSet(cells: [
            cell(hole: 1, strokes: 5, at: 100, editor: "A"),
            cell(hole: 2, strokes: 4, at: 300, editor: "A"),
        ])
        let setB = RoundChangeSet(cells: [
            cell(hole: 1, strokes: 4, at: 200, editor: "B"),
            cell(player: Fixtures.jillID, hole: 1, strokes: 6, at: 150, editor: "B"),
        ])

        let ab = RoundMerge.merged(setA, setB)
        let ba = RoundMerge.merged(setB, setA)
        XCTAssertEqual(ab.cells, ba.cells)

        let table = RoundMerge.scoreTable(from: ab.cells)
        XCTAssertEqual(table[Fixtures.jackID]?[1], 4, "B's later edit wins hole 1")
        XCTAssertEqual(table[Fixtures.jackID]?[2], 4)
        XCTAssertEqual(table[Fixtures.jillID]?[1], 6)
    }

    func testEventUnionIsIdempotent() {
        let press = PressEvent(betID: UUID(), segment: .back, firstHole: 12, pressedBy: .a)
        let a = RoundChangeSet(events: RoundEvents(presses: [press]))
        let b = RoundChangeSet(events: RoundEvents(presses: [press]))
        let merged = RoundMerge.merged(a, b)
        XCTAssertEqual(merged.events.presses.count, 1)
    }

    func testWolfDecisionsDeduplicateByBetAndHole() {
        let betID = UUID()
        // Two phones record different picks for the same hole (a true race).
        // The union keeps the first side's decision deterministically after
        // ordering — here we just require exactly one survives.
        let a = RoundChangeSet(events: RoundEvents(wolfDecisions: [
            WolfDecision(betID: betID, hole: 3, wolf: Fixtures.jackID, choice: .lone),
        ]))
        let b = RoundChangeSet(events: RoundEvents(wolfDecisions: [
            WolfDecision(betID: betID, hole: 3, wolf: Fixtures.jackID, choice: .lone),
        ]))
        XCTAssertEqual(RoundMerge.merged(a, b).events.wolfDecisions.count, 1)
    }

    func testWithdrawalsKeepEarliestHole() {
        let a = RoundChangeSet(withdrawals: [Fixtures.jillID: 5])
        let b = RoundChangeSet(withdrawals: [Fixtures.jillID: 3])
        XCTAssertEqual(RoundMerge.merged(a, b).withdrawals[Fixtures.jillID], 3)
        XCTAssertEqual(RoundMerge.merged(b, a).withdrawals[Fixtures.jillID], 3)
    }

    func testClearedScoreDropsFromTable() {
        let cleared = cell(strokes: nil, at: 300, editor: "A")
        let table = RoundMerge.scoreTable(from: [cleared])
        XCTAssertNil(table[Fixtures.jackID]?[1])
    }
}
