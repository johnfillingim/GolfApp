import SwiftUI

// MARK: - Design tokens
//
// One file owns every color, size, type style, and spring in the app.
// Principles:
// - Dark, premium, sporty: near-black with a green cast (never pure #000 —
//   it crushes OLED smearing and kills depth), deep fairway green as the
//   brand anchor, an electric lime reserved for MONEY and WINS so it stays
//   special, muted coral for "down" (red-green colorblind-safer than pure
//   red against green).
// - Outdoor legibility is a hard requirement: body text ≥ 17pt, primary
//   text at ~14:1 contrast on surfaces, no informational text below 60%
//   white, hit targets ≥ 48pt for gloved thumbs in sunlight.
// - Scores are numbers in motion: rounded design + monospaced digits so
//   steppers don't jitter.

enum Theme {

    // MARK: Colors

    enum Colors {
        /// App background — near-black with a green undertone.
        static let background = Color(hex: 0x0A0F0D)
        /// Cards and grouped content.
        static let surface = Color(hex: 0x141B18)
        /// Elevated cards, sheets.
        static let surfaceRaised = Color(hex: 0x1C2521)
        /// Hairlines and separators.
        static let stroke = Color(hex: 0x2A3630)

        /// Brand green — fairway. Buttons, selected states.
        static let fairway = Color(hex: 0x1F9D55)
        static let fairwayPressed = Color(hex: 0x177A41)

        /// Electric lime — money, wins, "up". Used sparingly, always earns
        /// attention when it appears.
        static let money = Color(hex: 0xB7F435)
        /// Losses, "down". Muted coral, not alarm-red.
        static let down = Color(hex: 0xFF7A6B)
        /// Halved / neutral states.
        static let neutral = Color(hex: 0x93A69C)
        /// Jackpot moments (ace, albatross).
        static let gold = Color(hex: 0xFFD34D)

        static let textPrimary = Color(hex: 0xF4F9F6)
        static let textSecondary = Color(hex: 0xAABBB2)
        static let textOnAccent = Color(hex: 0x07130C)

        /// Bet-state color language, used identically everywhere:
        /// up = money, down = coral, halved = neutral.
        static func standing(_ cents: Int) -> Color {
            if cents > 0 { return money }
            if cents < 0 { return down }
            return neutral
        }
    }

    // MARK: Spacing & shape

    enum Spacing {
        static let xs: CGFloat = 4
        static let s: CGFloat = 8
        static let m: CGFloat = 16
        static let l: CGFloat = 24
        static let xl: CGFloat = 32
    }

    enum Radius {
        static let chip: CGFloat = 10
        static let card: CGFloat = 18
        static let button: CGFloat = 14
    }

    /// Minimum hit target — gloved, moving, squinting.
    static let minTarget: CGFloat = 48

    // MARK: Typography

    enum Typo {
        /// Big scores on the entry screen.
        static let scoreXL = Font.system(size: 84, weight: .bold, design: .rounded).monospacedDigit()
        /// Standing headlines ("Jack 2↑").
        static let display = Font.system(size: 32, weight: .bold, design: .rounded)
        static let title = Font.system(size: 22, weight: .bold, design: .rounded)
        static let headline = Font.system(size: 17, weight: .semibold, design: .rounded)
        static let body = Font.system(size: 17, weight: .regular, design: .rounded)
        static let caption = Font.system(size: 13, weight: .medium, design: .rounded)
        /// Money amounts — always monospaced digits so columns align.
        static let money = Font.system(size: 17, weight: .bold, design: .rounded).monospacedDigit()
        static let moneyLarge = Font.system(size: 28, weight: .heavy, design: .rounded).monospacedDigit()
        static let grid = Font.system(size: 15, weight: .semibold, design: .rounded).monospacedDigit()
    }

    // MARK: Motion
    //
    // Spring-based, physical, interruptible. Three springs cover the app;
    // celebration views may layer on top but start from these.

    enum Motion {
        /// Steppers, chips, small state flips.
        static let snappy = Animation.spring(response: 0.28, dampingFraction: 0.78)
        /// Cards, sheets, standings reordering.
        static let standard = Animation.spring(response: 0.42, dampingFraction: 0.82)
        /// Celebration entrances — a little bounce, never floppy.
        static let celebratory = Animation.spring(response: 0.5, dampingFraction: 0.62)
    }
}

// MARK: - Hex color

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}
