import SwiftUI
import Scoring

/// The classic paper scorecard: players down, holes across, color-coded
/// by score quality. Horizontal scroll for 18 holes; OUT/IN/TOT columns.
struct ScoreGridView: View {
    @Bindable var session: RoundSession

    private var holes: [Int] { session.snapshot.holeNumbers }
    private var front: [Int] { holes.filter { $0 <= 9 } }
    private var back: [Int] { holes.filter { $0 >= 10 } }

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                Card {
                    ScrollView(.horizontal, showsIndicators: false) {
                        Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                            headerRow
                            parRow
                            ForEach(session.snapshot.players) { player in
                                playerRow(player)
                            }
                        }
                        .font(Theme.Typo.grid)
                    }
                }

                Text("Tap a hole in the Score tab to edit. Colors: gold eagle+, lime birdie, white par, gray bogey, coral worse.")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Spacing.m)
            }
            .padding(Theme.Spacing.m)
        }
        .background(Theme.Colors.background)
    }

    private var headerRow: some View {
        GridRow {
            cell("HOLE", width: 92, alignment: .leading)
                .foregroundStyle(Theme.Colors.textSecondary)
            ForEach(front, id: \.self) { hole in
                cell("\(hole)").foregroundStyle(Theme.Colors.textSecondary)
            }
            if !front.isEmpty { cell("OUT", width: 46).foregroundStyle(Theme.Colors.money) }
            ForEach(back, id: \.self) { hole in
                cell("\(hole)").foregroundStyle(Theme.Colors.textSecondary)
            }
            if !back.isEmpty { cell("IN", width: 46).foregroundStyle(Theme.Colors.money) }
            cell("TOT", width: 52).foregroundStyle(Theme.Colors.money)
        }
    }

    private var parRow: some View {
        GridRow {
            cell("PAR", width: 92, alignment: .leading)
                .foregroundStyle(Theme.Colors.textSecondary)
            ForEach(front, id: \.self) { hole in
                cell("\(par(hole))").foregroundStyle(Theme.Colors.textSecondary)
            }
            if !front.isEmpty {
                cell("\(front.reduce(0) { $0 + par($1) })", width: 46)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
            ForEach(back, id: \.self) { hole in
                cell("\(par(hole))").foregroundStyle(Theme.Colors.textSecondary)
            }
            if !back.isEmpty {
                cell("\(back.reduce(0) { $0 + par($1) })", width: 46)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
            cell("\(holes.reduce(0) { $0 + par($1) })", width: 52)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    private func playerRow(_ player: ScoringPlayer) -> some View {
        GridRow {
            HStack(spacing: Theme.Spacing.xs) {
                Text(session.emoji(for: player.id))
                Text(shortName(player.name))
                    .lineLimit(1)
            }
            .frame(width: 92, alignment: .leading)
            .padding(.vertical, Theme.Spacing.s)
            .foregroundStyle(Theme.Colors.textPrimary)

            ForEach(front, id: \.self) { hole in
                scoreCell(player: player, hole: hole)
            }
            if !front.isEmpty {
                cell(total(player, holes: front), width: 46).foregroundStyle(Theme.Colors.textPrimary)
            }
            ForEach(back, id: \.self) { hole in
                scoreCell(player: player, hole: hole)
            }
            if !back.isEmpty {
                cell(total(player, holes: back), width: 46).foregroundStyle(Theme.Colors.textPrimary)
            }
            cell(total(player, holes: holes), width: 52).foregroundStyle(Theme.Colors.textPrimary)
        }
    }

    private func scoreCell(player: ScoringPlayer, hole: Int) -> some View {
        let strokes = session.strokes(for: player.id, hole: hole)
        return Button {
            session.currentHole = hole
        } label: {
            Text(strokes.map(String.init) ?? "·")
                .foregroundStyle(
                    strokes.map { ScoreQuality(strokes: $0, par: par(hole)).color }
                        ?? Theme.Colors.stroke
                )
                .frame(width: 34, height: 38)
        }
        .accessibilityLabel("\(player.name), hole \(hole): \(strokes.map(String.init) ?? "no score")")
    }

    private func cell(_ text: String, width: CGFloat = 34, alignment: Alignment = .center) -> some View {
        Text(text)
            .frame(width: width, height: 38, alignment: alignment)
    }

    private func par(_ hole: Int) -> Int {
        session.snapshot.course.hole(hole)?.par ?? 4
    }

    private func total(_ player: ScoringPlayer, holes: [Int]) -> String {
        let scores = holes.compactMap { session.strokes(for: player.id, hole: $0) }
        return scores.isEmpty ? "–" : "\(scores.reduce(0, +))"
    }

    private func shortName(_ name: String) -> String {
        name.split(separator: " ").first.map(String.init) ?? name
    }
}
