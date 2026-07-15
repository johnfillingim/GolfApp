import Foundation
import Scoring
import SwiftUI

// MARK: - Celebration model

/// Intensity ladder. Everything above `.toast` gets motion + haptics;
/// `.jackpot` is the full-screen showstopper.
enum CelebrationTier: Int, Comparable {
    case toast = 0      // someone else's minor moment → ticker line
    case minor          // press opened, small acknowledgments
    case medium         // your birdie, a won skin
    case major          // eagle, lone wolf, match closed
    case jackpot        // ace / albatross

    static func < (lhs: CelebrationTier, rhs: CelebrationTier) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    /// Seconds on screen when not skipped.
    var duration: TimeInterval {
        switch self {
        case .toast: return 2.2
        case .minor: return 1.8
        case .medium: return 2.6
        case .major: return 3.4
        case .jackpot: return 5.0
        }
    }
}

/// One queued celebration, ready for the overlay to render.
struct Celebration: Identifiable, Equatable {
    let id: String          // stable — mirrors the milestone/event ID
    let tier: CelebrationTier
    let title: String
    let subtitle: String?
    let emoji: String
    let money: Money?
    /// The local player earned it (bigger treatment) vs. a buddy did.
    let isMine: Bool
}

// MARK: - Engine

/// Decides *what deserves celebrating and how much*, exactly once.
///
/// Inputs are the deterministic, stably-identified outputs of the Scoring
/// module (`Milestone`s and `ScoringEvent`s). Because IDs are stable across
/// re-evaluation and identical on every device, "have we fired this?" is a
/// set lookup, persisted per round — score edits and sync replays can never
/// double-fire a fanfare.
///
/// Motion principles enforced here and in the overlay:
/// - Never blocks input: celebrations render in a passthrough overlay;
///   score entry keeps working underneath.
/// - Skippable: tap anywhere on the banner to dismiss and advance.
/// - Coalescing: one moment at a time, highest tier first; a queue of
///   leftovers plays through quickly rather than stacking visuals.
/// - Reduce Motion: particles are replaced by a gentle fade/scale (the
///   overlay checks `accessibilityReduceMotion`); haptics still fire.
@MainActor
@Observable
final class CelebrationEngine {

    private(set) var current: Celebration?

    private var queue: [Celebration] = []
    private var firedIDs: Set<String> = []
    private var roundID: UUID?
    private var dismissTask: Task<Void, Never>?

    private let haptics = HapticPlayer.shared
    private let sound = SoundPlayer.shared

    // MARK: Round lifecycle

    /// Point the engine at a round; restores the already-fired set so
    /// reopening the app mid-round stays quiet.
    func attach(roundID: UUID) {
        guard self.roundID != roundID else { return }
        self.roundID = roundID
        firedIDs = Self.loadFired(roundID: roundID)
        queue.removeAll()
        current = nil
    }

    // MARK: Ingest

    /// Feed the latest evaluation results; anything new gets queued.
    func ingest(
        milestones: [Milestone],
        events: [ScoringEvent],
        snapshot: RoundSnapshot,
        myPlayerID: PlayerID?
    ) {
        var fresh: [Celebration] = []

        for milestone in milestones where !firedIDs.contains(milestone.id) {
            firedIDs.insert(milestone.id)
            fresh.append(celebration(for: milestone, snapshot: snapshot, myPlayerID: myPlayerID))
        }
        for event in events where !firedIDs.contains(event.id) {
            firedIDs.insert(event.id)
            if let celebration = celebration(for: event, snapshot: snapshot, myPlayerID: myPlayerID) {
                fresh.append(celebration)
            }
        }

        guard !fresh.isEmpty else { return }
        persistFired()

        // Highest tier first so an eagle isn't queued behind three toasts.
        queue.append(contentsOf: fresh)
        queue.sort { $0.tier > $1.tier }
        advanceIfIdle()
    }

    /// Marks everything currently in the snapshot as already-celebrated
    /// WITHOUT firing. Called when opening a round that has history this
    /// device hasn't seen (mid-round join): joining should be quiet.
    func suppressExisting(milestones: [Milestone], events: [ScoringEvent]) {
        for milestone in milestones { firedIDs.insert(milestone.id) }
        for event in events { firedIDs.insert(event.id) }
        persistFired()
    }

    // MARK: Playback

    func skip() {
        dismissTask?.cancel()
        advance()
    }

    private func advanceIfIdle() {
        guard current == nil else { return }
        advance()
    }

