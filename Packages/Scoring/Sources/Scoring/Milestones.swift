import Foundation

/// Score-quality moments (independent of any bet): birdies, eagles, aces,
/// and birdie streaks. The CelebrationEngine consumes these alongside
/// `ScoringEvent`s; like them, milestones carry stable IDs so re-evaluating
/// a snapshot never re-fires a celebration.
public struct Milestone: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable {
        case birdie
        case eagle
        case albatross
        case holeInOne
        /// `count` consecutive holes at birdie or better, fired at each
        /// extension (2, 3, 4…).
        case birdieStreak(count: Int)
    }

    public let id: String
    public let kind: Kind
    public let player: PlayerID
    public let hole: Int

    public init(id: String, kind: Kind, player: PlayerID, hole: Int) {
        self.id = id
        self.kind = kind
        self.player = player
        self.hole = hole
    }
}

public enum MilestoneDetector {

    /// All milestones present in the snapshot, ordered by hole then player
    /// tee order. Gross scores only — a net birdie is money, not glory.
    public static func milestones(in snapshot: RoundSnapshot) -> [Milestone] {
        var result: [Milestone] = []

        for player in snapshot.players {
            var streak = 0
            for hole in snapshot.holeNumbers {
                guard let par = snapshot.course.hole(hole)?.par,
                      let gross = snapshot.gross(player.id, hole: hole)
                else {
                    // A gap (unscored hole) breaks any running streak.
                    streak = 0
                    continue
                }

                let toPar = gross - par

                // An ace outranks its to-par classification (an ace on a
                // par 3 is also an eagle — celebrate the ace).
                if gross == 1 {
                    result.append(Milestone(id: "ace-\(player.id)-\(hole)", kind: .holeInOne, player: player.id, hole: hole))
                } else if toPar == -1 {
                    result.append(Milestone(id: "birdie-\(player.id)-\(hole)", kind: .birdie, player: player.id, hole: hole))
                } else if toPar == -2 {
                    result.append(Milestone(id: "eagle-\(player.id)-\(hole)", kind: .eagle, player: player.id, hole: hole))
                } else if toPar <= -3 {
                    result.append(Milestone(id: "albatross-\(player.id)-\(hole)", kind: .albatross, player: player.id, hole: hole))
                }

                if toPar <= -1 {
                    streak += 1
                    if streak >= 2 {
                        result.append(Milestone(
                            id: "streak-\(player.id)-\(hole)-\(streak)",
                            kind: .birdieStreak(count: streak),
                            player: player.id,
                            hole: hole
                        ))
                    }
                } else {
                    streak = 0
                }
            }
        }

        return result.sorted {
            ($0.hole, snapshot.orderIndex(of: $0.player)) < ($1.hole, snapshot.orderIndex(of: $1.player))
        }
    }
}
