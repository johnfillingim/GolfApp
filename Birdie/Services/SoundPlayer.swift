import AVFoundation
import Foundation

/// Optional celebration chimes.
///
/// Silent-switch policy: the audio session uses `.ambient`, which iOS
/// mutes with the ringer switch and mixes under any music the player has
/// going in the cart. Sounds are also individually skippable via the
/// in-app toggle, and entirely absent unless sound assets are bundled.
///
/// ⚠️ Assets needed: short (≤ 1s) .caf files named below, added to the
/// app bundle. Ship without them and the app is simply quiet — flagged in
/// the README's "assets wanted" list.
@MainActor
final class SoundPlayer {

    static let shared = SoundPlayer()

    enum Effect: String, CaseIterable {
        case birdie = "chime-birdie"
        case eagle = "chime-eagle"
        case jackpot = "fanfare-ace"
        case money = "money-win"
        case tick = "tick"
    }

    var isEnabled: Bool {
        get { !UserDefaults.standard.bool(forKey: "birdie.sound.disabled") }
        set { UserDefaults.standard.set(!newValue, forKey: "birdie.sound.disabled") }
    }

    private var players: [Effect: AVAudioPlayer] = [:]

    private init() {
        // .ambient = respect the silent switch, mix with other audio.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, options: [.mixWithOthers])

        for effect in Effect.allCases {
            if let url = Bundle.main.url(forResource: effect.rawValue, withExtension: "caf"),
               let player = try? AVAudioPlayer(contentsOf: url) {
                player.prepareToPlay()
                players[effect] = player
            }
        }
    }

    func play(_ effect: Effect) {
        guard isEnabled, let player = players[effect] else { return }
        player.currentTime = 0
        player.play()
    }

    func effect(for tier: CelebrationTier) -> Effect? {
        switch tier {
        case .toast, .minor: return nil
        case .medium: return .birdie
        case .major: return .eagle
        case .jackpot: return .jackpot
        }
    }
}
