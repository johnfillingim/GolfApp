import SwiftUI
import Scoring

// MARK: - Bet formats (UI metadata)

enum BetFormat: String, CaseIterable, Identifiable {
    case nassau, skins, matchPlay, wolf, strokePlay

    var id: String { rawValue }

    var title: String {
        switch self {
        case .nassau: return "Nassau"
        case .skins: return "Skins"
        case .matchPlay: return "Match Play"
        case .wolf: return "Wolf"
        case .strokePlay: return "Stroke Play Pot"
        }
    }

    var emoji: String {
        switch self {
        case .nassau: return "3️⃣"
        case .skins: return "💰"
        case .matchPlay: return "⚔️"
        case .wolf: return "🐺"
        case .strokePlay: return "🏆"
        }
    }

    var blurb: String {
        switch self {
        case .nassau: return "Front, back & overall — with presses"
        case .skins: return "Low score takes the hole, ties carry"
        case .matchPlay: return "Head-to-head, holes up & down"
        case .wolf: return "Rotating captain picks a partner or goes lone"
        case .strokePlay: return "Everyone antes, low round takes the pot"
        }
    }

    func isAvailable(playerCount: Int) -> Bool {
        switch self {
        case .nassau, .matchPlay: return playerCount >= 2
        case .skins, .strokePlay: return playerCount >= 2
        case .wolf: return playerCount >= 3
        }
    }
}

// MARK: - Builder

/// One sheet builds any format. Each form edits its config live, and the
/// plain-English summary at the bottom re-renders on every change — the
/// group reads that sentence out loud, then you add the bet.
struct BetBuilderView: View {
    @Environment(\.dismiss) private var dismiss

    let format: BetFormat
    @Bindable var draft: RoundDraft

    // Shared knobs
    @State private var stakeDollars = 5
    @State private var isNet = true

    // Nassau / match play sides
    @State private var sideA: Set<PlayerID> = []
    @State private var sideB: Set<PlayerID> = []
    @State private var autoPress = true

    // Skins
    @State private var carryover = true
    @State private var validation = false

