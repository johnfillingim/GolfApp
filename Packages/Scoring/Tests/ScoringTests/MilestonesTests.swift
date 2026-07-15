import XCTest
@testable import Scoring

final class MilestonesTests: XCTestCase {

    func testClassificationAndStreaks() {
        // Fixture pars: h1=4, h2=5, h3=3, h4=4, h5=4, h6=4.
        // Jack: birdie, albatross, ACE, par, birdie, birdie.
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack()],
            scores: [Fixtures.jackID: [3, 2, 1, 4, 3, 3].optional]
        )
        let milestones = MilestoneDetector.milestones(in: snapshot)
        let kinds = Dictionary(uniqueKeysWithValues: milestones.map { ($0.id, $0.kind) })

        XCTAssertEqual(kinds["birdie-\(Fixtures.jackID)-1"], .birdie)
        XCTAssertEqual(kinds["albatross-\(Fixtures.jackID)-2"], .albatross)
        XCTAssertEqual(kinds["ace-\(Fixtures.jackID)-3"], .holeInOne)
        XCTAssertNil(kinds["eagle-\(Fixtures.jackID)-3"], "an ace reports as an ace, not an eagle")

        // Streak fires at each extension: 2 at hole 2, 3 at hole 3, then par
        // breaks it; a fresh pair at holes 5–6 fires streak 2 again.
        XCTAssertEqual(kinds["streak-\(Fixtures.jackID)-2-2"], .birdieStreak(count: 2))
        XCTAssertEqual(kinds["streak-\(Fixtures.jackID)-3-3"], .birdieStreak(count: 3))
        XCTAssertNil(kinds["streak-\(Fixtures.jackID)-5-2"])
        XCTAssertEqual(kinds["streak-\(Fixtures.jackID)-6-2"], .birdieStreak(count: 2))
        XCTAssertEqual(milestones.count, 8)
    }

    func testEagleOnParFive() {
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jill()],
            scores: [Fixtures.jillID: [nil, 3]]
        )
        let milestones = MilestoneDetector.milestones(in: snapshot)
        XCTAssertEqual(milestones.map(\.kind), [.eagle])
    }

    func testUnscoredHoleBreaksStreak() {
        // Birdie at 1, gap at 2, birdie at 3 → no streak milestone.
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jill()],
            scores: [Fixtures.jillID: [3, nil, 2]]
        )
        let milestones = MilestoneDetector.milestones(in: snapshot)
        XCTAssertFalse(milestones.contains {
            if case .birdieStreak = $0.kind { return true }
            return false
        })
        XCTAssertEqual(milestones.count, 2)
    }

    func testMilestoneIDsAreStableAcrossEvaluations() {
        let snapshot = Fixtures.snapshot(
            players: [Fixtures.jack()],
            scores: [Fixtures.jackID: [3].optional]
        )
        XCTAssertEqual(
            MilestoneDetector.milestones(in: snapshot),
            MilestoneDetector.milestones(in: snapshot),
            "the CelebrationEngine dedupes on these IDs — they must be stable"
        )
    }
}
