import Foundation
import Scoring

// MARK: - Sync abstraction
//
// Decision (see ARCHITECTURE.md for the full trade-off): CloudKit over
// Firestore. No server to run or pay for, native CKShare invite links,
// and the users already have iCloud accounts. The cost — clunkier
// real-time latency and Apple-only — is acceptable for v1 and hedged by
// this protocol: everything above it (view models, SnapshotBuilder) only
// speaks `RoundChangeSet`, so a Firestore adapter can drop in later.
//
// The offline-first contract:
// 1. Every edit writes to SwiftData FIRST. The UI reads only local state.
// 2. After the write, the round's changeset is handed to
//    `scheduleUpload` — fire and forget.
// 3. Remote changes arrive on `updates`; `SnapshotBuilder.apply` merges
//    them (deterministic LWW, see `Scoring.RoundMerge`) into SwiftData.
// Sync can lag, fail, or never run (airplane mode, no iCloud account) and
// the app remains fully usable — it just stops being multiplayer.

enum SyncStatus: Equatable {
    /// Sharing unavailable (no iCloud account / entitlement); solo play.
    case localOnly
    case idle(lastSync: Date?)
    case syncing
    /// Changes queued locally, waiting for connectivity.
    case waitingForNetwork
    case error(String)

    var isShareCapable: Bool {
        if case .localOnly = self { return false }
        return true
    }
}

struct RemoteRoundUpdate: Sendable {
    let roundID: UUID
    let changeSet: RoundChangeSet
}

@MainActor
protocol SyncService: AnyObject {
    var status: SyncStatus { get }

    /// Remote changes, already reduced to the mergeable wire shape.
    /// The subscriber (RoundSession) applies them via `SnapshotBuilder`.
    var updates: AsyncStream<RemoteRoundUpdate> { get }

    /// Publish a round and return the invite URL for the group chat.
    func startSharing(round: Round) async throws -> URL

    /// Queue local changes for delivery. Cheap; call after every edit.
    func scheduleUpload(roundID: UUID, changeSet: RoundChangeSet)

    /// Push + pull immediately (pull-to-refresh, app foregrounding).
    func syncNow() async
}

enum SyncError: LocalizedError {
    case sharingUnavailable
    case notSignedIntoICloud

    var errorDescription: String? {
        switch self {
        case .sharingUnavailable:
            return "Live sync isn't available in this build. Scores stay on this phone."
        case .notSignedIntoICloud:
            return "Sign into iCloud in Settings to share rounds with your group."
        }
    }
}

// MARK: - Local-only implementation

/// The degenerate sync service: solo rounds, everything already local.
/// Also the implementation the app falls back to whenever CloudKit is
/// unavailable, keeping every code path identical either way.
@MainActor
final class LocalSyncService: SyncService {
    private(set) var status: SyncStatus = .localOnly

    let updates: AsyncStream<RemoteRoundUpdate> = AsyncStream { _ in }

    func startSharing(round: Round) async throws -> URL {
        throw SyncError.sharingUnavailable
    }

    func scheduleUpload(roundID: UUID, changeSet: RoundChangeSet) {
        // Nothing to do — the SwiftData write already happened.
    }

    func syncNow() async {}
}