    // Wolf
    @State private var loneMultiplier = 2
    @State private var carryTies = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.m) {
                    stakeCard
                    scoringCard

                    switch format {
                    case .nassau:
                        sidesCard
                        toggleCard(title: "Auto-press at 2 down",
                                   caption: "A fresh bet opens automatically whenever the current one goes 2 down on a nine.",
                                   isOn: $autoPress)
                    case .matchPlay:
                        sidesCard
                    case .skins:
                        toggleCard(title: "Carryovers",
                                   caption: "Tied holes push the skin to the next hole — that's how $2 holes become $10 holes.",
                                   isOn: $carryover)
                        toggleCard(title: "Validation (par or better)",
                                   caption: "A skin only counts if the winning score is par or better.",
                                   isOn: $validation)
                    case .wolf:
                        wolfCard
                    case .strokePlay:
                        EmptyView()
                    }

                    if let bet = builtBet {
                        Card(raised: true) {
                            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                                Text("In plain English")
                                    .font(Theme.Typo.caption)
                                    .foregroundStyle(Theme.Colors.money)
                                Text(BetSummary.describe(bet, players: draft.scoringPlayers))
                                    .font(Theme.Typo.body)
                                    .foregroundStyle(Theme.Colors.textPrimary)
                            }
                        }
                    } else {
                        Card {
                            Text(invalidReason)
                                .font(Theme.Typo.body)
                                .foregroundStyle(Theme.Colors.down)
                        }
                    }

                    Button("Add bet") {
                        if let bet = builtBet {
                            draft.bets.append(bet)
                            HapticPlayer.shared.confirm()
                            dismiss()
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(builtBet == nil)
                }
                .padding(Theme.Spacing.m)
            }
            .background(Theme.Colors.background)
            .navigationTitle("\(format.emoji) \(format.title)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .onAppear(perform: seedDefaults)
        }
    }

    // MARK: Config cards

    private var stakeCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text(format == .strokePlay ? "Ante per player" : "Stake")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                HStack(spacing: Theme.Spacing.s) {
                    ForEach([1, 2, 5, 10, 20], id: \.self) { amount in
                        Button {
                            stakeDollars = amount
                        } label: {
                            Text("$\(amount)")
                                .font(Theme.Typo.money)
                                .foregroundStyle(stakeDollars == amount ? Theme.Colors.textOnAccent : Theme.Colors.textPrimary)
                                .frame(maxWidth: .infinity, minHeight: Theme.minTarget - 6)
                                .background(stakeDollars == amount ? Theme.Colors.money : Theme.Colors.surfaceRaised)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip))
                        }
                    }
                }
                Stepper("Custom: $\(stakeDollars)", value: $stakeDollars, in: 1...500)
                    .font(Theme.Typo.body)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }

    private var scoringCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text("Scoring")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Picker("Scoring", selection: $isNet) {
                    Text("Net (handicaps)").tag(true)
                    Text("Gross").tag(false)
                }
                .pickerStyle(.segmented)
                if isNet, format == .nassau || format == .matchPlay {
                    Text("Strokes play off the low handicap, falling by stroke index.")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
            }
        }
    }

    private var sidesCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text("Sides")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text("Tap to cycle: Side A → Side B → out. Teams play best ball.")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                ForEach(draft.players) { player in
                    Button {
                        cycle(player.id)
                    } label: {
                        HStack {
                            PlayerAvatar(emoji: player.emoji, size: 34)
                            Text(player.name)
                                .foregroundStyle(Theme.Colors.textPrimary)
                            Spacer()
                            if sideA.contains(player.id) {
                                TagChip(text: "SIDE A", color: Theme.Colors.money)
                            } else if sideB.contains(player.id) {
                                TagChip(text: "SIDE B", color: Theme.Colors.down)
                            } else {
                                TagChip(text: "OUT", color: Theme.Colors.neutral)
                            }
                        }
                        .frame(minHeight: Theme.minTarget - 8)
                    }
                }
            }
        }
    }

    private var wolfCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text("Wolf rules")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text("Wolf order follows tee order: \(draft.players.map(\.name).joined(separator: " → ")).")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Picker("Lone wolf multiplier", selection: $loneMultiplier) {
                    Text("Lone wolf 2×").tag(2)
                    Text("Lone wolf 3×").tag(3)
                }
                .pickerStyle(.segmented)
                Toggle("Halved holes carry", isOn: $carryTies)
                    .tint(Theme.Colors.fairway)
                    .font(Theme.Typo.body)
            }
        }
    }

    private func toggleCard(title: String, caption: String, isOn: Binding<Bool>) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                Toggle(title, isOn: isOn)
                    .tint(Theme.Colors.fairway)
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                Text(caption)
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }

    // MARK: Building

    private func seedDefaults() {
        // Sensible sides: 1v1 → first two players; 4 players → 1&2 vs 3&4.
        guard sideA.isEmpty && sideB.isEmpty else { return }
        let ids = draft.players.map(\.id)
        switch ids.count {
        case 2:
            sideA = [ids[0]]; sideB = [ids[1]]
        case 4 where format == .nassau || format == .matchPlay:
            sideA = [ids[0], ids[1]]; sideB = [ids[2], ids[3]]
        default:
            if ids.count >= 2 { sideA = [ids[0]]; sideB = [ids[1]] }
        }
    }

    private func cycle(_ id: PlayerID) {
        if sideA.contains(id) {
            sideA.remove(id); sideB.insert(id)
        } else if sideB.contains(id) {
            sideB.remove(id)
        } else {
            sideA.insert(id)
        }
    }

    /// Order side members by tee order so payouts stay deterministic.
    private func ordered(_ set: Set<PlayerID>) -> [PlayerID] {
        draft.players.map(\.id).filter(set.contains)
    }

    private var builtBet: Bet? {
        let stake = Money.dollars(stakeDollars)
        let mode: HandicapMode = isNet ? .net : .gross
        let everyone = draft.players.map(\.id)

        switch format {
        case .nassau:
            guard !sideA.isEmpty, !sideB.isEmpty else { return nil }
            return Bet(name: "Nassau", kind: .nassau(NassauConfig(
                sideA: ordered(sideA),
                sideB: ordered(sideB),
                stakePerPlayer: stake,
                handicapMode: mode,
                allowance: .offLow,
                autoPressTrigger: autoPress ? 2 : nil
            )))
        case .skins:
            guard everyone.count >= 2 else { return nil }
            return Bet(name: "Skins", kind: .skins(SkinsConfig(
                players: everyone,
                stakePerHole: stake,
                handicapMode: mode,
                carryover: carryover,
                requireValidation: validation
            )))
        case .matchPlay:
            guard !sideA.isEmpty, !sideB.isEmpty else { return nil }
            return Bet(name: "Match", kind: .matchPlay(MatchPlayConfig(
                sideA: ordered(sideA),
                sideB: ordered(sideB),
                stakePerPlayer: stake,
                handicapMode: mode
            )))
        case .wolf:
            guard everyone.count >= 3 else { return nil }
            return Bet(name: "Wolf", kind: .wolf(WolfConfig(
                rotation: everyone,
                stakePerHole: stake,
                handicapMode: mode,
                loneMultiplier: loneMultiplier,
                blindMultiplier: loneMultiplier + 1,
                carryTies: carryTies
            )))
        case .strokePlay:
            guard everyone.count >= 2 else { return nil }
            return Bet(name: "Pot", kind: .strokePlay(StrokePlayConfig(
                players: everyone,
                ante: stake,
                handicapMode: mode
            )))
        }
    }

    private var invalidReason: String {
        switch format {
        case .nassau, .matchPlay: return "Pick at least one player per side."
        case .wolf: return "Wolf needs at least 3 players."
        default: return "Add at least two players to the round."
        }
    }
}
