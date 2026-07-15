import SwiftUI
import Scoring

/// The glanceable answer to "who's up right now?" — one card per bet with
/// its headline, per-component rows, and each player's projected money.
struct StandingsView: View {
    @Bindable var session: RoundSession

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                totalCard

                if session.evaluations.isEmpty {
                    EmptyState(
                        emoji: "🎲",
                        title: "No bets on this round",
                        message: "Standings appear here once there's something riding."
                    )
                }

                ForEach(session.evaluations, id: \.betID) { evaluation in
                    BetStandingCard(session: session, evaluation: evaluation)
                }
            }
            .padding(Theme.Spacing.m)
        }
        .background(Theme.Colors.background)
    }

    /// Net position across every bet — the number people actually argue about.
    private var totalCard: some View {
        Card(raised: true) {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text("If the round ended now")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                ForEach(sortedByMoney, id: \.id) { player in
                    let amount = session.netBalances[player.id] ?? .zero
                    HStack {
                        PlayerAvatar(emoji: session.emoji(for: player.id), size: 34,
                                     highlighted: player.id == session.myPlayerID)
                        Text(player.name)
                            .font(Theme.Typo.headline)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Spacer()
                        MoneyText(amount: amount, large: true)
                    }
                    .animation(Theme.Motion.standard, value: amount)
                }
            }
        }
    }

    private var sortedByMoney: [ScoringPlayer] {
        session.snapshot.players.sorted {
            (session.netBalances[$0.id]?.cents ?? 0) > (session.netBalances[$1.id]?.cents ?? 0)
        }
    }
}

// MARK: - One bet's card

private struct BetStandingCard: View {
    @Bindable var session: RoundSession
    let evaluation: BetEvaluation

    @State private var expanded = false

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Button {
                    withAnimation(Theme.Motion.standard) { expanded.toggle() }
                } label: {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        HStack {
                            Text(evaluation.kindName)
                                .font(Theme.Typo.headline)
                                .foregroundStyle(Theme.Colors.textPrimary)
                            Spacer()
                            Image(systemName: expanded ? "chevron.up" : "chevron.down")
                                .foregroundStyle(Theme.Colors.textSecondary)
                                .font(.caption)
                        }
                        Text(evaluation.headline)
                            .font(Theme.Typo.body)
                            .foregroundStyle(Theme.Colors.money)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(evaluation.kindName): \(evaluation.headline). \(expanded ? "Collapse" : "Expand") details")

                // Per-player money for this bet.
                HStack(spacing: Theme.Spacing.s) {
                    ForEach(session.snapshot.players) { player in
                        let amount = evaluation.projected[player.id] ?? .zero
                        VStack(spacing: 2) {
                            Text(session.emoji(for: player.id))
                                .font(.system(size: 18))
                            Text(amount.display)
                                .font(Theme.Typo.caption.monospacedDigit())
                                .foregroundStyle(Theme.Colors.standing(amount.cents))
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.vertical, Theme.Spacing.xs)

                if expanded {
                    Divider().overlay(Theme.Colors.stroke)
                    ForEach(evaluation.lines) { line in
                        HStack {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(line.title)
                                    .font(Theme.Typo.body)
                                    .foregroundStyle(Theme.Colors.textPrimary)
                                Text(line.status)
                                    .font(Theme.Typo.caption)
                                    .foregroundStyle(lineColor(line))
                            }
                            Spacer()
                            if line.isSettled {
                                TagChip(text: "FINAL", color: Theme.Colors.neutral)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
    }

    private func lineColor(_ line: StandingLine) -> Color {
        guard !line.leaders.isEmpty else { return Theme.Colors.neutral }
        if let me = session.myPlayerID {
            return line.leaders.contains(me) ? Theme.Colors.money : Theme.Colors.down
        }
        return Theme.Colors.textSecondary
    }
}
