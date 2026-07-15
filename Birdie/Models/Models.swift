import Foundation
import SwiftData

// MARK: - SwiftData schema
//
// Design notes:
// - `RoundPlayer.id` doubles as the `Scoring.PlayerID`, so the scoring
//   module never needs to know about profiles or groups.
// - Anything that must merge across devices is either LWW-mergeable
//   (`HoleScoreModel` carries `updatedAt` + `editorID`) or append-only
//   (`eventsData` unions, bets are add-only). See `Scoring.RoundMerge`.
// - Bet configurations are stored as opaque Codable payloads (`kindData`),
//   keeping the SwiftData schema stable as bet formats evolve.
// - We deliberately do NOT use SwiftData's built-in CloudKit mirroring:
//   round sharing needs CKShare + custom merge semantics, which live in
//   `CloudKitSyncService`. (Built-in mirroring also forbids unique
//   constraints, which we want locally.)

/// A person known to this device: the local user or a buddy.
@Model
final class PlayerProfile {
    @Attribute(.unique) var id: UUID
    var name: String
    /// Single-emoji avatar; keeps profiles fun with zero asset pipeline.
    var emoji: String
    /// WHS handicap index (e.g. 12.4). Optional — plenty of groups play gross.
    var handicapIndex: Double?
    /// True for the profile that owns this device.
    var isMe: Bool
    /// Stable user identifier from Sign in with Apple, when signed in.
    var appleUserID: String?
    var createdAt: Date

    init(
        id: UUID = UUID(),
        name: String,
        emoji: String = "⛳️",
        handicapIndex: Double? = nil,
        isMe: Bool = false,
        appleUserID: String? = nil
    ) {
        self.id = id
        self.name = name
        self.emoji = emoji
        self.handicapIndex = handicapIndex
        self.isMe = isMe
        self.appleUserID = appleUserID
        self.createdAt = Date()
    }

    /// Course handicap for a round, resolved to whole strokes.
    /// (Slope-adjusted course handicaps need a course rating API — flagged
    /// in the README; rounding the index is the standard casual fallback.)
    func playingHandicap(holeCount: Int) -> Int {
        guard let handicapIndex else { return 0 }
        let full = Int(handicapIndex.rounded())
        return holeCount <= 9 ? Int((handicapIndex / 2).rounded()) : full
    }
}

/// A persistent group of buddies, so the same crew is one tap away.
@Model
final class BuddyGroup {
    @Attribute(.unique) var id: UUID
    var name: String
    /// Human-shareable join code ("K7Q2FD").
    var joinCode: String
    var members: [PlayerProfile]
    var createdAt: Date

    init(id: UUID = UUID(), name: String, members: [PlayerProfile] = []) {
        self.id = id
        self.name = name
        self.joinCode = Self.generateCode()
        self.members = members
        self.createdAt = Date()
    }

    static func generateCode() -> String {
        // No 0/O or 1/I — this gets read out loud on a tee box.
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<6).map { _ in alphabet.randomElement()! })
    }
}

enum RoundStatus: String, Codable {
    case setup, live, finished
}

/// One outing: course snapshot, players, bets, scores, shots, settlement.
@Model
final class Round {
    @Attribute(.unique) var id: UUID
    var createdAt: Date
    var statusRaw: String
    /// Catalog identifier (for "play it again"); the actual card lives in
    /// `courseData` so a round never breaks if the catalog changes.
    var courseID: String
    var courseData: Data
    var holeCount: Int
    /// Serialized `Scoring.RoundEvents` — presses and Wolf picks. Append-only;
    /// merged by set union.
    var eventsData: Data
    /// Serialized `[UUID: Int]` — playerID to last-active hole.
    var withdrawalsData: Data
    /// CloudKit share anchor (record zone name) once sharing starts.
    var shareZoneName: String?
    var groupID: UUID?

    @Relationship(deleteRule: .cascade, inverse: \RoundPlayer.round)
    var players: [RoundPlayer]
    @Relationship(deleteRule: .cascade, inverse: \HoleScoreModel.round)
    var scores: [HoleScoreModel]
    @Relationship(deleteRule: .cascade, inverse: \BetModel.round)
    var bets: [BetModel]
    @Relationship(deleteRule: .cascade, inverse: \ShotModel.round)
    var shots: [ShotModel]
    @Relationship(deleteRule: .cascade, inverse: \SettlementMark.round)
    var settlementMarks: [SettlementMark]