    private func advance() {
        dismissTask?.cancel()
        guard !queue.isEmpty else {
            current = nil
            return
        }
        let next = queue.removeFirst()
        current = next

        haptics.celebrate(next.tier)
        if let effect = sound.effect(for: next.tier) {
            sound.play(effect)
        }

        dismissTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(next.tier.duration))
            guard !Task.isCancelled else { return }
            self?.advance()
        }
    }

    // MARK: Mapping

    private func celebration(for milestone: Milestone, snapshot: RoundSnapshot, myPlayerID: PlayerID?) -> Celebration {
        let isMine = milestone.player == myPlayerID
        let name = snapshot.shortNamePublic(milestone.player)

        switch milestone.kind {
        case .birdie:
            return Celebration(
                id: milestone.id,
                tier: isMine ? .medium : .toast,
                title: isMine ? "Birdie!" : "\(name) birdied \(milestone.hole)",
                subtitle: isMine ? "Hole \(milestone.hole)" : nil,
                emoji: "🐦", money: nil, isMine: isMine
            )
        case .eagle:
            return Celebration(
                id: milestone.id,
                tier: isMine ? .major : .minor,
                title: isMine ? "EAGLE!" : "\(name) eagled \(milestone.hole)!",
                subtitle: isMine ? "Hole \(milestone.hole) — two under" : nil,
                emoji: "🦅", money: nil, isMine: isMine
            )
        case .albatross:
            return Celebration(
                id: milestone.id,
                tier: .jackpot,
                title: isMine ? "ALBATROSS!!" : "\(name) — ALBATROSS!",
                subtitle: "Hole \(milestone.hole) — three under. Once a lifetime.",
                emoji: "🕊️", money: nil, isMine: isMine
            )
        case .holeInOne:
            return Celebration(
                id: milestone.id,
                tier: .jackpot,
                title: isMine ? "HOLE IN ONE!!" : "\(name) ACED IT!",
                subtitle: "Hole \(milestone.hole). Drinks are on \(isMine ? "you" : name).",
                emoji: "⛳️", money: nil, isMine: isMine
            )
        case .birdieStreak(let count):
            return Celebration(
                id: milestone.id,
                tier: isMine ? (count >= 3 ? .major : .medium) : .toast,
                title: isMine ? "\(count) birdies in a row!" : "\(name): \(count) straight birdies",
                subtitle: isMine ? "You're on fire" : nil,
                emoji: "🔥", money: nil, isMine: isMine
            )
        }
    }

    private func celebration(for event: ScoringEvent, snapshot: RoundSnapshot, myPlayerID: PlayerID?) -> Celebration? {
        let isMine = myPlayerID.map { event.players.contains($0) } ?? false
        let names = event.players.map { snapshot.shortNamePublic($0) }.joined(separator: " & ")

        switch event.kind {
        case .skinWon(let units):
            return Celebration(
                id: event.id,
                tier: isMine ? .medium : .toast,
                title: isMine
                    ? (units > 1 ? "You took \(units) skins!" : "Skin won!")
                    : "\(names) took \(units > 1 ? "\(units) skins" : "the skin")",
                subtitle: event.hole.map { "Hole \($0)" },
                emoji: "💰", money: event.amount, isMine: isMine
            )
        case .pressStarted(let auto):
            return Celebration(
                id: event.id,
                tier: .minor,
                title: auto ? "Auto-press!" : "Press!",
                subtitle: event.hole.map { "New bet from hole \($0)" },
                emoji: "♻️", money: nil, isMine: isMine
            )
        case .matchClosed(let margin):
            return Celebration(
                id: event.id,
                tier: isMine ? .major : .minor,
                title: isMine ? "Match closed out \(margin)" : "\(names) win \(margin)",
                subtitle: nil,
                emoji: "🏆", money: event.amount, isMine: isMine
            )
        case .segmentDecided(let segment):
            let segmentName: String
            switch segment {
            case .front: segmentName = "the front nine"
            case .back: segmentName = "the back nine"
            case .total: segmentName = "the match"
            }
            return Celebration(
                id: event.id,
                tier: isMine ? .medium : .toast,
                title: isMine ? "You took \(segmentName)!" : "\(names) take \(segmentName)",
                subtitle: nil,
                emoji: "💵", money: event.amount, isMine: isMine
            )
        case .wolfWon(let multiplier):
            return Celebration(
                id: event.id,
                tier: isMine ? .major : .minor,
                title: isMine ? "Lone wolf ×\(multiplier)!" : "\(names) — lone wolf ×\(multiplier)!",
                subtitle: "Beat the pack alone",
                emoji: "🐺", money: event.amount, isMine: isMine
            )
        }
    }

    // MARK: Fired-ID persistence

    private func persistFired() {
        guard let roundID else { return }
        UserDefaults.standard.set(Array(firedIDs), forKey: Self.firedKey(roundID))
    }

    private static func loadFired(roundID: UUID) -> Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: firedKey(roundID)) ?? [])
    }

    private static func firedKey(_ roundID: UUID) -> String {
        "birdie.celebrated.\(roundID.uuidString)"
    }
}

extension RoundSnapshot {
    /// Public mirror of the module-internal `shortName` helper.
    func shortNamePublic(_ id: PlayerID) -> String {
        guard let name = player(id)?.name, !name.isEmpty else { return "?" }
        return name.split(separator: " ").first.map(String.init) ?? name
    }
}
