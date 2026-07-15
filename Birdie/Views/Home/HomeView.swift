import SwiftData
import SwiftUI
import Scoring

struct HomeView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.modelContext) private var context

    @Query(sort: \Round.createdAt, order: .reverse) private var rounds: [Round]
    @Query(sort: \BuddyGroup.createdAt) private var groups: [BuddyGroup]

    @State private var showNewRound = false
    @State private var showGroups = false

    private var liveRounds: [Round] {
        rounds.filter { $0.status == .live }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.l) {
                    if !liveRounds.isEmpty {
                        VStack(spacing: Theme.Spacing.m) {
                            SectionHeader(title: "Live now")
                            ForEach(liveRounds) { round in
                                NavigationLink(value: round.id) {
                                    LiveRoundCard(round: round)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Button {
                        showNewRound = true
                    } label: {
                        Label("New Round", systemImage: "plus.circle.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityHint("Set up a course, players, and bets")

                    VStack(spacing: Theme.Spacing.m) {
                        SectionHeader(title: "Your crew", trailing: groups.isEmpty ? nil : "\(groups.count) groups")
                        if groups.isEmpty {
                            Card {
                                EmptyState(
                                    emoji: "👥",
                                    title: "No group yet",
                                    message: "Make one so your usual foursome is a single tap when you hit the tee."
                                )
                            }
                        } else {
                            ForEach(groups) { group in
                                GroupCard(group: group)
                            }
                        }
                        Button {
                            showGroups = true
                        } label: {
                            Label(groups.isEmpty ? "Create a group" : "Manage groups", systemImage: "person.2.fill")
                        }
                        .buttonStyle(PrimaryButtonStyle(prominent: false))
                    }
                }
                .padding(Theme.Spacing.m)
            }
            .background(Theme.Colors.background)
            .navigationTitle("Birdie")
            .navigationDestination(for: UUID.self) { roundID in
                if let round = AppEnvironment.fetchRound(id: roundID, context: context) {
                    LiveRoundView(round: round)
                }
            }
            .sheet(isPresented: $showNewRound) {
                NewRoundFlow()
            }
            .sheet(isPresented: $showGroups) {
                GroupsView()
            }
        }
    }
}

// MARK: - Cards

private struct LiveRoundCard: View {
    let round: Round

    var body: some View {
        Card(raised: true) {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(CatalogCourse.decode(round.courseData)?.name ?? "Round")
                            .font(Theme.Typo.headline)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Text("\(round.players.count) players · \(round.bets.count) bets")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                    Spacer()
                    TagChip(text: "LIVE", color: Theme.Colors.money)
                }
                HStack(spacing: -8) {
                    ForEach(round.players.sorted { $0.teeOrder < $1.teeOrder }) { player in
                        PlayerAvatar(emoji: player.emoji, size: 34)
                    }
                }
            }
        }
    }
}

private struct GroupCard: View {
    let group: BuddyGroup

    var body: some View {
        Card {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(group.name)
                        .font(Theme.Typo.headline)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text("Join code \(group.joinCode)")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                HStack(spacing: -8) {
                    ForEach(group.members.prefix(5)) { member in
                        PlayerAvatar(emoji: member.emoji, size: 30)
                    }
                }
            }
        }
    }
}
