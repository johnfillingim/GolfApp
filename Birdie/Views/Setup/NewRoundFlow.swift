import SwiftData
import SwiftUI
import Scoring

// MARK: - Round draft

/// Mutable state for the setup wizard. Player IDs are minted here and
/// become the round's `PlayerID`s (the scoring identities).
@Observable
final class RoundDraft {
    struct DraftPlayer: Identifiable, Hashable {
        let id: UUID
        var profileID: UUID?
        var name: String
        var emoji: String
        var playingHandicap: Int
    }

    var course: CatalogCourse = CourseCatalog.all[0]
    var players: [DraftPlayer] = []
    var bets: [Bet] = []
    var groupID: UUID?

    var scoringPlayers: [ScoringPlayer] {
        players.map { ScoringPlayer(id: $0.id, name: $0.name, playingHandicap: $0.playingHandicap) }
    }

    func add(profile: PlayerProfile) {
        guard !players.contains(where: { $0.profileID == profile.id }) else { return }
        players.append(DraftPlayer(
            id: UUID(),
            profileID: profile.id,
            name: profile.name,
            emoji: profile.emoji,
            playingHandicap: profile.playingHandicap(holeCount: course.holeCount)
        ))
    }

    func addGuest(name: String) {
        players.append(DraftPlayer(id: UUID(), profileID: nil, name: name, emoji: "🏌️", playingHandicap: 0))
    }
}

// MARK: - Wizard

struct NewRoundFlow: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var draft = RoundDraft()
    @State private var step = 0

    private let stepTitles = ["Course", "Players", "Bets", "Tee off"]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Step indicator.
                HStack(spacing: Theme.Spacing.s) {
                    ForEach(stepTitles.indices, id: \.self) { index in
                        Capsule()
                            .fill(index <= step ? Theme.Colors.money : Theme.Colors.stroke)
                            .frame(height: 4)
                    }
                }
                .padding(.horizontal, Theme.Spacing.m)
                .padding(.top, Theme.Spacing.s)
                .accessibilityHidden(true)

                TabView(selection: $step) {
                    CourseStep(draft: draft).tag(0)
                    PlayersStep(draft: draft).tag(1)
                    BetsStep(draft: draft).tag(2)
                    ReviewStep(draft: draft, onStart: startRound).tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .animation(Theme.Motion.standard, value: step)

                HStack(spacing: Theme.Spacing.m) {
                    if step > 0 {
                        Button("Back") {
                            step -= 1
                        }
                        .buttonStyle(PrimaryButtonStyle(prominent: false))
                        .frame(width: 110)
                    }
                    if step < 3 {
                        Button(step == 2 && draft.bets.isEmpty ? "Skip bets" : "Next") {
                            step += 1
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!canAdvance)
                    }
                }
                .padding(Theme.Spacing.m)
            }
            .background(Theme.Colors.background)
            .navigationTitle(stepTitles[step])
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private var canAdvance: Bool {
        switch step {
        case 1: return draft.players.count >= 1
        default: return true
        }
    }

    private func startRound() {
        guard let courseData = try? draft.course.encoded() else { return }
        let round = Round(
            courseID: draft.course.id,
            courseData: courseData,
            holeCount: draft.course.holeCount,
            groupID: draft.groupID
        )
        round.status = .live
        context.insert(round)

        for (index, draftPlayer) in draft.players.enumerated() {
            let player = RoundPlayer(
                id: draftPlayer.id,
                profileID: draftPlayer.profileID,
                name: draftPlayer.name,
                emoji: draftPlayer.emoji,
                playingHandicap: draftPlayer.playingHandicap,
                teeOrder: index
            )
            context.insert(player)
            player.round = round
            round.players.append(player)
        }

        for bet in draft.bets {
            let model = BetModel(id: bet.id, name: bet.name, kindData: SnapshotBuilder.encodeBetKind(bet.kind))
            context.insert(model)
            model.round = round
            round.bets.append(model)
        }

        HapticPlayer.shared.confirm()
        dismiss()
    }
}

// MARK: - Step 1: course

