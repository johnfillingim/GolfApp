import Foundation

/// The uniform output of evaluating one bet against a `RoundSnapshot`.
///
/// Two money views are exposed:
/// - `settled`: components that are mathematically final (a closed-out match,
///   an awarded skin). This is what "you can't lose it anymore" means.
/// - `projected`: settled money *plus* open components assuming the current
///   leaders hold. This is the number the live standings screen leads with.
///
/// Both dictionaries are zero-sum across players — verified by
/// `BetEvaluator` on every evaluation.
public struct BetEvaluation: Sendable {
    public let betID: UUID
    public let betName: String
    public let kindName: String

    /// One-line status for cards and headers, e.g.
    /// "F: Jack 2↑ · B: AS · T: Jack 1↑ · 2 presses".
    public let headline: String

    /// Per-component rows for detail UI (one per Nassau segment/press, one
    /// per skin outcome group, etc.).
    public let lines: [StandingLine]

    public let settled: [PlayerID: Money]
    public let projected: [PlayerID: Money]

    /// Deterministic, stably-identified moments (skin won, match closed,
    /// press started…) for the CelebrationEngine. Because IDs are stable,
    /// re-evaluations never double-fire a celebration.
    public let events: [ScoringEvent]

    public let detail: BetDetail

    public init(
        betID: UUID,
        betName: String,
        kindName: String,
        headline: String,
        lines: [StandingLine],
        settled: [PlayerID: Money],
        projected: [PlayerID: Money],
        events: [ScoringEvent],
        detail: BetDetail
    ) {
        self.betID = betID
        self.betName = betName
        self.kindName = kindName
        self.headline = headline
        self.lines = lines
        self.settled = settled
        self.projected = projected
        self.events = events
        self.detail = detail
    }
}

/// A single display row in the standings detail for a bet.
public struct StandingLine: Hashable, Sendable, Identifiable {
    public let id: String
    /// Row label, e.g. "Front 9", "Press #2 (from 7)", "Hole 4 — 3 skins".
    public let title: String
    /// Row status, e.g. "Jack 2 UP thru 8", "Carried", "Dormie".
    public let status: String
    /// Players currently winning this component (drives the up/down color
    /// language in the UI).
    public let leaders: [PlayerID]
    /// Whether this component is final.
    public let isSettled: Bool

    public init(id: String, title: String, status: String, leaders: [PlayerID], isSettled: Bool) {
        self.id = id
        self.title = title
        self.status = status
        self.leaders = leaders
        self.isSettled = isSettled
    }
}

/// Format-specific payloads for UIs that want more than the generic lines.
public enum BetDetail: Sendable {
    case nassau(NassauEvaluation)
    case skins(SkinsEvaluation)
    case matchPlay(MatchPlayEvaluation)
    case wolf(WolfEvaluation)
    case strokePlay(StrokePlayEvaluation)
}

// MARK: - Scoring events

/// A discrete bet moment with a *stable identity*. The CelebrationEngine keeps
/// a set of already-fired IDs per round; because evaluation is deterministic,
/// an event either exists with the same ID on every device or not at all.
public struct ScoringEvent: Hashable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable {
        /// `units` skins taken on one hole.
        case skinWon(units: Int)
        /// A press opened (auto or manual).
        case pressStarted(auto: Bool)
        /// A match or segment became mathematically decided.
        case matchClosed(margin: String)
        /// A Nassau segment finished with a winner.
        case segmentDecided(NassauSegment)
        /// Lone/blind wolf took the hole at a multiplier.
        case wolfWon(multiplier: Int)
    }

    public let id: String
    public let kind: Kind
    public let betID: UUID
    /// The players being celebrated (winners).
    public let players: [PlayerID]
    public let hole: Int?
    /// Headline money attached to the moment, when meaningful.
    public let amount: Money?

    public init(id: String, kind: Kind, betID: UUID, players: [PlayerID], hole: Int? = nil, amount: Money? = nil) {
        self.id = id
        self.kind = kind
        self.betID = betID
        self.players = players
        self.hole = hole
        self.amount = amount
    }
}

// MARK: - Match status (shared by Nassau / Match Play)

