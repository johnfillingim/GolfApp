import CoreHaptics
import UIKit

/// Haptics are integral to the celebration language, not decoration:
/// each celebration tier has a distinct physical signature so a birdie
/// *feels* different from a won skin before you even look down.
///
/// CoreHaptics drives the custom patterns; devices without a haptic engine
/// (or after an engine failure) degrade to UIFeedbackGenerator taps, and
/// everything silently no-ops when unsupported — haptics must never crash
/// or block scoring.
@MainActor
final class HapticPlayer {

    static let shared = HapticPlayer()

    /// User toggle (Settings screen); system-level haptic settings are
    /// respected automatically by both engines underneath.
    var isEnabled: Bool {
        get { !UserDefaults.standard.bool(forKey: "birdie.haptics.disabled") }
        set { UserDefaults.standard.set(!newValue, forKey: "birdie.haptics.disabled") }
    }

    private var engine: CHHapticEngine?
    private let supportsHaptics = CHHapticEngine.capabilitiesForHardware().supportsHaptics

    private init() {
        prepareEngine()
    }

    private func prepareEngine() {
        guard supportsHaptics else { return }
        do {
            let engine = try CHHapticEngine()
            engine.playsHapticsOnly = true
            // Recreate lazily after interruptions (calls, backgrounding).
            engine.resetHandler = { [weak self] in
                Task { @MainActor in self?.prepareEngine() }
            }
            try engine.start()
            self.engine = engine
        } catch {
            engine = nil // Fall back to UIFeedbackGenerator below.
        }
    }

    // MARK: Public vocabulary

    /// Score stepper ticks — tiny, so 90 taps a round never annoys.
    func tick() {
        guard isEnabled else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.6)
    }

    /// A quiet acknowledgment (score saved, press declared).
    func confirm() {
        guard isEnabled else { return }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }

    func warning() {
        guard isEnabled else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
    }

    /// Celebration signatures, by tier.
    func celebrate(_ tier: CelebrationTier) {
        guard isEnabled else { return }
        switch tier {
        case .toast:
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case .minor:
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case .medium:
            play(pattern: Self.doubleThump) {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
        case .major:
            play(pattern: Self.risingBuzz) {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
        case .jackpot:
            play(pattern: Self.jackpotSalvo) {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
        }
    }

    // MARK: CoreHaptics patterns

    private func play(pattern events: [CHHapticEvent], fallback: () -> Void) {
        guard supportsHaptics, let engine else {
            fallback()
            return
        }
        do {
            let player = try engine.makePlayer(with: CHHapticPattern(events: events, parameters: []))
            try engine.start()
            try player.start(atTime: CHHapticTimeImmediate)
        } catch {
            fallback()
        }
    }

    /// "Ba-dum" — the birdie/money signature.
    private static let doubleThump: [CHHapticEvent] = [
        transient(intensity: 0.8, sharpness: 0.55, at: 0),
        transient(intensity: 1.0, sharpness: 0.7, at: 0.12),
    ]

    /// A swell into a hit — eagles, lone-wolf wins.
    private static let risingBuzz: [CHHapticEvent] = [
        continuous(intensity: 0.45, sharpness: 0.3, at: 0, duration: 0.28),
        transient(intensity: 1.0, sharpness: 0.85, at: 0.3),
        transient(intensity: 0.7, sharpness: 0.5, at: 0.42),
    ]

    /// The ace: three accelerating hits into a long rumble.
    private static let jackpotSalvo: [CHHapticEvent] = [
        transient(intensity: 0.7, sharpness: 0.6, at: 0),
        transient(intensity: 0.85, sharpness: 0.7, at: 0.14),
        transient(intensity: 1.0, sharpness: 0.9, at: 0.25),
        continuous(intensity: 0.6, sharpness: 0.35, at: 0.3, duration: 0.5),
    ]

    private static func transient(intensity: Float, sharpness: Float, at time: TimeInterval) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time
        )
    }

    private static func continuous(intensity: Float, sharpness: Float, at time: TimeInterval, duration: TimeInterval) -> CHHapticEvent {
        CHHapticEvent(
            eventType: .hapticContinuous,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
            ],
            relativeTime: time,
            duration: duration
        )
    }
}
