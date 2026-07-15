import CloudKit
import Foundation
import Scoring

// MARK: - CloudKit sync
//
// Topology: one custom CKRecordZone per round in the ROUND OWNER's private
// database, shared with the group via a zone-wide CKShare (anyone with the
// link can read/write — exactly the trust model of a golf group). Buddies
// see the zone through their shared database.
//
// Records in a round zone:
//   "seed"                     RoundBlob  — course, players, bets (JSON)
//   "events"                   RoundBlob  — RoundEvents (presses, wolf picks)
//   "withdrawals"              RoundBlob  — [PlayerID: last hole]
//   "cell|<player>|<hole>"     ScoreCell  — one score entry
//
// Offline-first is delegated to CKSyncEngine (iOS 17): it maintains the
// outbox across launches, batches sends, backs off, and fetches deltas on
// push. Our job is only (a) mapping records ⇄ `RoundChangeSet` and
// (b) resolving conflicts — which reuses the same `Scoring.RoundMerge`
// logic the unit tests verify:
//   ScoreCell     → LWW by (updatedAt, editorID)
//   events        → set union
//   withdrawals   → earliest hole wins
//   seed          → bets unioned by ID (bets are add-only)
//
// ⚠️ Needs a provisioned iCloud container (see README → CloudKit setup) and
// two signed-in devices to exercise end to end. Without an iCloud account
// the app silently runs on `LocalSyncService` instead — sharing buttons
// explain why, and nothing else changes.

@MainActor
final class CloudKitSyncService: NSObject, SyncService {

    // MARK: State

    private(set) var status: SyncStatus = .idle(lastSync: nil)

    let updates: AsyncStream<RemoteRoundUpdate>
    private let updatesContinuation: AsyncStream<RemoteRoundUpdate>.Continuation

    /// Rounds discovered in the shared database (invites we accepted),
    /// ready to be materialized into SwiftData by the app layer.
    let incomingRounds: AsyncStream<RoundSeed>
    private let incomingRoundsContinuation: AsyncStream<RoundSeed>.Continuation

    private let container: CKContainer
    private var privateEngine: CKSyncEngine?
    private var sharedEngine: CKSyncEngine?

    /// Latest local changesets by round, used to answer the engine's
    /// record requests without touching SwiftData from a background task.
    private var outbox: [UUID: RoundChangeSet] = [:]
    private var seeds: [UUID: RoundSeed] = [:]

    /// True once `ubiquityIdentityToken` confirms an iCloud account with
    /// our entitlement. Checked by AppEnvironment before choosing this
    /// service over LocalSyncService — and safe to call with no account.
    static var isAvailable: Bool {
        FileManager.default.ubiquityIdentityToken != nil
    }

    override init() {
        (updates, updatesContinuation) = AsyncStream.makeStream(of: RemoteRoundUpdate.self)
        (incomingRounds, incomingRoundsContinuation) = AsyncStream.makeStream(of: RoundSeed.self)
        container = CKContainer.default()
        super.init()
        startEngines()
    }

    private func startEngines() {
        privateEngine = makeEngine(for: container.privateCloudDatabase, stateKey: "birdie.ck.state.private")
        sharedEngine = makeEngine(for: container.sharedCloudDatabase, stateKey: "birdie.ck.state.shared")
    }

    private func makeEngine(for database: CKDatabase, stateKey: String) -> CKSyncEngine {
        var configuration = CKSyncEngine.Configuration(
            database: database,
            stateSerialization: Self.loadEngineState(key: stateKey),
            delegate: self
        )
        configuration.automaticallySync = true
        return CKSyncEngine(configuration)
    }

    // MARK: SyncService

