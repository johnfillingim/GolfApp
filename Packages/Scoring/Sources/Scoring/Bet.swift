import Foundation

/// A configured bet on a round. `kind` is polymorphic over the five supported
/// formats; each format's config is a self-contained, Codable value so the app
/// can persist it as an opaque payload and sync it losslessly.
///
/// Bets are immutable once the round starts. Mid-round additions are allowed
/// (that is how a late joiner gets into the action — see `firstHole` on the
/// hole-based formats); mid-round *edits* are not, because retroactively
/// changing stakes would corrupt already-settled results.
public struct Bet: Identifiable, Hashable, Codable, Sendable {
    public let id: UUID
    public var name: String
    public var kind: BetKind

    public init(id: UUID = UUID(), name: String, kind: BetKind) {
        self.id = id
        self.name = name
        self.kind = kind
    }
}

public enum BetKind: Hashable, Codable, Sendable {
    case nassau(NassauConfig)
    case skins(SkinsConfig)
    case matchPlay(MatchPlayConfig)
    case wolf(WolfConfig)
    case strokePlay(StrokePlayConfig)

    public var displayName: String {
        switch self {
        case .nassau: return "Nassau"
        case .skins: return "Skins"
        case .matchPlay: return "Match Play"
        case .wolf: return "Wolf"
        case .strokePlay: return "Stroke Play"
        }
    }

    /// Every player with money in this bet.
    public var participants: [PlayerID] {
        switch self {
        case .nassau(let config): return config.sideA + config.sideB
        case .skins(let config): return config.players
        case .matchPlay(let config): return config.sideA + config.sideB
        case .wolf(let config): return config.rotation
        case .strokePlay(let config): return config.players
        }
    }
}

// MARK: - Sides (shared by Nassau & Match Play)

public enum MatchSide: String, Codable, Sendable, Hashable {
    case a, b

    public var opponent: MatchSide { self == .a ? .b : .a }
}

// MARK: - Nassau

/// Three matches in one: front nine, back nine, and overall — each for
/// `stakePerPlayer`. Presses open additional matches over the remaining holes
/// of a segment.
///
/// Money semantics ("per man"): when a side loses a match, *each* of its
/// members pays `stakePerPlayer`; the pot is split evenly across the winning
/// side. For the common 1v1 Nassau that is simply ±stake. For 2v2 at $5,
/// each loser pays $5 and each winner collects $5.
public struct NassauConfig: Hashable, Codable, Sendable {
    public var sideA: [PlayerID]
    public var sideB: [PlayerID]
    public var stakePerPlayer: Money
    public var handicapMode: HandicapMode
    public var allowance: HandicapAllowance

    /// When set (classically 2), a new press starts automatically whenever the
    /// trailing side of the segment's most recent open bet falls exactly this
    /// many holes down with holes still to play. Auto-presses are *derived*
    /// from the scorecard — they are never stored, so every device agrees on
    /// them without sync coordination.
    public var autoPressTrigger: Int?

    public init(
        sideA: [PlayerID],
        sideB: [PlayerID],
        stakePerPlayer: Money,
        handicapMode: HandicapMode = .net,
        allowance: HandicapAllowance = .offLow,
        autoPressTrigger: Int? = nil
    ) {
        self.sideA = sideA
        self.sideB = sideB
        self.stakePerPlayer = stakePerPlayer
        self.handicapMode = handicapMode
        self.allowance = allowance
        self.autoPressTrigger = autoPressTrigger
    }

    public func members(of side: MatchSide) -> [PlayerID] {
        side == .a ? sideA : sideB
    }
}

public enum NassauSegment: String, Codable, Sendable, CaseIterable, Hashable {
    case front, back, total

    public var label: String {
        switch self {
        case .front: return "Front 9"
        case .back: return "Back 9"
        case .total: return "18"
        }
    }
}

/// A manually declared press. Stored as an append-only event; the press covers
/// `firstHole` through the end of its segment at the segment's stake.
public struct PressEvent: Hashable, Codable, Sendable, Identifiable {
    public let id: UUID
    public let betID: UUID
    public let segment: NassauSegment
    public let firstHole: Int
    public let pressedBy: MatchSide

    public init(id: UUID = UUID(), betID: UUID, segment: NassauSegment, firstHole: Int, pressedBy: MatchSide) {
        self.id = id
        self.betID = betID
        self.segment = segment
        self.firstHole = firstHole
        self.pressedBy = pressedBy
    }
}

// MARK: - Skins

/// Every hole is worth a skin; lowest unique score takes it. Ties carry the
/// skin to the next hole when `carryover` is on (so one hole can be worth
/// several skins), otherwise the skin dies.
///
/// Money: a skin is worth `stakePerHole` *from each other participant* per
/// carried unit. Withdrawn players stop paying (and stop winning) from the
/// hole after they withdraw.
public struct SkinsConfig: Hashable, Codable, Sendable {
    public var players: [PlayerID]
    public var stakePerHole: Money
    public var handicapMode: HandicapMode
    public var carryover: Bool

