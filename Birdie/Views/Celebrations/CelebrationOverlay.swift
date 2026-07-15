import SwiftUI
import Scoring

// MARK: - Celebration overlay
//
// Renders whatever the CelebrationEngine says is current. Design rules:
// - NEVER blocks input to the app below: only the banner itself is
//   hittable (tap = skip); the rest of the overlay is `allowsHitTesting
//   (false)`, so you can keep punching in scores through the confetti.
// - Interruptible & skippable: tap the banner, or just keep playing.
// - Reduce Motion: particles are dropped entirely; the banner fades and
//   scales gently instead of springing. Haptics still fire (they're the
//   accessible channel).
// - Tier is intensity: toast = one line; medium = banner + burst;
//   major = banner + fuller burst; jackpot = full-screen confetti rain.

struct CelebrationOverlay: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            if let celebration = env.celebrations.current {
                if !reduceMotion && celebration.tier >= .medium {
                    ConfettiView(
                        intensity: celebration.tier == .jackpot ? 1.0 : (celebration.tier == .major ? 0.55 : 0.3),
                        gold: celebration.tier == .jackpot
                    )
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
                }

                banner(for: celebration)
                    .id(celebration.id)
                    .transition(
                        reduceMotion
                            ? .opacity
                            : .asymmetric(
                                insertion: .scale(scale: 0.7).combined(with: .opacity),
                                removal: .opacity.combined(with: .offset(y: -24))
                            )
                    )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .animation(reduceMotion ? .easeOut(duration: 0.25) : Theme.Motion.celebratory, value: env.celebrations.current?.id)
        .accessibilityAddTraits(.updatesFrequently)
    }

    @ViewBuilder
    private func banner(for celebration: Celebration) -> some View {
        Button {
            env.celebrations.skip()
        } label: {
            HStack(spacing: Theme.Spacing.m) {
                Text(celebration.emoji)
                    .font(.system(size: celebration.tier >= .major ? 44 : 32))

                VStack(alignment: .leading, spacing: 2) {
                    Text(celebration.title)
                        .font(celebration.tier >= .major ? Theme.Typo.title : Theme.Typo.headline)
                        .foregroundStyle(celebration.tier == .jackpot ? Theme.Colors.gold : Theme.Colors.textPrimary)
                        .lineLimit(2)
                    if let subtitle = celebration.subtitle {
                        Text(subtitle)
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }

                if let money = celebration.money {
                    Spacer(minLength: Theme.Spacing.s)
                    MoneyText(amount: money)
                }
            }
            .padding(.horizontal, Theme.Spacing.m)
            .padding(.vertical, Theme.Spacing.m - 2)
            .frame(maxWidth: 560)
            .background(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .fill(Theme.Colors.surfaceRaised.opacity(0.96))
                    .shadow(color: .black.opacity(0.5), radius: 18, y: 8)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                    .strokeBorder(
                        celebration.tier == .jackpot
                            ? Theme.Colors.gold.opacity(0.8)
                            : (celebration.isMine && celebration.tier >= .medium
                                ? Theme.Colors.money.opacity(0.6)
                                : Theme.Colors.stroke),
                        lineWidth: celebration.tier >= .major ? 2 : 1
                    )
            )
        }
        .buttonStyle(.plain)
        .padding(.horizontal, Theme.Spacing.m)
        .padding(.top, Theme.Spacing.s)
        .accessibilityLabel("\(celebration.title). \(celebration.subtitle ?? "") Double-tap to dismiss.")
    }
}

// MARK: - Confetti
//
// A native particle system: Canvas + TimelineView, no assets, no
// dependencies. ~120 particles at jackpot intensity — trivial for Canvas.
// The CelebrationEngine/overlay isolate this renderer completely, so a
// Rive scene can replace it later without touching celebration logic
// (see ARCHITECTURE.md → "Motion stack").

struct ConfettiView: View {
    let intensity: Double        // 0...1 → particle count & spread
    var gold = false

    private struct Particle {
        let seedX: Double        // 0...1 horizontal origin
        let delay: Double
        let fallSpeed: Double    // points/sec
        let drift: Double        // horizontal sway amplitude
        let spin: Double         // rotations/sec
        let size: CGSize
        let color: Color
        let isRectangle: Bool
    }

    @State private var particles: [Particle] = []
    @State private var startDate = Date()

    private static let palette: [Color] = [
        Theme.Colors.money, Theme.Colors.fairway, Theme.Colors.gold,
        Color(hex: 0x6BD4FF), Color(hex: 0xFF9AF5), Theme.Colors.textPrimary,
    ]
    private static let goldPalette: [Color] = [
        Theme.Colors.gold, Color(hex: 0xFFE9A3), Theme.Colors.money, Theme.Colors.textPrimary,
    ]

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let elapsed = timeline.date.timeIntervalSince(startDate)
                for particle in particles {
                    let t = elapsed - particle.delay
                    guard t > 0 else { continue }

                    let y = t * particle.fallSpeed - 40
                    guard y < size.height + 40 else { continue }

                    let sway = sin(t * 2.2 + particle.seedX * .pi * 2) * particle.drift
                    let x = particle.seedX * size.width + sway
                    let rotation = Angle.radians(t * particle.spin * 2 * .pi)
                    // Fade in fast, out near the bottom.
                    let opacity = min(1, t * 4) * (1 - max(0, (y / size.height) - 0.75) * 4)

                    var ctx = context
                    ctx.opacity = opacity
                    ctx.translateBy(x: x, y: y)
                    ctx.rotate(by: rotation)
                    // "3D" tumble: squash width with a second oscillator.
                    let squash = abs(cos(t * 3.1 + particle.seedX * 7))
                    let rect = CGRect(
                        x: -particle.size.width / 2 * squash,
                        y: -particle.size.height / 2,
                        width: particle.size.width * squash,
                        height: particle.size.height
                    )
                    if particle.isRectangle {
                        ctx.fill(Path(rect), with: .color(particle.color))
                    } else {
                        ctx.fill(Path(ellipseIn: rect), with: .color(particle.color))
                    }
                }
            }
        }
        .onAppear {
            startDate = Date()
            particles = Self.makeParticles(count: Int(40 + intensity * 80), gold: gold)
        }
    }

    private static func makeParticles(count: Int, gold: Bool) -> [Particle] {
        let colors = gold ? goldPalette : palette
        return (0..<count).map { _ in
            Particle(
                seedX: .random(in: 0...1),
                delay: .random(in: 0...0.9),
                fallSpeed: .random(in: 220...420),
                drift: .random(in: 12...44),
                spin: .random(in: 0.6...2.4),
                size: CGSize(width: .random(in: 6...12), height: .random(in: 8...14)),
                color: colors.randomElement()!,
                isRectangle: .random()
            )
        }
    }
}
