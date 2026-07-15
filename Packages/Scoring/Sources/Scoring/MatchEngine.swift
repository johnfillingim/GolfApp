import Foundation

/// The result of running one match (side A vs side B over an ordered set of
/// holes). Shared by Match Play, every Nassau segment, and every press.
public struct MatchComputation: Sendable {
    public struct HoleResult: Hashable, Sendable {
        public let hole: Int
        /// nil = halved.
        public let winner: MatchSide?
        /// Cumulative up-count (A positive) after this hole.
        public let upAAfter: Int
        /// True when the hole was decided by concession (withdrawal) rather
        /// than by scores.
        public let byConcession: Bool
    }

    public let status: MatchStatus
    /// Decided holes in play order (stops at the point the match closed).
    public let holeResults: [HoleResult]
    /// Holes with no result yet (missing scores), still able to count.
    public let pendingHoles: [Int]
}

/// Pure hole-by-hole match evaluator.
///
/// Rules encoded here:
/// - **Best ball**: a side's score on a hole is the lowest net score among its
///   active members. All active members of both sides must have posted before
///   the hole counts (a partially-entered best-ball hole could otherwise flip
///   after being "decided").
/// - **Pending holes stay live**: a skipped hole (no scores yet) counts toward
///   `remaining`, because it can still be filled in. Mathematical closure
///   (`|up| > remaining`) is therefore safe even with gaps: the trailing side
///   cannot catch up even by winning every pending hole.
/// - **Withdrawals concede**: once every member of a side has withdrawn, each
///   later hole is conceded to the other side (if it still has anyone
///   standing). If both sides are gone, remaining holes are halved.
/// - **Auto-close**: once `|up| > remaining` the match is over; later holes
///   are ignored for this match.
public enum MatchEngine {

    /// Who won each hole, with no notion of match closure. Nassau computes
    /// this once per segment and derives the original bet and every press
    /// from the same outcome table.
    public struct RawOutcome: Hashable, Sendable {
        public let winner: MatchSide?   // nil = halved
        public let byConcession: Bool
    }

    public struct RawOutcomes: Sendable {
        /// Decided holes only.
        public let byHole: [Int: RawOutcome]
        /// Holes with missing scores, ascending.
        public let pendingHoles: [Int]
    }

    public static func rawOutcomes(
        sideA: [PlayerID],
        sideB: [PlayerID],
        holes: [Int],
        snapshot: RoundSnapshot,
        mode: HandicapMode,
        allowance: HandicapAllowance
    ) -> RawOutcomes {
        let participants = (sideA + sideB).compactMap { snapshot.player($0) }
        let courseHoles = snapshot.holeNumbers.compactMap { snapshot.course.hole($0) }
        // Strokes fall on the holes where the full round's stroke index puts
        // them — a front-nine segment does not re-spread the handicap.
        let strokes = StrokeAllocator.table(
            for: participants,
            holes: courseHoles,
            mode: mode,
            allowance: allowance
        )

        func net(_ player: PlayerID, _ hole: Int) -> Int? {
            guard let gross = snapshot.gross(player, hole: hole) else { return nil }
            return gross - (strokes[player]?[hole] ?? 0)
        }

        var byHole: [Int: RawOutcome] = [:]
        var pending: [Int] = []

        for hole in holes.sorted() {
            let activeA = snapshot.activePlayers(of: sideA, atHole: hole)
            let activeB = snapshot.activePlayers(of: sideB, atHole: hole)

            switch (activeA.isEmpty, activeB.isEmpty) {
            case (true, true):
                byHole[hole] = RawOutcome(winner: nil, byConcession: true)
            case (true, false):
                byHole[hole] = RawOutcome(winner: .b, byConcession: true)
            case (false, true):
                byHole[hole] = RawOutcome(winner: .a, byConcession: true)
            case (false, false):
                let netsA = activeA.map { net($0, hole) }
                let netsB = activeB.map { net($0, hole) }
                if netsA.contains(where: { $0 == nil }) || netsB.contains(where: { $0 == nil }) {
                    pending.append(hole)
                } else {
                    let bestA = netsA.compactMap { $0 }.min()!
                    let bestB = netsB.compactMap { $0 }.min()!
                    let winner: MatchSide? = bestA < bestB ? .a : (bestB < bestA ? .b : nil)
                    byHole[hole] = RawOutcome(winner: winner, byConcession: false)
                }
            }
        }

        return RawOutcomes(byHole: byHole, pendingHoles: pending)
    }

    /// Applies cumulative match logic (closure, dormie, display) to a hole
    /// range using a precomputed outcome table.
    public static func status(over holes: [Int], outcomes: RawOutcomes) -> MatchComputation {
        var results: [MatchComputation.HoleResult] = []
        var pending: [Int] = []
        var upA = 0
        var closed = false

        for hole in holes.sorted() {
            if closed { break }
            guard let outcome = outcomes.byHole[hole] else {
                pending.append(hole)
                continue
            }
            switch outcome.winner {
            case .a: upA += 1
            case .b: upA -= 1
            case nil: break
            }
            results.append(.init(hole: hole, winner: outcome.winner, upAAfter: upA, byConcession: outcome.byConcession))

            // Undecided = total - decided. Pending holes are still undecided
            // (they may be filled in later), so they count toward what the
            // trailing side could still win.
            let undecided = holes.count - results.count
            if abs(upA) > undecided {
                closed = true
            }
        }

        let undecided = holes.count - results.count

        var status = MatchStatus(
            holesDecided: results.count,
            upA: upA,
            remaining: undecided,
            closed: closed,
            winner: nil,
            dormieSide: nil,
            thruHole: results.map(\.hole).max()
        )

        if closed {
            status.winner = upA > 0 ? .a : .b
        } else if undecided == 0 {
            status.winner = upA > 0 ? .a : (upA < 0 ? .b : nil)
        } else if abs(upA) == undecided, upA != 0 {
            status.dormieSide = upA > 0 ? .a : .b
        }

        status.display = display(for: status)

        return MatchComputation(status: status, holeResults: results, pendingHoles: pending)
    }

    /// One-shot convenience: raw outcomes + status over the same range.
    public static func compute(
        sideA: [PlayerID],
        sideB: [PlayerID],
        holes: [Int],
        snapshot: RoundSnapshot,
        mode: HandicapMode,
        allowance: HandicapAllowance
    ) -> MatchComputation {
        let outcomes = rawOutcomes(
            sideA: sideA, sideB: sideB, holes: holes,
            snapshot: snapshot, mode: mode, allowance: allowance
        )
        return status(over: holes, outcomes: outcomes)
    }

    /// Conventional match-play status strings.
    static func display(for status: MatchStatus) -> String {
        let margin = status.margin
        if status.closed {
            // "3&2" when decided with holes to spare; closing on the final
            // hole reads "2 UP".
            return status.remaining > 0 ? "\(margin)&\(status.remaining)" : "\(margin) UP"
        }
        if status.holesDecided == 0 {
            return "Not started"
        }
        let thru = status.thruHole.map { " thru \($0)" } ?? ""
        if status.remaining == 0 {
            return margin == 0 ? "Halved" : "Final: \(margin) UP"
        }
        if status.dormieSide != nil {
            return "Dormie \(margin)"
        }
        return margin == 0 ? "AS\(thru)" : "\(margin) UP\(thru)"
    }
}
