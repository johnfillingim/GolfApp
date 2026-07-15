import Foundation
import SwiftData
import Scoring

/// Composition root: constructs services once, decides the sync backend,
/// and runs the "sync pump" that shuttles remote changes into SwiftData.
@MainActor
@Observable
final class AppEnvironment {

    let auth = AuthService()
    let location = LocationService()
    let celebrations = CelebrationEngine()
    let sync: any SyncService

    /// The session for the round currently on screen, if any. The sync
    /// pump pokes it after merging remote changes.
    weak var activeSession: RoundSession?

    private var pumpTask: Task<Void, Never>?
    private var incomingRoundsTask: Task<Void, Never>?

    init() {
        // CloudKit when an iCloud account (and our entitlement) is present;
        // otherwise degrade to local-only. Both sides of this choice honor
        // the same SyncService contract, so nothing upstream cares.
        if CloudKitSyncService.isAvailable {
            sync = CloudKitSyncService()
        } else {
            sync = LocalSyncService()
        }
    }

    /// Starts consuming sync streams. Call once, with the main context.
    func startSyncPump(container: ModelContainer) {
        guard pumpTask == nil else { return }
        let context = container.mainContext

        pumpTask = Task { [weak self] in
            guard let self else { return }
            for await update in self.sync.updates {
                self.apply(update: update, context: context)
            }
        }

        if let cloudSync = sync as? CloudKitSyncService {
            incomingRoundsTask = Task { [weak self] in
                for await seed in cloudSync.incomingRounds {
                    self?.materialize(seed: seed, context: context)
                }
            }
        }
    }

    private func apply(update: RemoteRoundUpdate, context: ModelContext) {
        guard let round = Self.fetchRound(id: update.roundID, context: context) else { return }
        SnapshotBuilder.apply(update.changeSet, to: round, context: context)
        if let session = activeSession, session.round.id == update.roundID {
            session.remoteDidChange()
        }
    }

    /// A share we accepted delivered a round we don't have — create it.
    private func materialize(seed: RoundSeed, context: ModelContext) {
        guard Self.fetchRound(id: seed.roundID, context: context) == nil else {
            // Already known: seed updates can still carry new bets.
            if let round = Self.fetchRound(id: seed.roundID, context: context) {
                mergeBets(from: seed, into: round, context: context)
            }
            return
        }

        let round = Round(
            id: seed.roundID,
            courseID: seed.courseID,
            courseData: seed.courseData,
            holeCount: seed.holeCount
        )
        round.status = .live
        round.shareZoneName = "round-\(seed.roundID.uuidString)"
        context.insert(round)

        for player in seed.players {
            let roundPlayer = RoundPlayer(
                id: player.id,
                profileID: nil,
                name: player.name,
                emoji: player.emoji,
                playingHandicap: player.playingHandicap,
                teeOrder: player.teeOrder
            )
            context.insert(roundPlayer)
            roundPlayer.round = round
            round.players.append(roundPlayer)
        }
        mergeBets(from: seed, into: round, context: context)
    }

    private func mergeBets(from seed: RoundSeed, into round: Round, context: ModelContext) {
        for bet in seed.bets where !round.bets.contains(where: { $0.id == bet.id }) {
            let model = BetModel(id: bet.id, name: bet.name, kindData: bet.kindData)
            context.insert(model)
            model.round = round
            round.bets.append(model)
        }
    }

    static func fetchRound(id: UUID, context: ModelContext) -> Round? {
        var descriptor = FetchDescriptor<Round>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }
}