private struct CourseStep: View {
    @Bindable var draft: RoundDraft

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                ForEach(CourseCatalog.all) { course in
                    Button {
                        draft.course = course
                    } label: {
                        Card(raised: draft.course.id == course.id) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(course.name)
                                        .font(Theme.Typo.headline)
                                        .foregroundStyle(Theme.Colors.textPrimary)
                                    Text("\(course.location) · Par \(course.totalPar) · \(course.totalYards) yds")
                                        .font(Theme.Typo.caption)
                                        .foregroundStyle(Theme.Colors.textSecondary)
                                }
                                Spacer()
                                if draft.course.id == course.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Theme.Colors.money)
                                        .font(.title2)
                                }
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }

                Text("Demo courses for now — the course model is ready for a real course API (see README).")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(Theme.Spacing.m)
        }
    }
}

// MARK: - Step 2: players

private struct PlayersStep: View {
    @Bindable var draft: RoundDraft
    @Query(sort: \PlayerProfile.createdAt) private var profiles: [PlayerProfile]
    @State private var guestName = ""

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                if !draft.players.isEmpty {
                    Card {
                        VStack(spacing: Theme.Spacing.s) {
                            Text("Tee order — drag chips below to reorder is coming; for now order = add order. Handicaps are strokes for this round.")
                                .font(Theme.Typo.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                            ForEach($draft.players) { $player in
                                HStack(spacing: Theme.Spacing.m) {
                                    PlayerAvatar(emoji: player.emoji, size: 40)
                                    Text(player.name)
                                        .font(Theme.Typo.headline)
                                        .foregroundStyle(Theme.Colors.textPrimary)
                                    Spacer()
                                    Stepper(value: $player.playingHandicap, in: -5...40) {
                                        Text("HCP \(player.playingHandicap)")
                                            .font(Theme.Typo.grid)
                                            .foregroundStyle(Theme.Colors.textSecondary)
                                    }
                                    .fixedSize()
                                }
                                .frame(minHeight: Theme.minTarget)
                            }
                        }
                    }
                }

                Card {
                    VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                        Text("Add from your buddies")
                            .font(Theme.Typo.headline)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        if profiles.isEmpty {
                            Text("Profiles you create in Groups appear here.")
                                .font(Theme.Typo.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                        }
                        ForEach(profiles) { profile in
                            let added = draft.players.contains { $0.profileID == profile.id }
                            Button {
                                draft.add(profile: profile)
                            } label: {
                                HStack {
                                    PlayerAvatar(emoji: profile.emoji, size: 36)
                                    Text(profile.name)
                                        .foregroundStyle(Theme.Colors.textPrimary)
                                    if profile.isMe {
                                        TagChip(text: "you", color: Theme.Colors.money)
                                    }
                                    Spacer()
                                    Image(systemName: added ? "checkmark.circle.fill" : "plus.circle")
                                        .foregroundStyle(added ? Theme.Colors.money : Theme.Colors.textSecondary)
                                }
                                .frame(minHeight: Theme.minTarget - 8)
                            }
                            .disabled(added)
                        }

                        Divider().overlay(Theme.Colors.stroke)

                        HStack {
                            TextField("Guest name", text: $guestName)
                                .padding(Theme.Spacing.s)
                                .background(Theme.Colors.surfaceRaised)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip))
                            Button("Add guest") {
                                let name = guestName.trimmingCharacters(in: .whitespaces)
                                guard !name.isEmpty else { return }
                                draft.addGuest(name: name)
                                guestName = ""
                            }
                        }
                    }
                }

                if draft.players.count > 8 {
                    Text("Up to 8 players per round.")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.down)
                }
            }
            .padding(Theme.Spacing.m)
        }
        .onChange(of: draft.players.count) { _, newCount in
            if newCount > 8 { draft.players.removeLast(newCount - 8) }
        }
    }
}

// MARK: - Step 3: bets

private struct BetsStep: View {
    @Bindable var draft: RoundDraft
    @State private var builderFormat: BetFormat?

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                if draft.bets.isEmpty {
                    EmptyState(
                        emoji: "🎲",
                        title: "No bets yet",
                        message: "A round with nothing riding is just a walk. Add one — every bet shows its rules in plain English before you start."
                    )
                }

