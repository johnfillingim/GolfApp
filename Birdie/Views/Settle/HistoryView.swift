import SwiftData
import SwiftUI
import Scoring

/// Past rounds and the lifetime ledger between buddies — the rivalry fuel.
struct HistoryView: View {
    @Query(sort: \Round.createdAt, order: .reverse) private var rounds: [Round]

    private var finishedRounds: [Round] {
        rounds.filter { $0.status == .finished }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.m) {
                    if finishedRounds.isEmpty {
                        EmptyState(
                            emoji: "📖",
                            title: "No finished rounds",
                            message: "Your history and buddy-vs-buddy records build up here after your first settled round."
                        )
                    } else {
                        rivalryCard
                        SectionHeader(title: "Rounds")
                        ForEach(finishedRounds) { round in
                            NavigationLink {
                                RoundRecapView(round: round)
                            } label: {
                                HistoryRow(round: round)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(Theme.Spacing.m)
            }
            .background(Theme.Colors.background)
            .navigationTitle("History")
        }
    }

    /// Lifetime net per player name across all finished rounds.
    /// (Keyed by profile where available, else name — good enough until a
    /// real cross-device identity model lands; noted in README.)
    private var rivalryCard: some View {
        let ledger = Self.lifetimeLedger(rounds: finishedRounds)
        return Card(raised: true) {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text("Lifetime money")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                ForEach(ledger.sorted { $0.value.cents > $1.value.cents }, id: \.key) { name, amount in
                    HStack {
                        Text(name)
                            .font(Theme.Typo.body)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Spacer()
                        MoneyText(amount: amount)
                    }
                }
            }
        }
    }

    static func lifetimeLedger(rounds: [Round]) -> [String: Money] {
        var ledger: [String: Money] = [:]
        for round in rounds {
            let bets = SnapshotBuilder.bets(for: round)
            let snapshot = SnapshotBuilder.snapshot(for: round)
            let evaluations = BetEvaluator.evaluateAll(bets, snapshot: snapshot)
            let balances = Settlement.netBalances(evaluations.map(\.settled))
            for player in round.players {
                ledger[player.name, default: .zero] += balances[player.id] ?? .zero
            }
        }
        return ledger.filter { !$0.value.isZero }
    }
}

private struct HistoryRow: View {
    let round: Round

    var body: some View {
        Card {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(CatalogCourse.decode(round.courseData)?.name ?? "Round")
                        .font(Theme.Typo.headline)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text(round.createdAt.formatted(date: .abbreviated, time: .omitted))
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                Spacer()
                HStack(spacing: -8) {
                    ForEach(round.players.sorted { $0.teeOrder < $1.teeOrder }) { player in
                        PlayerAvatar(emoji: player.emoji, size: 28)
                    }
                }
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }
}

/// Read-only recap of a finished round: final card, bet outcomes, money.
struct RoundRecapView: View {
    let round: Round

    var body: some View {
        let snapshot = SnapshotBuilder.snapshot(for: round)
        let evaluations = BetEvaluator.evaluateAll(SnapshotBuilder.bets(for: round), snapshot: snapshot)
        let balances = Settlement.netBalances(evaluations.map(\.settled))

        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                Card(raised: true) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                        ForEach(snapshot.players) { player in
                            let gross = snapshot.holeNumbers.compactMap { snapshot.gross(player.id, hole: $0) }.reduce(0, +)
                            HStack {
                                Text(player.name)
                                    .foregroundStyle(Theme.Colors.textPrimary)
                                Spacer()
                                Text(gross > 0 ? "\(gross)" : "—")
                                    .font(Theme.Typo.grid)
                                    .foregroundStyle(Theme.Colors.textSecondary)
                                MoneyText(amount: balances[player.id] ?? .zero)
                            }
                        }
                    }
                }

                ForEach(evaluations, id: \.betID) { evaluation in
                    Card {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(evaluation.kindName)
                                .font(Theme.Typo.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                            Text(evaluation.headline)
                                .font(Theme.Typo.body)
                                .foregroundStyle(Theme.Colors.textPrimary)
                        }
                    }
                }
            }
            .padding(Theme.Spacing.m)
        }
        .background(Theme.Colors.background)
        .navigationTitle(round.createdAt.formatted(date: .abbreviated, time: .omitted))
        .navigationBarTitleDisplayMode(.inline)
    }
}
