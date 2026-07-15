import Foundation

/// Whether a bet is played on gross scores or net (handicap-adjusted) scores.
public enum HandicapMode: String, Codable, Sendable, CaseIterable {
    case gross
    case net
}

/// How playing handicaps are applied in head-to-head formats.
///
/// - `full`: every player receives their full allocation (usual for skins,
///   stroke play, wolf).
/// - `offLow`: handicaps are reduced by the lowest handicap among the bet's
///   participants, so the best player plays at scratch (the USGA convention
///   for match play and Nassau).
public enum HandicapAllowance: String, Codable, Sendable, CaseIterable {
    case full
    case offLow
}

/// Allocates a playing handicap to holes by stroke index.
public enum StrokeAllocator {
    /// Strokes received per hole for one player.
    ///
    /// Holes are ranked by their course stroke index *within the set being
    /// played* — so a back-nine round whose raw stroke indexes are
    /// {2,4,...,18} still hands out the first stroke on its hardest hole.
    ///
    /// Standard allocation: handicap `h` over `n` holes gives `h / n` strokes
    /// everywhere plus one extra on the `h % n` hardest holes. Plus players
    /// (negative handicap) give strokes back starting at the *easiest* hole,
    /// per USGA convention.
    public static func allocation(handicap: Int, holes: [HoleInfo]) -> [Int: Int] {
        let count = holes.count
        guard count > 0 else { return [:] }

        // Rank 1 = hardest among the holes actually played. Ties in stroke
        // index (shouldn't happen on real cards) break by hole number so the
        // result stays deterministic.
        let ranked = holes.sorted {
            ($0.strokeIndex, $0.number) < ($1.strokeIndex, $1.number)
        }
        var rankOf: [Int: Int] = [:]
        for (index, hole) in ranked.enumerated() {
            rankOf[hole.number] = index + 1
        }

        var result: [Int: Int] = [:]
        if handicap >= 0 {
            let base = handicap / count
            let extras = handicap % count
            for hole in holes {
                result[hole.number] = base + (rankOf[hole.number]! <= extras ? 1 : 0)
            }
        } else {
            // A +2 gives one stroke back on each of the two easiest holes
            // (highest rank numbers).
            let give = -handicap
            let base = give / count
            let extras = give % count
            for hole in holes {
                let givesExtra = rankOf[hole.number]! > count - extras
                result[hole.number] = -(base + (givesExtra ? 1 : 0))
            }
        }
        return result
    }

    /// Net-score table for a set of participants over the round's holes.
    ///
    /// - Parameters:
    ///   - allowance: `.offLow` subtracts the group's lowest handicap first.
    ///   - mode: `.gross` zeroes all allocations (callers can then use one
    ///     code path for both modes).
    /// - Returns: playerID → (hole number → strokes received on that hole).
    public static func table(
        for participants: [ScoringPlayer],
        holes: [HoleInfo],
        mode: HandicapMode,
        allowance: HandicapAllowance = .full
    ) -> [PlayerID: [Int: Int]] {
        guard mode == .net else {
            let empty: [(PlayerID, [Int: Int])] = participants.map { ($0.id, [Int: Int]()) }
            return Dictionary(empty, uniquingKeysWith: { first, _ in first })
        }
        let low = participants.map(\.playingHandicap).min() ?? 0
        let pairs: [(PlayerID, [Int: Int])] = participants.map { player in
            let effective = allowance == .offLow ? player.playingHandicap - low : player.playingHandicap
            return (player.id, allocation(handicap: effective, holes: holes))
        }
        // `uniquingKeysWith` tolerates a malformed config that lists a player
        // twice — better a benign allocation than a crash mid-round.
        return Dictionary(pairs, uniquingKeysWith: { first, _ in first })
    }
}