    func startSharing(round: Round) async throws -> URL {
        guard let privateEngine else { throw SyncError.sharingUnavailable }

        let zoneID = Self.zoneID(for: round.id)
        round.shareZoneName = zoneID.zoneName

        // Make sure the zone and the full current state are queued.
        privateEngine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
        seeds[round.id] = RoundSeed(round: round)
        scheduleUpload(roundID: round.id, changeSet: SnapshotBuilder.changeSet(for: round), includeSeed: true)
        try await privateEngine.sendChanges()

        // Zone-wide share: one URL covers every record in the round.
        let share = CKShare(recordZoneID: zoneID)
        share.publicPermission = .readWrite
        share[CKShare.SystemFieldKey.title] = "Birdie round" as NSString

        let (saveResults, _) = try await container.privateCloudDatabase.modifyRecords(
            saving: [share],
            deleting: [],
            savePolicy: .ifServerRecordUnchanged
        )
        for (_, result) in saveResults {
            if case .failure(let error) = result { throw error }
        }
        guard let url = share.url else { throw SyncError.sharingUnavailable }
        return url
    }

    /// Called from the scene delegate when the user taps an invite link.
    func acceptInvite(metadata: CKShare.Metadata) async throws {
        try await container.accept(metadata)
        // The shared engine's next fetch delivers the zone's records; the
        // seed record materializes the round via `incomingRounds`.
        await syncNow()
    }

    func scheduleUpload(roundID: UUID, changeSet: RoundChangeSet) {
        scheduleUpload(roundID: roundID, changeSet: changeSet, includeSeed: false)
    }

    private func scheduleUpload(roundID: UUID, changeSet: RoundChangeSet, includeSeed: Bool) {
        outbox[roundID] = changeSet

        let zoneID = Self.zoneID(for: roundID)
        var pending: [CKSyncEngine.PendingRecordZoneChange] = changeSet.cells.map {
            .saveRecord(Self.cellRecordID(roundID: roundID, playerID: $0.playerID, hole: $0.hole, zoneID: zoneID))
        }
        pending.append(.saveRecord(CKRecord.ID(recordName: "events", zoneID: zoneID)))
        pending.append(.saveRecord(CKRecord.ID(recordName: "withdrawals", zoneID: zoneID)))
        if includeSeed {
            pending.append(.saveRecord(CKRecord.ID(recordName: "seed", zoneID: zoneID)))
        }

        // Queue on whichever engine owns the zone (owner → private DB,
        // invitee → shared DB).
        engineOwningZone(zoneID).state.add(pendingRecordZoneChanges: pending)
    }

    func syncNow() async {
        status = .syncing
        do {
            try await privateEngine?.fetchChanges()
            try await privateEngine?.sendChanges()
            try await sharedEngine?.fetchChanges()
            try await sharedEngine?.sendChanges()
            status = .idle(lastSync: Date())
        } catch {
            status = .error(error.localizedDescription)
        }
    }

    /// Invitees write into the shared database; the owner into private.
    /// We don't track ownership explicitly — queueing into the engine whose
    /// database actually contains the zone is resolved by CloudKit, and the
    /// wrong-database save fails harmlessly (zoneNotFound) while the right
    /// one succeeds. v1 keeps the owner as the only person who runs
    /// `startSharing`, so in practice cells from invitees flow via shared.
    private func engineOwningZone(_ zoneID: CKRecordZone.ID) -> CKSyncEngine {
        if let sharedEngine, knownSharedZones.contains(zoneID.zoneName) {
            return sharedEngine
        }
        return privateEngine ?? sharedEngine!
    }

