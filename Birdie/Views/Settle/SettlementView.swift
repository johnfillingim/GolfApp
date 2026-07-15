import SwiftUI
import Scoring

/// End-of-round money: net positions, the minimal who-pays-whom list with
/// per-debt "mark settled", and a share summary. The app never moves money
/// — this is the digital version of the 19th-hole napkin.
struct SettlementView: View {
    @Bindable var session: RoundSession

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                if !session.isRoundComplete {
                    Card {
                        HStack(spacing: Theme.Spacing.s) {
                            Image(systemName: "info.circle.fill")
                                .foregroundStyle(Theme.Colors.neutral)
                            Text("Live projection — settle-up finalizes when every hole is in. Only mathematically final bets count below.")
                                .font(Theme.Typo.caption)
                                .foregroundStyle(Theme.Colors.textSecondary)
                        }
                    }
                }

                netCard
                transfersCard
                perBetCard

                if session.isRoundComplete && session.round.status == .live {
                    Button {
                        session.finishRound()
                    } label: {
                        Label("Finish round", systemImage: "flag.checkered")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                }

                ShareLink(item: shareSummary) {
                    Label("Share settle-up", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(PrimaryButtonStyle(prominent: false))
            }
            .padding(Theme.Spacing.m)
        }
        .background(Theme.Colors.background)
    }

    // MARK: Cards

    private var netCard: some View {
        Card(raised: true) {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text(session.isRoundComplete ? "Final net" : "Net (settled bets only)")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                ForEach(session.snapshot.players) { player in
                    let amount = session.settledBalances[player.id] ?? .zero
                    HStack {
                        PlayerAvatar(emoji: session.emoji(for: player.id), size: 32)
                        Text(player.name)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Spacer()
                        MoneyText(amount: amount)
                    }
                }
            }
        }
    }

    private var transfersCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text("Who pays whom")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)

                let lines = session.reconciledMarks()
                if lines.isEmpty {
                    Text("All square — nobody owes anybody. Rare.")
                        .font(Theme.Typo.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                } else {
                    ForEach(lines) { line in
                        TransferRow(session: session, transfer: line.transfer, mark: line.mark)
                    }
                }
            }
        }
    }

    private var perBetCard: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.s) {
                Text("By bet")
                    .font(Theme.Typo.headline)
                    .foregroundStyle(Theme.Colors.textPrimary)
                ForEach(session.evaluations, id: \.betID) { evaluation in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(evaluation.kindName)
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                        Text(evaluation.headline)
                            .font(Theme.Typo.body)
                            .foregroundStyle(Theme.Colors.textPrimary)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    private var shareSummary: String {
        var lines = ["⛳️ \(session.snapshot.course.name) — settle up"]
        for line in session.reconciledMarks() {
            let from = session.player(line.transfer.from)?.name ?? "?"
            let to = session.player(line.transfer.to)?.name ?? "?"
            lines.append("\(from) pays \(to) \(line.transfer.amount.displayUnsigned)")
        }
        if lines.count == 1 { lines.append("All square!") }
        lines.append("— scored with Birdie")
        return lines.joined(separator: "\n")
    }
}

// MARK: - One debt row

private struct TransferRow: View {
    @Bindable var session: RoundSession
    let transfer: Transfer
    let mark: SettlementMark

    private var isSettled: Bool { mark.settledAt != nil }

    var body: some View {
        Button {
            withAnimation(Theme.Motion.snappy) {
                mark.settledAt = isSettled ? nil : Date()
            }
            HapticPlayer.shared.confirm()
        } label: {
            HStack(spacing: Theme.Spacing.m) {
                Image(systemName: isSettled ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSettled ? Theme.Colors.money : Theme.Colors.stroke)

                PlayerAvatar(emoji: session.emoji(for: transfer.from), size: 30)
                Image(systemName: "arrow.right")
                    .font(.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                PlayerAvatar(emoji: session.emoji(for: transfer.to), size: 30)

                VStack(alignment: .leading, spacing: 0) {
                    Text("\(session.player(transfer.from)?.name ?? "?") → \(session.player(transfer.to)?.name ?? "?")")
                        .font(Theme.Typo.body)
                        .foregroundStyle(Theme.Colors.textPrimary)
                        .strikethrough(isSettled, color: Theme.Colors.neutral)
                    if isSettled {
                        Text("settled")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.neutral)
                    }
                }
                Spacer()
                Text(transfer.amount.displayUnsigned)
                    .font(Theme.Typo.money)
                    .foregroundStyle(isSettled ? Theme.Colors.neutral : Theme.Colors.textPrimary)
            }
            .frame(minHeight: Theme.minTarget - 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(session.player(transfer.from)?.name ?? "") pays \(session.player(transfer.to)?.name ?? "") \(transfer.amount.displayUnsigned). \(isSettled ? "Settled" : "Not settled"). Double-tap to toggle.")
    }
}