    var status: RoundStatus {
        get { RoundStatus(rawValue: statusRaw) ?? .setup }
        set { statusRaw = newValue.rawValue }
    }

    init(id: UUID = UUID(), courseID: String, courseData: Data, holeCount: Int, groupID: UUID? = nil) {
        self.id = id
        self.createdAt = Date()
        self.statusRaw = RoundStatus.setup.rawValue
        self.courseID = courseID
        self.courseData = courseData
        self.holeCount = holeCount
        self.eventsData = Data()
        self.withdrawalsData = Data()
        self.shareZoneName = nil
        self.groupID = groupID
        self.players = []
        self.scores = []
        self.bets = []
        self.shots = []
        self.settlementMarks = []
    }
}

/// A player *in a specific round*. Snapshots name/emoji/handicap at round
/// time so history doesn't rewrite itself when a profile changes.
@Model
final class RoundPlayer {
    /// This IS the `Scoring.PlayerID` for the round.
    @Attribute(.unique) var id: UUID
    var round: Round?
    var profileID: UUID?
    var name: String
    var emoji: String
    var playingHandicap: Int
    /// Tee order; also the Wolf rotation and deterministic tiebreak order.
    var teeOrder: Int

    init(
        id: UUID = UUID(),
        profileID: UUID?,
        name: String,
        emoji: String,
        playingHandicap: Int,
        teeOrder: Int
    ) {
        self.id = id
        self.profileID = profileID
        self.name = name
        self.emoji = emoji
        self.playingHandicap = playingHandicap
        self.teeOrder = teeOrder
    }
}

/// One player's entry on one hole — the LWW-merged sync cell.
/// Uniqueness of (round, playerID, hole) is enforced by the accessors in
/// `SnapshotBuilder` (SwiftData has no compound unique constraints).
@Model
final class HoleScoreModel {
    var round: Round?
    var playerID: UUID
    var hole: Int
    var strokes: Int?
    var putts: Int?
    var fairwayHit: Bool?
    var greenInRegulation: Bool?
    var updatedAt: Date
    var editorID: String

    init(
        playerID: UUID,
        hole: Int,
        strokes: Int?,
        putts: Int? = nil,
        fairwayHit: Bool? = nil,
        greenInRegulation: Bool? = nil,
        updatedAt: Date = Date(),
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

/// A configured bet. `kindData` is a JSON-encoded `Scoring.BetKind`.
@Model
final class BetModel {
    @Attribute(.unique) var id: UUID
    var round: Round?
    var name: String
    var kindData: Data
    var createdAt: Date

    init(id: UUID = UUID(), name: String, kindData: Data) {
        self.id = id
        self.name = name
        self.kindData = kindData
        self.createdAt = Date()
    }
}

/// A GPS pin for one shot. Strictly optional garnish: scoring never depends
/// on shots being tracked.
@Model
final class ShotModel {
    @Attribute(.unique) var id: UUID
    var round: Round?
    var playerID: UUID
    var hole: Int
    /// 1-based shot number within the hole.
    var sequence: Int
    var latitude: Double
    var longitude: Double
    var timestamp: Date
    var club: String?

    init(
        id: UUID = UUID(),
        playerID: UUID,
        hole: Int,
        sequence: Int,
        latitude: Double,
        longitude: Double,
        club: String? = nil
    ) {
        self.id = id
        self.playerID = playerID
        self.hole = hole
        self.sequence = sequence
        self.latitude = latitude
        self.longitude = longitude
        self.timestamp = Date()
        self.club = club
    }
}

/// One "X pays Y" line from settlement, with its paid/unpaid state.
/// `transferID` matches `Scoring.Transfer.id`, so regenerating the
/// settlement after a late score edit reconciles cleanly.
@Model
final class SettlementMark {
    @Attribute(.unique) var transferID: String
    var round: Round?
    var fromID: UUID
    var toID: UUID
    var amountCents: Int
    var settledAt: Date?
    var note: String?

    init(transferID: String, fromID: UUID, toID: UUID, amountCents: Int) {
        self.transferID = transferID
        self.fromID = fromID
        self.toID = toID
        self.amountCents = amountCents
        self.settledAt = nil
        self.note = nil
    }
}

enum BirdieSchema {
    static let models: [any PersistentModel.Type] = [
        PlayerProfile.self,
        BuddyGroup.self,
        Round.self,
        RoundPlayer.self,
        HoleScoreModel.self,
        BetModel.self,
        ShotModel.self,
        SettlementMark.self,
    ]
}