    private var knownSharedZones: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: "birdie.ck.sharedZones") ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: "birdie.ck.sharedZones") }
    }

    // MARK: Record mapping

    static func zoneID(for roundID: UUID) -> CKRecordZone.ID {
        CKRecordZone.ID(zoneName: "round-\(roundID.uuidString)", ownerName: CKCurrentUserDefaultName)
    }

    static func roundID(fromZoneName name: String) -> UUID? {
        guard name.hasPrefix("round-") else { return nil }
        return UUID(uuidString: String(name.dropFirst("round-".count)))
    }

    static func cellRecordID(roundID: UUID, playerID: UUID, hole: Int, zoneID: CKRecordZone.ID) -> CKRecord.ID {
        CKRecord.ID(recordName: "cell|\(playerID.uuidString)|\(hole)", zoneID: zoneID)
    }

    private func record(for recordID: CKRecord.ID) -> CKRecord? {
        guard let roundID = Self.roundID(fromZoneName: recordID.zoneID.zoneName) else { return nil }

        switch recordID.recordName {
        case "seed":
            guard let seed = seeds[roundID], let data = try? JSONEncoder().encode(seed) else { return nil }
            let record = CKRecord(recordType: "RoundBlob", recordID: recordID)
            record["data"] = data as NSData
            return record

        case "events":
            guard let changeSet = outbox[roundID],
                  let data = try? JSONEncoder().encode(changeSet.events) else { return nil }
            let record = CKRecord(recordType: "RoundBlob", recordID: recordID)
            record["data"] = data as NSData
            return record

        case "withdrawals":
            guard let changeSet = outbox[roundID],
                  let data = try? JSONEncoder().encode(changeSet.withdrawals) else { return nil }
            let record = CKRecord(recordType: "RoundBlob", recordID: recordID)
            record["data"] = data as NSData
            return record

        default:
            guard let cell = cellFor(recordID: recordID, roundID: roundID) else { return nil }
            let record = CKRecord(recordType: "ScoreCell", recordID: recordID)
            Self.write(cell, to: record)
            return record
        }
    }

    private func cellFor(recordID: CKRecord.ID, roundID: UUID) -> ScoreCell? {
        let parts = recordID.recordName.split(separator: "|")
        guard parts.count == 3, parts[0] == "cell",
              let playerID = UUID(uuidString: String(parts[1])),
              let hole = Int(parts[2])
        else { return nil }
        return outbox[roundID]?.cells.first { $0.playerID == playerID && $0.hole == hole }
    }

    static func write(_ cell: ScoreCell, to record: CKRecord) {
        record["strokes"] = cell.strokes.map { NSNumber(value: $0) }
        record["putts"] = cell.putts.map { NSNumber(value: $0) }
        record["fairwayHit"] = cell.fairwayHit.map { NSNumber(value: $0) }
        record["gir"] = cell.greenInRegulation.map { NSNumber(value: $0) }
        record["updatedAt"] = cell.updatedAt as NSDate
        record["editorID"] = cell.editorID as NSString
    }

    static func readCell(from record: CKRecord) -> ScoreCell? {
        let parts = record.recordID.recordName.split(separator: "|")
        guard parts.count == 3,
              let playerID = UUID(uuidString: String(parts[1])),
              let hole = Int(parts[2]),
              let updatedAt = record["updatedAt"] as? Date,
              let editorID = record["editorID"] as? String
        else { return nil }
        return ScoreCell(
            playerID: playerID,
            hole: hole,
            strokes: record["strokes"] as? Int,
            putts: record["putts"] as? Int,
            fairwayHit: record["fairwayHit"] as? Bool,
            greenInRegulation: record["gir"] as? Bool,
            updatedAt: updatedAt,
            editorID: editorID
        )
    }

    // MARK: Engine state persistence

    private static func loadEngineState(key: String) -> CKSyncEngine.State.Serialization? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: data)
    }

    private static func saveEngineState(_ state: CKSyncEngine.State.Serialization, key: String) {
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }

    private func stateKey(for engine: CKSyncEngine) -> String {
        engine === privateEngine ? "birdie.ck.state.private" : "birdie.ck.state.shared"
    }
}

// MARK: - CKSyncEngineDelegate

extension CloudKitSyncService: CKSyncEngineDelegate {

