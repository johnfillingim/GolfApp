import Foundation

/// An immutable view of everything the bet engines need about a round at one
/// moment in time: who is playing, what course, what has been scored, who has
/// withdrawn, and any bet-relevant events (presses, Wolf decisions).
///
/// The app layer rebuilds a snapshot whenever synced state changes and re-runs
/// `BetEvaluator` over it. Evaluation is a pure function of the snapshot, so
/// every phone in the group computes identical standings from identical data —
/// there is no "authoritative" device.
public struct RoundSnapshot: Sendable {
    public var course: CourseInfo

    /// Players in tee order. Order matters: it is the Wolf rotation default
    /// and the deterministic tiebreak for splitting odd cents.
    public var players: [ScoringPlayer]

    /// The holes being played this round, ascending (1...18, 1...9, or a
    /// back-nine 10...18).
    public var holeNumbers: [Int]

    /// Gross strokes: playerID → (hole number → strokes).
    /// Absence means "not entered yet" — engines treat those holes as pending.
    public var scores: [PlayerID: [Int: Int]]

    /// playerID → last hole through which the player is active.
    /// A player with `withdrawals[p] == 6` counts for holes 1–6 and is out
    /// from hole 7 on. `0` means they never started. Absent = never withdrew.
    public var withdrawals: [PlayerID: Int]

    /// Append-only bet events (manual presses, Wolf picks). These sync as a
    /// grow-only set, which makes them conflict-free across devices.
    public var events: RoundEvents

    public init(
        course: CourseInfo,
        players: [ScoringPlayer],
        holeNumbers: [Int]? = nil,
        scores: [PlayerID: [Int: Int]] = [:],
        withdrawals: [PlayerID: Int] = [:],
        events: RoundEvents = RoundEvents()
    ) {
        self.course = course
        self.players = players
        self.holeNumbers = (holeNumbers ?? course.holes.map(\.number)).sorted()
        self.scores = scores
        self.withdrawals = withdrawals
        self.events = events
    }

    // MARK: Lookups

    public func player(_ id: PlayerID) -> ScoringPlayer? {
        players.first { $0.id == id }
    }

    public func gross(_ player: PlayerID, hole: Int) -> Int? {
        scores[player]?[hole]
    }

    /// Whether the player is still in the round when `hole` is played.
    public func isActive(_ player: PlayerID, atHole hole: Int) -> Bool {
        guard let lastHole = withdrawals[player] else { return true }
        return hole <= lastHole
    }

    /// Participants of `ids` still active at `hole`, preserving given order.
    public func activePlayers(of ids: [PlayerID], atHole hole: Int) -> [PlayerID] {
        ids.filter { isActive($0, atHole: hole) }
    }

    /// Deterministic ordering index used to break ties (cent remainders etc.).
    /// Players not in the round sort last by UUID for total determinism.
    public func orderIndex(of id: PlayerID) -> Int {
        players.firstIndex { $0.id == id } ?? players.count
    }

    /// Holes of the round that lie in the inclusive number range.
    public func holes(in range: ClosedRange<Int>) -> [Int] {
        holeNumbers.filter(range.contains)
    }
}

/// Append-only events that affect bets. Because these merge as set-unions
/// keyed by unique IDs, two phones can record events offline and reconcile
/// without conflicts.
public struct RoundEvents: Hashable, Codable, Sendable {
    public var presses: [PressEvent]
    public var wolfDecisions: [WolfDecision]

    public init(presses: [PressEvent] = [], wolfDecisions: [WolfDecision] = []) {
        self.presses = presses
        self.wolfDecisions = wolfDecisions
    }

    /// Set-union merge by event identity; the foundation of conflict-free
    /// event sync (see `RoundMerge`).
    public func union(_ other: RoundEvents) -> RoundEvents {
        var merged = self
        for press in other.presses where !merged.presses.contains(where: { $0.id == press.id }) {
            merged.presses.append(press)
        }
        for decision in other.wolfDecisions
        where !merged.wolfDecisions.contains(where: { $0.betID == decision.betID && $0.hole == decision.hole }) {
            merged.wolfDecisions.append(decision)
        }
        return merged
    }
}
