import Foundation
import SwiftData
import Scoring

/// The live-round brain: owns the (snapshot → evaluations) pipeline for one
/// round and funnels every mutation through the offline-first sequence:
///
///   1. write SwiftData (source of truth — UI reads only this)
///   2. recompute snapshot + bet evaluations (pure, from Scoring)
///   3. hand new milestones/events to the CelebrationEngine (dedup by ID)
///   4. queue the changeset for sync (fire-and-forget)
///
/// Remote changes arrive via `AppEnvironment`'s sync pump, are merged into
/// SwiftData by `SnapshotBuilder.apply`, and land back here through
/// `remoteDidChange()` — same recompute path, so a synced birdie celebrates
/// exactly like a local one.
@MainActor
@Observable
final class RoundSession {

    let round: Round
    private let context: ModelContext
    private let sync: any SyncService
    private let celebrations: CelebrationEngine

    private(set) var snapshot: RoundSnapshot
    private(set) var bets: [Bet]
    private(set) var evaluations: [BetEvaluation] = []
    private(set) var milestones: [Milestone] = []

    /// The hole the local player is looking at (defaults to first unscored).
    var currentHole: Int

    /// The RoundPlayer identity of the device owner, when they're playing.
    let myPlayerID: PlayerID?

    init(round: Round, context: ModelContext, sync: any SyncService, celebrations: CelebrationEngine, myProfileID: UUID?) {
        self.round = round
        self.context = context
        self.sync = sync
        self.celebrations = celebrations
        self.myPlayerID = round.players.first { $0.profileID != nil && $0.profileID == myProfileID }?.id

        let snapshot = SnapshotBuilder.snapshot(for: round)
        self.snapshot = snapshot
        self.bets = SnapshotBuilder.bets(for: round)
        self.currentHole = Self.firstOpenHole(snapshot: snapshot, playerID: myPlayerID)

        celebrations.attach(roundID: round.id)
        recompute(celebrate: false)
        // Joining a round with history stays quiet: everything computed so
        // far is marked celebrated without firing.
        celebrations.suppressExisting(milestones: milestones, events: evaluations.flatMap(\.events))
    }

    private static func firstOpenHole(snapshot: RoundSnapshot, playerID: PlayerID?) -> Int {
        guard let playerID else { return snapshot.holeNumbers.first ?? 1 }
        return snapshot.holeNumbers.first { snapshot.gross(playerID, hole: $0) == nil }
            ?? snapshot.holeNumbers.last ?? 1
    }

    // MARK: Recompute pipeline

    func recompute(celebrate: Bool = true) {
        snapshot = SnapshotBuilder.snapshot(for: round)
        bets = SnapshotBuilder.bets(for: round)
        evaluations = BetEvaluator.evaluateAll(bets, snapshot: snapshot)
        milestones = MilestoneDetector.milestones(in: snapshot)

        if celebrate {
            celebrations.ingest(
                milestones: milestones,
                events: evaluations.flatMap(\.events),
                snapshot: snapshot,
                myPlayerID: myPlayerID
            )
        }
    }

    /// Called by the sync pump after a remote changeset merged into SwiftData.
    func remoteDidChange() {
        recompute(celebrate: true)
    }

    private func pushToSync() {
        sync.scheduleUpload(roundID: round.id, changeSet: SnapshotBuilder.changeSet(for: round))
    }

    // MARK: Score entry

    func strokes(for player: PlayerID, hole: Int) -> Int? {
        snapshot.gross(player, hole: hole)
    }

    func setStrokes(_ strokes: Int?, player: PlayerID, hole: Int) {
        SnapshotBuilder.upsertScore(in: round, context: context, player: player, hole: hole) {
            $0.strokes = strokes.map { max(1, min($0, 19)) }
        }
        HapticPlayer.shared.tick()
        recompute()
        pushToSync()
    }

    func adjustStrokes(player: PlayerID, hole: Int, delta: Int) {
        let par = snapshot.course.hole(hole)?.par ?? 4
        let current = strokes(for: player, hole: hole)
        // First tap lands on par — the most common score — so a typical
        // hole is one or two thumb taps, gloved.
        let next = current.map { $0 + delta } ?? par
        setStrokes(max(1, min(next, 19)), player: player, hole: hole)
    }

    func setPutts(_ putts: Int?, player: PlayerID, hole: Int) {
        SnapshotBuilder.upsertScore(in: round, context: context, player: player, hole: hole) {
            $0.putts = putts.map { max(0, min($0, 9)) }
        }
        recompute(celebrate: false)
        pushToSync()
    }

    func setFairway(_ hit: Bool?, player: PlayerID, hole: Int) {
        SnapshotBuilder.upsertScore(in: round, context: context, player: player, hole: hole) {
            $0.fairwayHit = hit
        }
        recompute(celebrate: false)
        pushToSync()
    }

    func setGIR(_ hit: Bool?, player: PlayerID, hole: Int) {
        SnapshotBuilder.upsertScore(in: round, context: context, player: player, hole: hole) {
            $0.greenInRegulation = hit
        }
        recompute(celebrate: false)
        pushToSync()
    }