/// Running state of one match (an original segment bet, a press, or a full
/// match-play bet).
public struct MatchStatus: Hashable, Sendable {
    /// Holes with a decided result so far.
    public var holesDecided: Int
    /// Positive = side A leads by that many holes.
    public var upA: Int
    /// Holes that can still change the result (includes not-yet-entered holes
    /// earlier in the range — a skipped hole can still be filled in later).
    public var remaining: Int
    /// Mathematically over: |upA| > remaining.
    public var closed: Bool
    /// Set when closed, or when all holes are decided and one side leads.
    public var winner: MatchSide?
    /// The side that is dormie (leading by exactly the holes remaining).
    public var dormieSide: MatchSide?
    /// Highest hole number with a decided result (drives "thru N").
    public var thruHole: Int?
    /// Human status: "2 UP thru 12", "3&2", "Dormie 2", "AS thru 4", "Final: 1 UP".
    public var display: String

    public var leader: MatchSide? {
        upA > 0 ? .a : (upA < 0 ? .b : nil)
    }

    /// Margin in holes from the leader's perspective.
    public var margin: Int { abs(upA) }

    public init(
        holesDecided: Int = 0,
        upA: Int = 0,
        remaining: Int = 0,
        closed: Bool = false,
        winner: MatchSide? = nil,
        dormieSide: MatchSide? = nil,
        thruHole: Int? = nil,
        display: String = "—"
    ) {
        self.holesDecided = holesDecided
        self.upA = upA
        self.remaining = remaining
        self.closed = closed
        self.winner = winner
        self.dormieSide = dormieSide
        self.thruHole = thruHole
        self.display = display
    }
}

// MARK: - Per-format evaluation payloads

public struct NassauEvaluation: Sendable {
    public struct BetLine: Sendable {
        public let label: String
        public let segment: NassauSegment
        public let firstHole: Int
        public let isPress: Bool
        public let isAutoPress: Bool
        public let match: MatchComputation
    }

    public struct SegmentResult: Sendable {
        public let segment: NassauSegment
        /// Original bet first, presses in the order they opened.
        public let bets: [BetLine]
    }

    public let segments: [SegmentResult]

    public var pressCount: Int {
        segments.reduce(0) { $0 + $1.bets.filter(\.isPress).count }
    }
}

public struct SkinsEvaluation: Sendable {
    public enum HoleOutcome: Hashable, Sendable {
        /// Winner took `units` skins worth `perPlayer` from each other player.
        case won(winner: PlayerID, units: Int, perPlayer: Money)
        /// Tied; skin carried forward (units now riding shown separately).
        case carried
        /// Tied in no-carryover mode, or validation failed — skin is gone.
        case dead
        /// Not all active players have scores yet.
        case pending
        /// Fewer than two active players — no contest.
        case void
    }

    public let outcomes: [(hole: Int, outcome: HoleOutcome)]
    /// Skins currently riding on the next playable hole.
    public let unitsRiding: Int
    public let skinCounts: [PlayerID: Int]
}

public struct MatchPlayEvaluation: Sendable {
    public let match: MatchComputation
}

public struct WolfEvaluation: Sendable {
    public enum HoleOutcome: Hashable, Sendable {
        case wolfTeamWon(multiplier: Int, units: Int)
        case othersWon(multiplier: Int, units: Int)
        case halved(carried: Bool)
        case pending          // waiting on a decision or scores
        case void             // wolf withdrew / not enough opponents
    }

    public struct HoleLine: Hashable, Sendable {
        public let hole: Int
        public let wolf: PlayerID
        public let choice: WolfChoice?
        public let outcome: HoleOutcome
    }

    public let holes: [HoleLine]
    public let unitsRiding: Int
    public let points: [PlayerID: Money]
}

public struct StrokePlayEvaluation: Sendable {
    public struct Row: Hashable, Sendable {
        public let player: PlayerID
        public let holesCompleted: Int
        public let grossTotal: Int
        public let netTotal: Int
        /// Net (or gross, per mode) relative to par over completed holes —
        /// the fair live comparison when players are thru different holes.
        public let toPar: Int
        public let isWithdrawn: Bool
    }

    /// Sorted best-first by `toPar` (withdrawn players last).
    public let rows: [Row]
    public let pot: Money
    public let isFinal: Bool
}