    nonisolated func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
        await handle(event: event, engine: syncEngine)
    }

    private func handle(event: CKSyncEngine.Event, engine: CKSyncEngine) async {
        switch event {
        case .stateUpdate(let update):
            Self.saveEngineState(update.stateSerialization, key: stateKey(for: engine))

        case .accountChange:
            status = CloudKitSyncService.isAvailable ? .idle(lastSync: nil) : .localOnly

        case .fetchedDatabaseChanges(let changes):
            // Track zones that appear in the shared DB so uploads route there.
            if engine === sharedEngine {
                var zones = knownSharedZones
                for modification in changes.modifications {
                    zones.insert(modification.zoneID.zoneName)
                }
                knownSharedZones = zones
            }

        case .fetchedRecordZoneChanges(let changes):
            ingest(modifications: changes.modifications.map(\.record))

        case .sentRecordZoneChanges(let sent):
            for failure in sent.failedRecordSaves {
                resolveConflict(failure: failure, engine: engine)
            }

        case .willFetchChanges, .willSendChanges:
            status = .syncing

        case .didFetchChanges, .didSendChanges:
            status = .idle(lastSync: Date())

        default:
            break
        }
    }

    nonisolated func nextRecordZoneChangeBatch(
        _ context: CKSyncEngine.SendChangesContext,
        syncEngine: CKSyncEngine
    ) async -> CKSyncEngine.RecordZoneChangeBatch? {
        let pending = syncEngine.state.pendingRecordZoneChanges.filter {
            context.options.scope.contains($0)
        }
        return await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: pending) { recordID in
            await self.record(for: recordID)
        }
    }

    // MARK: Incoming records → RoundChangeSet

    private func ingest(modifications: [CKRecord]) {
        var changeSets: [UUID: RoundChangeSet] = [:]

        for record in modifications {
            guard let roundID = Self.roundID(fromZoneName: record.recordID.zoneID.zoneName) else { continue }

            switch record.recordID.recordName {
            case "seed":
                if let data = record["data"] as? Data,
                   let seed = try? JSONDecoder().decode(RoundSeed.self, from: data) {
                    seeds[roundID] = seed
                    incomingRoundsContinuation.yield(seed)
                }
            case "events":
                if let data = record["data"] as? Data,
                   let events = try? JSONDecoder().decode(RoundEvents.self, from: data) {
                    changeSets[roundID, default: RoundChangeSet()].events =
                        changeSets[roundID, default: RoundChangeSet()].events.union(events)
                }
            case "withdrawals":
                if let data = record["data"] as? Data,
                   let map = try? JSONDecoder().decode([UUID: Int].self, from: data) {
                    var set = changeSets[roundID, default: RoundChangeSet()]
                    for (player, hole) in map {
                        set.withdrawals[player] = min(set.withdrawals[player] ?? hole, hole)
                    }
                    changeSets[roundID] = set
                }
            default:
                if let cell = Self.readCell(from: record) {
                    changeSets[roundID, default: RoundChangeSet()].cells.append(cell)
                }
            }
        }

        for (roundID, changeSet) in changeSets {
            updatesContinuation.yield(RemoteRoundUpdate(roundID: roundID, changeSet: changeSet))
        }
    }

    // MARK: Conflicts

    /// CloudKit rejected our save because the server copy moved. Merge with
    /// the same deterministic rules as everywhere else and resend if our
    /// merged value differs from the server's.
    private func resolveConflict(failure: CKSyncEngine.Event.SentRecordZoneChanges.FailedRecordSave, engine: CKSyncEngine) {
        guard let ckError = failure.error as? CKError,
              ckError.code == .serverRecordChanged,
              let serverRecord = ckError.serverRecord
        else {
            return // Other failures (quota, auth) surface via status; engine retries transient ones.
        }

        let recordID = failure.record.recordID
        guard let roundID = Self.roundID(fromZoneName: recordID.zoneID.zoneName) else { return }

        switch recordID.recordName {
        case "events":
            if let serverData = serverRecord["data"] as? Data,
               let serverEvents = try? JSONDecoder().decode(RoundEvents.self, from: serverData),
               let localEvents = outbox[roundID]?.events {
                let merged = serverEvents.union(localEvents)
                if let data = try? JSONEncoder().encode(merged) {
                    serverRecord["data"] = data as CKRecordValue
                    // Adopt merged state locally too.
                    updatesContinuation.yield(RemoteRoundUpdate(
                        roundID: roundID,
                        changeSet: RoundChangeSet(events: merged)
                    ))
                }
            }
        case "withdrawals":
            if let serverData = serverRecord["data"] as? Data,
               let serverMap = try? JSONDecoder().decode([UUID: Int].self, from: serverData),
               let localMap = outbox[roundID]?.withdrawals {
                var merged = serverMap
                for (player, hole) in localMap {
                    merged[player] = min(merged[player] ?? hole, hole)
                }
                if let data = try? JSONEncoder().encode(merged) {
                    serverRecord["data"] = data as CKRecordValue
                }
            }
        case "seed":
            if let localSeed = seeds[roundID],
               let serverData = serverRecord["data"] as? Data,
               let serverSeed = try? JSONDecoder().decode(RoundSeed.self, from: serverData) {
                let merged = serverSeed.unioningBets(from: localSeed)
                seeds[roundID] = merged
                if let data = try? JSONEncoder().encode(merged) {
                    serverRecord["data"] = data as CKRecordValue
                }
            }
        default:
            if let localCell = cellFor(recordID: recordID, roundID: roundID) {
                if let serverCell = Self.readCell(from: serverRecord) {
                    let winner = RoundMerge.newer(localCell, serverCell)
                    if winner == serverCell {
                        // Server wins: take it locally, nothing to resend.
                        updatesContinuation.yield(RemoteRoundUpdate(
                            roundID: roundID,
                            changeSet: RoundChangeSet(cells: [serverCell])
                        ))
                        return
                    }
                }
                Self.write(localCell, to: serverRecord)
            }
        }

        // Resend on top of the server's record version.
        engine.state.add(pendingRecordZoneChanges: [.saveRecord(recordID)])
    }
}

