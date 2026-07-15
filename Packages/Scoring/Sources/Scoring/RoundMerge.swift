import Foundation

/// The sync-facing shape of one player's entry on one hole, with the metadata
/// needed for deterministic merging. This is the *only* mutable-by-anyone
/// data in a round; everything else is append-only or immutable.
public struct ScoreCell: Hashable, Codable, Sendable {
    public struct Key: Hashable, Codable, Sendable {
        public let playerID: PlayerID
        public let hole: Int

        public init(playerID: PlayerID, hole: Int) {
            self.playerID = playerID
            self.hole = hole
        }
    }

    public let playerID: PlayerID
    public let hole: Int
    /// nil = score cleared.
    public var strokes: Int?
    public var putts: Int?
    public var fairwayHit: Bool?
    public var greenInRegulation: Bool?
    /// Wall-clock write time on the editing device.
    public var updatedAt: Date
    /// Stable per-device identifier; the total-order tiebreak.
    public var editorID: String

    public var key: Key { Key(playerID: playerID, hole: hole) }

    public init(
        playerID: PlayerID,
        hole: Int,
        strokes: Int?,
        putts: Int? = nil,
        fairwayHit: Bool? = nil,
        greenInRegulation: Bool? = nil,
        updatedAt: Date,
        editorID: String
    ) {
        self.playerID = playerID
        self.hole = hole
        self.strokes = strokes
        self.putts = putts
        self.fairwayHit = fairwayHit
        self.greenInRegulation = greenInRegulation
        self.updatedAt = updatedAt
        self.editorID = editorID
    }
}

/// Everything about a round that syncs between devices.
public struct RoundChangeSet: Codable, Sendable {
    public var cells: [ScoreCell]
    public var events: RoundEvents
    /// playerID → last hole played before withdrawing.
    public var withdrawals: [PlayerID: Int]

    public init(cells: [ScoreCell] = [], events: RoundEvents = RoundEvents(), withdrawals: [PlayerID: Int] = [:]) {
        self.cells = cells
        self.events = events
        self.withdrawals = withdrawals
    }
}

/// Deterministic conflict resolution for concurrent edits from multiple
/// phones. Design (and why):
///
/// - **Score cells: last-write-wins per (player, hole).** Score entry is
///   naturally single-writer — you type your own score — so true conflicts
///   only occur when someone marks a score for a buddy who then edits it
///   himself. Whole-cell LWW matches what players expect ("the last person
///   to touch it set it") and needs no coordination. Ties on timestamp break
///   by editor ID, then by content, so merge is commutative and associative:
///   any set of devices exchanging changesets in any order converges.
/// - **Events (presses, wolf picks): grow-only set union.** They are
///   append-only facts keyed by identity; union never conflicts.
/// - **Withdrawals: earliest hole wins.** Two devices recording the same
///   withdrawal converge on the earlier boundary; "un-withdrawing" is
///   deliberately not supported mid-sync (rejoin = new bet).
public enum RoundMerge {

    /// Total order over conflicting cell versions. Never returns different
    /// winners on different devices.
    public static func newer(_ a: ScoreCell, _ b: ScoreCell) -> ScoreCell {
        if a.updatedAt != b.updatedAt {
            return a.updatedAt > b.updatedAt ? a : b
        }
        if a.editorID != b.editorID {
            return a.editorID > b.editorID ? a : b
        }
        // Same instant, same editor (clock repeat): break by content so the
        // choice is still symmetric in its arguments.
        let keyA = [a.strokes ?? Int.min, a.putts ?? Int.min]
        let keyB = [b.strokes ?? Int.min, b.putts ?? Int.min]
        return keyA.lexicographicallyPrecedes(keyB) ? b : a
    }

    public static func merged(_ a: RoundChangeSet, _ b: RoundChangeSet) -> RoundChangeSet {
        var cellsByKey: [ScoreCell.Key: ScoreCell] = [:]
        for cell in a.cells + b.cells {
            if let existing = cellsByKey[cell.key] {
                cellsByKey[cell.key] = newer(existing, cell)
            } else {
                cellsByKey[cell.key] = cell
            }
        }
        // Stable ordering keeps encoded changesets byte-comparable in tests.
        let cells = cellsByKey.values.sorted {
            ($0.hole, $0.playerID.uuidString) < ($1.hole, $1.playerID.uuidString)
        }

        var withdrawals = a.withdrawals
        for (player, hole) in b.withdrawals {
            withdrawals[player] = min(withdrawals[player] ?? hole, hole)
        }

        return RoundChangeSet(
            cells: cells,
            events: a.events.union(b.events),
            withdrawals: withdrawals
        )
    }

    /// Applies a changeset's cells to the score table shape the engines use.
    public static func scoreTable(from cells: [ScoreCell]) -> [PlayerID: [Int: Int]] {
        var scores: [PlayerID: [Int: Int]] = [:]
        for cell in cells {
            guard let strokes = cell.strokes else { continue }
            scores[cell.playerID, default: [:]][cell.hole] = strokes
        }
        return scores
    }
}
