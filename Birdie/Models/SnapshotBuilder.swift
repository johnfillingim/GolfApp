import Foundation
import SwiftData
import Scoring

/// Bridges SwiftData models to the pure `Scoring` types, and applies remote
/// changesets back onto the store. All merge decisions delegate to
/// `Scoring.RoundMerge`, so persistence and conflict resolution stay
/// separately testable.
enum SnapshotBuilder {

    // MARK: Encoding helpers

    private static let encoder = JSONEncoder()
    private static let decoder = JSONDecoder()

    static func decodeEvents(_ data: Data) -> RoundEvents {
        guard !data.isEmpty, let events = try? decoder.decode(RoundEvents.self, from: data) else {
            return RoundEvents()
        }
        return events
    }

    static func decodeWithdrawals(_ data: Data) -> [UUID: Int] {
        guard !data.isEmpty, let map = try? decoder.decode([UUID: Int].self, from: data) else {
            return [:]
        }
        return map
    }

    static func encodeEvents(_ events: RoundEvents) -> Data {
        (try? encoder.encode(events)) ?? Data()
    }

    static func encodeWithdrawals(_ map: [UUID: Int]) -> Data {
        (try? encoder.encode(map)) ?? Data()
    }

    static func decodeBet(_ model: BetModel) -> Bet? {
        guard let kind = try? decoder.decode(BetKind.self, from: model.kindData) else { return nil }
        return Bet(id: model.id, name: model.name, kind: kind)
    }

    static func encodeBetKind(_ kind: BetKind) -> Data {
        (try? encoder.encode(kind)) ?? Data()
    }

    // MARK: Snapshot

    /// The scoring engine's view of a round, rebuilt after every change.
    /// Cost is O(players × holes) — trivial next to a SwiftUI render pass.
    static func snapshot(for round: Round) -> RoundSnapshot {
        let course = CatalogCourse.decode(round.courseData)?.courseInfo
            ?? CourseInfo(name: "Unknown", holes: (1...round.holeCount).map {
                HoleInfo(number: $0, par: 4, strokeIndex: $0)
            })

        let players = round.players
            .sorted { $0.teeOrder < $1.teeOrder }
            .map { ScoringPlayer(id: $0.id, name: $0.name, playingHandicap: $0.playingHandicap) }

        var scores: [PlayerID: [Int: Int]] = [:]
        for cell in round.scores {
            guard let strokes = cell.strokes else { continue }
            scores[cell.playerID, default: [:]][cell.hole] = strokes
        }

        return RoundSnapshot(
            course: course,
            players: players,
            scores: scores,
            withdrawals: decodeWithdrawals(round.withdrawalsData),
            events: decodeEvents(round.eventsData)
        )
    }

    static func bets(for round: Round) -> [Bet] {
        round.bets
            .sorted { $0.createdAt < $1.createdAt }
            .compactMap(decodeBet)
    }

    // MARK: Score cell access

    /// The one place that reads/creates score rows, enforcing the
    /// (round, player, hole) uniqueness SwiftData can't express.
    static func scoreCell(in round: Round, player: PlayerID, hole: Int) -> HoleScoreModel? {
        round.scores.first { $0.playerID == player && $0.hole == hole }
    }

    @discardableResult
    static func upsertScore(
        in round: Round,
        context: ModelContext,
        player: PlayerID,
        hole: Int,
        mutate: (HoleScoreModel) -> Void
    ) -> HoleScoreModel {
        let cell: HoleScoreModel
        if let existing = scoreCell(in: round, player: player, hole: hole) {
            cell = existing
        } else {
            cell = HoleScoreModel(playerID: player, hole: hole, strokes: nil, editorID: DeviceIdentity.id)
            context.insert(cell)
            cell.round = round
            round.scores.append(cell)
        }
        mutate(cell)
        cell.updatedAt = Date()
        cell.editorID = DeviceIdentity.id
        return cell
    }

    // MARK: Changesets (sync)

    /// Everything that syncs, in the wire shape `RoundMerge` understands.
    static func changeSet(for round: Round) -> RoundChangeSet {
        let cells = round.scores.map { model in
            ScoreCell(
                playerID: model.playerID,
                hole: model.hole,
                strokes: model.strokes,
                putts: model.putts,
                fairwayHit: model.fairwayHit,
                greenInRegulation: model.greenInRegulation,
                updatedAt: model.updatedAt,
                editorID: model.editorID
            )
        }
        return RoundChangeSet(
            cells: cells,
            events: decodeEvents(round.eventsData),
            withdrawals: decodeWithdrawals(round.withdrawalsData)
        )
    }

    /// Merges a remote changeset into the round. Deterministic: both sides
    /// converge on identical state regardless of merge order.
    static func apply(_ remote: RoundChangeSet, to round: Round, context: ModelContext) {
        let merged = RoundMerge.merged(changeSet(for: round), remote)

        for cell in merged.cells {
            upsert(cell: cell, in: round, context: context)
        }
        round.eventsData = encodeEvents(merged.events)
        round.withdrawalsData = encodeWithdrawals(merged.withdrawals)
    }

    private static func upsert(cell: ScoreCell, in round: Round, context: ModelContext) {
        if let existing = scoreCell(in: round, player: cell.playerID, hole: cell.hole) {
            // Only touch the row if the merged value actually differs —
            // avoids invalidating SwiftUI for no reason.
            guard existing.updatedAt != cell.updatedAt || existing.editorID != cell.editorID else { return }
            existing.strokes = cell.strokes
            existing.putts = cell.putts
            existing.fairwayHit = cell.fairwayHit
            existing.greenInRegulation = cell.greenInRegulation
            existing.updatedAt = cell.updatedAt
            existing.editorID = cell.editorID
        } else {
            let model = HoleScoreModel(
                playerID: cell.playerID,
                hole: cell.hole,
                strokes: cell.strokes,
                putts: cell.putts,
                fairwayHit: cell.fairwayHit,
                greenInRegulation: cell.greenInRegulation,
                updatedAt: cell.updatedAt,
                editorID: cell.editorID
            )
            context.insert(model)
            model.round = round
            round.scores.append(model)
        }
    }
}

/// Stable per-install identifier used as the LWW tiebreak (`editorID`).
/// Persisted in UserDefaults: survives app restarts, unique per device —
/// exactly the properties deterministic merge needs.
enum DeviceIdentity {
    private static let key = "birdie.device.id"

    static let id: String = {
        if let existing = UserDefaults.standard.string(forKey: key) {
            return existing
        }
        let fresh = UUID().uuidString
        UserDefaults.standard.set(fresh, forKey: key)
        return fresh
    }()
}