// MARK: - RoundSeed

/// Everything an invitee needs to materialize a round locally.
struct RoundSeed: Codable, Sendable {
    struct SeedPlayer: Codable, Sendable {
        let id: UUID
        let name: String
        let emoji: String
        let playingHandicap: Int
        let teeOrder: Int
    }

    struct SeedBet: Codable, Sendable {
        let id: UUID
        let name: String
        let kindData: Data
    }

    let roundID: UUID
    let courseID: String
    let courseData: Data
    let holeCount: Int
    let players: [SeedPlayer]
    let bets: [SeedBet]

    init(round: Round) {
        roundID = round.id
        courseID = round.courseID
        courseData = round.courseData
        holeCount = round.holeCount
        players = round.players
            .sorted { $0.teeOrder < $1.teeOrder }
            .map { SeedPlayer(id: $0.id, name: $0.name, emoji: $0.emoji, playingHandicap: $0.playingHandicap, teeOrder: $0.teeOrder) }
        bets = round.bets.map { SeedBet(id: $0.id, name: $0.name, kindData: $0.kindData) }
    }

    private init(roundID: UUID, courseID: String, courseData: Data, holeCount: Int, players: [SeedPlayer], bets: [SeedBet]) {
        self.roundID = roundID
        self.courseID = courseID
        self.courseData = courseData
        self.holeCount = holeCount
        self.players = players
        self.bets = bets
    }

    /// Bets are add-only, so seed conflicts merge by ID union.
    func unioningBets(from other: RoundSeed) -> RoundSeed {
        var merged = bets
        for bet in other.bets where !merged.contains(where: { $0.id == bet.id }) {
            merged.append(bet)
        }
        return RoundSeed(
            roundID: roundID, courseID: courseID, courseData: courseData,
            holeCount: holeCount, players: players, bets: merged
        )
    }
}