                ForEach(draft.bets) { bet in
                    Card {
                        VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                            HStack {
                                Text(bet.kind.displayName)
                                    .font(Theme.Typo.headline)
                                    .foregroundStyle(Theme.Colors.textPrimary)
                                Spacer()
                                Button(role: .destructive) {
                                    draft.bets.removeAll { $0.id == bet.id }
                                } label: {
                                    Image(systemName: "trash")
                                        .foregroundStyle(Theme.Colors.down)
                                }
                                .accessibilityLabel("Remove \(bet.kind.displayName)")
                            }
                            Text(BetSummary.describe(bet, players: draft.scoringPlayers))
                                .font(Theme.Typo.body)
                                .foregroundStyle(Theme.Colors.textSecondary)
                        }
                    }
                }

                VStack(spacing: Theme.Spacing.s) {
                    ForEach(BetFormat.allCases) { format in
                        Button {
                            builderFormat = format
                        } label: {
                            HStack {
                                Text(format.emoji)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(format.title)
                                        .font(Theme.Typo.headline)
                                        .foregroundStyle(Theme.Colors.textPrimary)
                                    Text(format.blurb)
                                        .font(Theme.Typo.caption)
                                        .foregroundStyle(Theme.Colors.textSecondary)
                                }
                                Spacer()
                                Image(systemName: "plus.circle")
                                    .foregroundStyle(Theme.Colors.money)
                            }
                            .padding(Theme.Spacing.m)
                            .background(Theme.Colors.surface)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card))
                            .overlay(
                                RoundedRectangle(cornerRadius: Theme.Radius.card)
                                    .strokeBorder(Theme.Colors.stroke, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(!format.isAvailable(playerCount: draft.players.count))
                        .opacity(format.isAvailable(playerCount: draft.players.count) ? 1 : 0.4)
                    }
                }
            }
            .padding(Theme.Spacing.m)
        }
        .sheet(item: $builderFormat) { format in
            BetBuilderView(format: format, draft: draft)
        }
    }
}

// MARK: - Step 4: review

private struct ReviewStep: View {
    @Bindable var draft: RoundDraft
    let onStart: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                Card {
                    VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                        Text(draft.course.name)
                            .font(Theme.Typo.title)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Text("\(draft.course.holeCount) holes · Par \(draft.course.totalPar)")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Divider().overlay(Theme.Colors.stroke)
                        ForEach(draft.players) { player in
                            HStack {
                                PlayerAvatar(emoji: player.emoji, size: 32)
                                Text(player.name)
                                    .foregroundStyle(Theme.Colors.textPrimary)
                                Spacer()
                                Text("HCP \(player.playingHandicap)")
                                    .font(Theme.Typo.grid)
                                    .foregroundStyle(Theme.Colors.textSecondary)
                            }
                        }
                    }
                }

                // The contract: every bet in plain English before anyone
                // tees off. No "wait, I thought carryovers were off."
                if !draft.bets.isEmpty {
                    Card {
                        VStack(alignment: .leading, spacing: Theme.Spacing.m) {
                            Text("The bets")
                                .font(Theme.Typo.headline)
                                .foregroundStyle(Theme.Colors.textPrimary)
                            ForEach(draft.bets) { bet in
                                HStack(alignment: .top, spacing: Theme.Spacing.s) {
                                    Text("•").foregroundStyle(Theme.Colors.money)
                                    Text(BetSummary.describe(bet, players: draft.scoringPlayers))
                                        .font(Theme.Typo.body)
                                        .foregroundStyle(Theme.Colors.textPrimary)
                                }
                            }
                        }
                    }
                }

                Button {
                    onStart()
                } label: {
                    Label("Start round", systemImage: "flag.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(draft.players.isEmpty)

                Text("You can share the round with the group from the live screen — everyone scores on their own phone.")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
            }
            .padding(Theme.Spacing.m)
        }
    }
}