    func scoreCell(player: PlayerID, hole: Int) -> HoleScoreModel? {
        SnapshotBuilder.scoreCell(in: round, player: player, hole: hole)
    }

    // MARK: Bet events

    func declarePress(betID: UUID, segment: NassauSegment, fromHole: Int, by side: MatchSide) {
        var events = SnapshotBuilder.decodeEvents(round.eventsData)
        events.presses.append(PressEvent(betID: betID, segment: segment, firstHole: fromHole, pressedBy: side))
        round.eventsData = SnapshotBuilder.encodeEvents(events)
        HapticPlayer.shared.confirm()
        recompute()
        pushToSync()
    }

    func declareWolf(betID: UUID, hole: Int, wolf: PlayerID, choice: WolfChoice) {
        var events = SnapshotBuilder.decodeEvents(round.eventsData)
        guard !events.wolfDecisions.contains(where: { $0.betID == betID && $0.hole == hole }) else { return }
        events.wolfDecisions.append(WolfDecision(betID: betID, hole: hole, wolf: wolf, choice: choice))
        round.eventsData = SnapshotBuilder.encodeEvents(events)
        HapticPlayer.shared.confirm()
        recompute()
        pushToSync()
    }

    func withdraw(player: PlayerID, afterHole: Int) {
        var withdrawals = SnapshotBuilder.decodeWithdrawals(round.withdrawalsData)
        withdrawals[player] = min(withdrawals[player] ?? afterHole, afterHole)
        round.withdrawalsData = SnapshotBuilder.encodeWithdrawals(withdrawals)
        HapticPlayer.shared.warning()
        recompute()
        pushToSync()
    }

    /// Adds a bet mid-round (how late joiners get action — `firstHole` in
    /// the config takes it from here). Existing bets are immutable.
    func addBet(_ bet: Bet) {
        let model = BetModel(id: bet.id, name: bet.name, kindData: SnapshotBuilder.encodeBetKind(bet.kind))
        context.insert(model)
        model.round = round
        round.bets.append(model)
        recompute(celebrate: false)
        pushToSync()
    }

    // MARK: Wolf helpers (UI)

    /// The bet + expected wolf if `hole` needs a wolf declaration.
    func pendingWolfDecision(hole: Int) -> (bet: Bet, wolf: ScoringPlayer)? {
        for bet in bets {
            guard case .wolf(let config) = bet.kind else { continue }
            let holes = snapshot.holeNumbers.filter { $0 >= (config.firstHole ?? snapshot.holeNumbers.first ?? 1) }
            guard let index = holes.firstIndex(of: hole) else { continue }
            let wolfID = config.rotation[index % config.rotation.count]
            guard snapshot.isActive(wolfID, atHole: hole),
                  !snapshot.events.wolfDecisions.contains(where: { $0.betID == bet.id && $0.hole == hole }),
                  let wolf = snapshot.player(wolfID)
            else { continue }
            return (bet, wolf)
        }
        return nil
    }

    // MARK: Settlement

    var netBalances: [PlayerID: Money] {
        Settlement.netBalances(evaluations.map(\.projected))
    }

    var settledBalances: [PlayerID: Money] {
        Settlement.netBalances(evaluations.map(\.settled))
    }

    var transfers: [Transfer] {
        Settlement.minimalTransfers(
            balances: settledBalances,
            playerOrder: snapshot.players.map(\.id)
        )
    }

    /// One settle-up row: the computed transfer plus its persisted
    /// paid/unpaid mark.
    struct SettlementLine: Identifiable {
        let transfer: Transfer
        let mark: SettlementMark
        var id: String { transfer.id }
    }

    /// Reconciles SettlementMark rows with the current transfer list
    /// (a late score edit can change the math — marks for vanished
    /// transfers are dropped, new transfers appear unpaid).
    func reconciledMarks() -> [SettlementLine] {
        let current = transfers
        // Drop stale marks.
        for mark in round.settlementMarks where !current.contains(where: { $0.id == mark.transferID }) {
            context.delete(mark)
        }
        // Ensure a mark per transfer.
        return current.map { transfer in
            if let existing = round.settlementMarks.first(where: { $0.transferID == transfer.id }) {
                return SettlementLine(transfer: transfer, mark: existing)
            }
            let mark = SettlementMark(
                transferID: transfer.id,
                fromID: transfer.from,
                toID: transfer.to,
                amountCents: transfer.amount.cents
            )
            context.insert(mark)
            mark.round = round
            round.settlementMarks.append(mark)
            return SettlementLine(transfer: transfer, mark: mark)
        }
    }

    func finishRound() {
        round.status = .finished
        HapticPlayer.shared.confirm()
    }

    // MARK: Display helpers

    func player(_ id: PlayerID) -> ScoringPlayer? {
        snapshot.player(id)
    }

    func emoji(for id: PlayerID) -> String {
        round.players.first { $0.id == id }?.emoji ?? "⛳️"
    }

    var isRoundComplete: Bool {
        snapshot.players.allSatisfy { player in
            snapshot.withdrawals[player.id] != nil ||
            snapshot.holeNumbers.allSatisfy { snapshot.gross(player.id, hole: $0) != nil }
        }
    }
}
