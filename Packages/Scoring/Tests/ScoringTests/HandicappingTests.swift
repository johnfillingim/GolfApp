import XCTest
@testable import Scoring

final class HandicappingTests: XCTestCase {

    let holes = Fixtures.course18().holes

    func testScratchGetsNothing() {
        let allocation = StrokeAllocator.allocation(handicap: 0, holes: holes)
        XCTAssertTrue(allocation.values.allSatisfy { $0 == 0 })
    }

    func testThirteenHandicapStrokesOnThirteenHardestHoles() {
        let allocation = StrokeAllocator.allocation(handicap: 13, holes: holes)
        // One stroke wherever stroke index ≤ 13, none on SI 14–18.
        for hole in holes {
            let expected = hole.strokeIndex <= 13 ? 1 : 0
            XCTAssertEqual(allocation[hole.number], expected, "hole \(hole.number) (SI \(hole.strokeIndex))")
        }
        XCTAssertEqual(allocation.values.reduce(0, +), 13)
    }

    func testTwentyHandicapWrapsToSecondStroke() {
        let allocation = StrokeAllocator.allocation(handicap: 20, holes: holes)
        // Base stroke everywhere plus a second on SI 1 and SI 2.
        // SI 1 = hole 2, SI 2 = hole 12 on the fixture card.
        XCTAssertEqual(allocation[2], 2)
        XCTAssertEqual(allocation[12], 2)
        XCTAssertEqual(allocation[3], 1) // SI 17
        XCTAssertEqual(allocation.values.reduce(0, +), 20)
    }

    func testPlusHandicapGivesBackOnEasiestHoles() {
        let allocation = StrokeAllocator.allocation(handicap: -2, holes: holes)
        // SI 18 = hole 16, SI 17 = hole 3 give a stroke back.
        XCTAssertEqual(allocation[16], -1)
        XCTAssertEqual(allocation[3], -1)
        XCTAssertEqual(allocation.values.reduce(0, +), -2)
        XCTAssertEqual(allocation.values.filter { $0 != 0 }.count, 2)
    }

    func testBackNineOnlyRanksWithinPlayedHoles() {
        let backNine = Fixtures.course18().holes.filter { $0.number >= 10 }
        let allocation = StrokeAllocator.allocation(handicap: 3, holes: backNine)
        // Back-nine stroke indexes are {6,16,2,10,14,4,18,8,12}; the three
        // hardest played holes are SI 2 (hole 12), SI 4 (hole 15), SI 6
        // (hole 10) — raw SI ≤ 3 would misfire here.
        XCTAssertEqual(allocation[12], 1)
        XCTAssertEqual(allocation[15], 1)
        XCTAssertEqual(allocation[10], 1)
        XCTAssertEqual(allocation[17], 0) // SI 8 — fourth hardest, gets nothing
        XCTAssertEqual(allocation.values.reduce(0, +), 3)
    }

    func testOffLowAllowanceReducesByLowestHandicap() {
        let table = StrokeAllocator.table(
            for: [Fixtures.jack(3), Fixtures.jill(8)],
            holes: holes,
            mode: .net,
            allowance: .offLow
        )
        // Jack plays at scratch; Jill gets 8 − 3 = 5 strokes.
        XCTAssertEqual(table[Fixtures.jackID]!.values.reduce(0, +), 0)
        XCTAssertEqual(table[Fixtures.jillID]!.values.reduce(0, +), 5)
    }

    func testGrossModeZeroesEverything() {
        let table = StrokeAllocator.table(
            for: [Fixtures.jack(3), Fixtures.jill(8)],
            holes: holes,
            mode: .gross
        )
        XCTAssertTrue(table.values.allSatisfy { $0.isEmpty })
    }
}
