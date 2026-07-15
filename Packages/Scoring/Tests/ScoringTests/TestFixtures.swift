import Foundation
@testable import Scoring

/// Shared fixtures. Player IDs are fixed so tests can assert deterministic
/// tie-breaks; the course is a conventional par-72 with odd stroke indexes on
/// the front nine and even on the back.
enum Fixtures {

    static let jackID = PlayerID(uuidString: "00000000-0000-0000-0000-000000000001")!
    static let jillID = PlayerID(uuidString: "00000000-0000-0000-0000-000000000002")!
    static let bobID = PlayerID(uuidString: "00000000-0000-0000-0000-000000000003")!
    static let sueID = PlayerID(uuidString: "00000000-0000-0000-0000-000000000004")!

    static func jack(_ handicap: Int = 0) -> ScoringPlayer { .init(id: jackID, name: "Jack Palmer", playingHandicap: handicap) }
    static func jill(_ handicap: Int = 0) -> ScoringPlayer { .init(id: jillID, name: "Jill Hogan", playingHandicap: handicap) }
    static func bob(_ handicap: Int = 0) -> ScoringPlayer { .init(id: bobID, name: "Bob Snead", playingHandicap: handicap) }
    static func sue(_ handicap: Int = 0) -> ScoringPlayer { .init(id: sueID, name: "Sue Zaharias", playingHandicap: handicap) }

    /// Par-72: front 36 / back 36.
    /// Pars:           4 5 3 4 4 4 3 5 4 | 4 3 5 4 4 5 3 4 4
    /// Stroke indexes: 5 1 17 9 13 7 15 3 11 | 6 16 2 10 14 4 18 8 12
    static let pars = [4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4]
    static let strokeIndexes = [5, 1, 17, 9, 13, 7, 15, 3, 11, 6, 16, 2, 10, 14, 4, 18, 8, 12]

    static func course18() -> CourseInfo {
        CourseInfo(
            name: "Fixture National",
            holes: (1...18).map { number in
                HoleInfo(number: number, par: pars[number - 1], strokeIndex: strokeIndexes[number - 1], yardage: 150 + number * 10)
            }
        )
    }

    static func course9() -> CourseInfo {
        CourseInfo(
            name: "Fixture Nine",
            holes: (1...9).map { number in
                HoleInfo(number: number, par: pars[number - 1], strokeIndex: strokeIndexes[number - 1], yardage: 150 + number * 10)
            }
        )
    }

    /// Builds a score table from per-player arrays where index 0 is hole 1.
    /// `nil` entries are unscored holes.
    static func scores(_ perPlayer: [PlayerID: [Int?]]) -> [PlayerID: [Int: Int]] {
        perPlayer.mapValues { list in
            var byHole: [Int: Int] = [:]
            for (index, strokes) in list.enumerated() {
                if let strokes {
                    byHole[index + 1] = strokes
                }
            }
            return byHole
        }
    }

    /// 18-hole snapshot with the given players and scores.
    static func snapshot(
        players: [ScoringPlayer],
        scores: [PlayerID: [Int?]] = [:],
        withdrawals: [PlayerID: Int] = [:],
        events: RoundEvents = RoundEvents(),
        course: CourseInfo? = nil
    ) -> RoundSnapshot {
        let resolved = course ?? course18()
        return RoundSnapshot(
            course: resolved,
            players: players,
            scores: Self.scores(scores),
            withdrawals: withdrawals,
            events: events
        )
    }
}

extension Array where Element == Int {
    /// Convenience: promote `[Int]` cards to `[Int?]`.
    var optional: [Int?] { map { Optional($0) } }
}