    /// "Validation": a skin only counts if the winning score is net par or
    /// better. A hole "won" with a net bogey (everyone else doubled) is
    /// treated as a tie instead — it carries when carryover is on.
    public var requireValidation: Bool

    /// First hole this bet covers. Defaults to the round's first hole; a bet
    /// created mid-round (e.g. to include a late joiner) starts here so the
    /// unplayed early holes don't sit pending forever.
    public var firstHole: Int?

    public init(
        players: [PlayerID],
        stakePerHole: Money,
        handicapMode: HandicapMode = .net,
        carryover: Bool = true,
        requireValidation: Bool = false,
        firstHole: Int? = nil
    ) {
        self.players = players
        self.stakePerHole = stakePerHole
        self.handicapMode = handicapMode
        self.carryover = carryover
        self.requireValidation = requireValidation
        self.firstHole = firstHole
    }
}

// MARK: - Match Play

/// A head-to-head (or team best-ball) match over the whole round, tracked in
/// holes up/down with dormie and mathematical auto-close.
public struct MatchPlayConfig: Hashable, Codable, Sendable {
    public var sideA: [PlayerID]
    public var sideB: [PlayerID]
    public var stakePerPlayer: Money
    public var handicapMode: HandicapMode
    public var allowance: HandicapAllowance

    public init(
        sideA: [PlayerID],
        sideB: [PlayerID],
        stakePerPlayer: Money,
        handicapMode: HandicapMode = .net,
        allowance: HandicapAllowance = .offLow
    ) {
        self.sideA = sideA
        self.sideB = sideB
        self.stakePerPlayer = stakePerPlayer
        self.handicapMode = handicapMode
        self.allowance = allowance
    }

    public func members(of side: MatchSide) -> [PlayerID] {
        side == .a ? sideA : sideB
    }
}

// MARK: - Wolf

/// Rotating-captain game. The wolf for each hole (rotation order, wrapping)
/// either picks a partner after tee shots or goes alone for a multiplier.
///
/// Money is pairwise per hole: each member of the losing team pays
/// `stakePerHole` (times multiplier, times carried units) to each member of
/// the winning team. Pairwise transfers keep the books zero-sum for any team
/// sizes, including the 1-vs-3 lone wolf.
public struct WolfConfig: Hashable, Codable, Sendable {
    /// Tee order; the wolf on the Nth played hole is `rotation[(N-1) % count]`.
    /// If that player has withdrawn, the hole is void for this bet.
    public var rotation: [PlayerID]
    public var stakePerHole: Money
    public var handicapMode: HandicapMode

    /// Multiplier when the wolf declares lone after seeing tee shots.
    public var loneMultiplier: Int
    /// Multiplier when the wolf declares blind (before anyone tees off).
    public var blindMultiplier: Int

    /// When true, halved holes carry their units onto the next hole.
    public var carryTies: Bool

    /// See `SkinsConfig.firstHole`.
    public var firstHole: Int?

    public init(
        rotation: [PlayerID],
        stakePerHole: Money,
        handicapMode: HandicapMode = .net,
        loneMultiplier: Int = 2,
        blindMultiplier: Int = 3,
        carryTies: Bool = false,
        firstHole: Int? = nil
    ) {
        self.rotation = rotation
        self.stakePerHole = stakePerHole
        self.handicapMode = handicapMode
        self.loneMultiplier = loneMultiplier
        self.blindMultiplier = blindMultiplier
        self.carryTies = carryTies
        self.firstHole = firstHole
    }
}

/// The wolf's declared choice on one hole. Append-only event; exactly one per
/// (bet, hole) survives merge, so devices can't disagree.
public struct WolfDecision: Hashable, Codable, Sendable {
    public let betID: UUID
    public let hole: Int
    public let wolf: PlayerID
    public let choice: WolfChoice

    public init(betID: UUID, hole: Int, wolf: PlayerID, choice: WolfChoice) {
        self.betID = betID
        self.hole = hole
        self.wolf = wolf
        self.choice = choice
    }
}

public enum WolfChoice: Hashable, Codable, Sendable {
    case partner(PlayerID)
    case lone
    case blindLone
}

// MARK: - Stroke Play

/// Everyone antes into a pot; low total (net or gross) over the round takes
/// it. Ties split the pot evenly (odd cents go to the earlier tee order —
/// deterministic on every device).
public struct StrokePlayConfig: Hashable, Codable, Sendable {
    public var players: [PlayerID]
    public var ante: Money
    public var handicapMode: HandicapMode

    /// See `SkinsConfig.firstHole`.
    public var firstHole: Int?

    public init(
        players: [PlayerID],
        ante: Money,
        handicapMode: HandicapMode = .net,
        firstHole: Int? = nil
    ) {
        self.players = players
        self.ante = ante
        self.handicapMode = handicapMode
        self.firstHole = firstHole
    }
}
