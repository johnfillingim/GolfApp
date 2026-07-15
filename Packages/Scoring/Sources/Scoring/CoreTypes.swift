import Foundation

/// Stable identity for a player across devices. The app layer maps its
/// SwiftData / CloudKit records onto these IDs; the scoring engines never see
/// anything but UUIDs.
public typealias PlayerID = UUID

/// A participant in a round, as the scoring engines see them.
///
/// `playingHandicap` is the *course* handicap already resolved to whole
/// strokes for this round (the app computes it from the player's handicap
/// index; for 9-hole rounds it should already be a 9-hole handicap).
/// Engines allocate those strokes to holes by stroke index — see
/// `StrokeAllocator`.
public struct ScoringPlayer: Hashable, Codable, Sendable, Identifiable {
    public let id: PlayerID
    public var name: String
    public var playingHandicap: Int

    public init(id: PlayerID, name: String, playingHandicap: Int = 0) {
        self.id = id
        self.name = name
        self.playingHandicap = playingHandicap
    }
}

/// One hole of a course.
///
/// `strokeIndex` is the hole's handicap ranking on the *full course*
/// (1 = hardest). Engines rank the holes actually being played, so a
/// back-nine-only round with stroke indexes {2,4,…,18} still allocates
/// strokes sensibly.
public struct HoleInfo: Hashable, Codable, Sendable, Identifiable {
    public var id: Int { number }
    public let number: Int
    public let par: Int
    public let strokeIndex: Int
    public let yardage: Int?

    public init(number: Int, par: Int, strokeIndex: Int, yardage: Int? = nil) {
        self.number = number
        self.par = par
        self.strokeIndex = strokeIndex
        self.yardage = yardage
    }
}

/// Course data as needed for scoring. GPS coordinates and richer course
/// metadata live in the app layer (`CourseCatalog`); the engines only need
/// par and stroke index.
public struct CourseInfo: Hashable, Codable, Sendable {
    public var name: String
    public var holes: [HoleInfo]

    public init(name: String, holes: [HoleInfo]) {
        self.name = name
        self.holes = holes.sorted { $0.number < $1.number }
    }

    public func hole(_ number: Int) -> HoleInfo? {
        holes.first { $0.number == number }
    }

    /// Total par over a subset of holes (used for "to par thru N" displays).
    public func par(over holeNumbers: some Sequence<Int>) -> Int {
        holeNumbers.compactMap { hole($0)?.par }.reduce(0, +)
    }
}
