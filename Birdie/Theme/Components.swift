import SwiftUI
import Scoring

// MARK: - Shared components
//
// The small vocabulary the whole app is built from. Anything used twice
// lives here so screens stay thin and the design language stays coherent.

// MARK: Cards

struct Card<Content: View>: View {
    var raised = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(Theme.Spacing.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(raised ? Theme.Colors.surfaceRaised : Theme.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .strokeBorder(Theme.Colors.stroke, lineWidth: 1)
            )
    }
}

// MARK: Buttons

struct PrimaryButtonStyle: ButtonStyle {
    var prominent = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Theme.Typo.headline)
            .foregroundStyle(prominent ? Theme.Colors.textOnAccent : Theme.Colors.textPrimary)
            .frame(maxWidth: .infinity, minHeight: Theme.minTarget + 4)
            .background(
                prominent
                    ? (configuration.isPressed ? Theme.Colors.fairwayPressed : Theme.Colors.fairway)
                    : (configuration.isPressed ? Theme.Colors.surfaceRaised : Theme.Colors.surface)
            )
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.button, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.button, style: .continuous)
                    .strokeBorder(prominent ? .clear : Theme.Colors.stroke, lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(Theme.Motion.snappy, value: configuration.isPressed)
    }
}

// MARK: Money

extension Money {
    /// "+$12.50" / "−$3.00" / "$0"; drops cents when whole dollars.
    var display: String {
        let absCents = abs(cents)
        let sign = cents > 0 ? "+" : (cents < 0 ? "−" : "")
        if absCents % 100 == 0 {
            return "\(sign)$\(absCents / 100)"
        }
        return String(format: "%@$%d.%02d", sign, absCents / 100, absCents % 100)
    }

    /// Unsigned rendering for stakes ("$5 Nassau").
    var displayUnsigned: String {
        let absCents = abs(cents)
        if absCents % 100 == 0 { return "$\(absCents / 100)" }
        return String(format: "$%d.%02d", absCents / 100, absCents % 100)
    }
}

/// The standard money chip: color-coded by sign, monospaced digits.
struct MoneyText: View {
    let amount: Money
    var large = false

    var body: some View {
        Text(amount.display)
            .font(large ? Theme.Typo.moneyLarge : Theme.Typo.money)
            .foregroundStyle(Theme.Colors.standing(amount.cents))
            .contentTransition(.numericText())
    }
}

// MARK: Players

struct PlayerAvatar: View {
    let emoji: String
    var size: CGFloat = 40
    var highlighted = false

    var body: some View {
        Text(emoji)
            .font(.system(size: size * 0.52))
            .frame(width: size, height: size)
            .background(Circle().fill(Theme.Colors.surfaceRaised))
            .overlay(
                Circle().strokeBorder(
                    highlighted ? Theme.Colors.money : Theme.Colors.stroke,
                    lineWidth: highlighted ? 2 : 1
                )
            )
    }
}

// MARK: Chips & labels

struct TagChip: View {
    let text: String
    var color: Color = Theme.Colors.neutral

    var body: some View {
        Text(text)
            .font(Theme.Typo.caption)
            .foregroundStyle(color)
            .padding(.horizontal, Theme.Spacing.s + 2)
            .padding(.vertical, 5)
            .background(
                Capsule().fill(color.opacity(0.14))
            )
            .overlay(Capsule().strokeBorder(color.opacity(0.35), lineWidth: 1))
    }
}

/// Score quality → color + name, used by scorecard cells and history.
enum ScoreQuality {
    case albatrossOrBetter, eagle, birdie, par, bogey, worse

    init(strokes: Int, par: Int) {
        switch strokes - par {
        case ..<(-2): self = .albatrossOrBetter
        case -2: self = .eagle
        case -1: self = .birdie
        case 0: self = .par
        case 1: self = .bogey
        default: self = .worse
        }
    }

    var color: Color {
        switch self {
        case .albatrossOrBetter: return Theme.Colors.gold
        case .eagle: return Theme.Colors.gold
        case .birdie: return Theme.Colors.money
        case .par: return Theme.Colors.textPrimary
        case .bogey: return Theme.Colors.neutral
        case .worse: return Theme.Colors.down
        }
    }
}

// MARK: Big stepper
//
// The score entry control: giant tap zones, first tap = par, haptic tick
// per step. Built for one thumb, a glove, and direct sunlight.

struct BigStepper: View {
    let value: Int?
    let par: Int
    let onAdjust: (Int) -> Void

    var body: some View {
        HStack(spacing: Theme.Spacing.m) {
            stepButton(symbol: "minus", delta: -1)

            VStack(spacing: 2) {
                Text(value.map(String.init) ?? "–")
                    .font(Theme.Typo.scoreXL)
                    .foregroundStyle(scoreColor)
                    .contentTransition(.numericText())
                    .animation(Theme.Motion.snappy, value: value)
                    .frame(minWidth: 120)
                Text(relativeLabel)
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(value.map { "Score \($0), \(relativeLabel)" } ?? "No score yet")

            stepButton(symbol: "plus", delta: +1)
        }
    }

    private var scoreColor: Color {
        guard let value else { return Theme.Colors.textSecondary }
        return ScoreQuality(strokes: value, par: par).color
    }

    private var relativeLabel: String {
        guard let value else { return "tap – or + to start at par" }
        switch value - par {
        case ..<(-2): return "albatross!"
        case -2: return "eagle"
        case -1: return "birdie"
        case 0: return "par"
        case 1: return "bogey"
        case 2: return "double"
        default: return "+\(value - par)"
        }
    }

    private func stepButton(symbol: String, delta: Int) -> some View {
        Button {
            onAdjust(delta)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Theme.Colors.textPrimary)
                .frame(width: 72, height: 88)
                .background(Theme.Colors.surfaceRaised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.button, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.button, style: .continuous)
                        .strokeBorder(Theme.Colors.stroke, lineWidth: 1)
                )
        }
        .buttonRepeatBehavior(.enabled)
        .accessibilityLabel(delta > 0 ? "Add a stroke" : "Remove a stroke")
    }
}

// MARK: Section header

struct SectionHeader: View {
    let title: String
    var trailing: String? = nil

    var body: some View {
        HStack {
            Text(title)
                .font(Theme.Typo.title)
                .foregroundStyle(Theme.Colors.textPrimary)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }
}

// MARK: Empty state

struct EmptyState: View {
    let emoji: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: Theme.Spacing.s) {
            Text(emoji).font(.system(size: 44))
            Text(title)
                .font(Theme.Typo.headline)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(message)
                .font(Theme.Typo.body)
                .foregroundStyle(Theme.Colors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(Theme.Spacing.xl)
    }
}
