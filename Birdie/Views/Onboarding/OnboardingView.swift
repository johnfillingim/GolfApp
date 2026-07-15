import AuthenticationServices
import SwiftData
import SwiftUI

/// First-run: name, avatar, optional handicap, then Sign in with Apple or
/// guest. Nothing here gates the product — SIWA only buys identity restore
/// after reinstall.
struct OnboardingView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.modelContext) private var context

    @State private var name = ""
    @State private var emoji = "⛳️"
    @State private var handicapText = ""

    private static let emojiChoices = ["⛳️", "🏌️", "🏌️‍♀️", "🦅", "🐺", "🍺", "🎯", "🔥", "🦈", "🃏"]

    private var handicapIndex: Double? {
        Double(handicapText.replacingOccurrences(of: ",", with: "."))
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.l) {
                VStack(spacing: Theme.Spacing.s) {
                    Text("🐦")
                        .font(.system(size: 72))
                    Text("Birdie")
                        .font(Theme.Typo.display)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    Text("Run your golf group's side bets.\nLive scores, live money, easy settle-up.")
                        .font(Theme.Typo.body)
                        .foregroundStyle(Theme.Colors.textSecondary)
                        .multilineTextAlignment(.center)
                }
                .padding(.top, Theme.Spacing.xl)

                Card {
                    VStack(alignment: .leading, spacing: Theme.Spacing.m) {
                        Text("Your profile")
                            .font(Theme.Typo.headline)
                            .foregroundStyle(Theme.Colors.textPrimary)

                        TextField("Name", text: $name)
                            .textContentType(.name)
                            .font(Theme.Typo.body)
                            .padding(Theme.Spacing.m)
                            .background(Theme.Colors.surfaceRaised)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip))

                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: Theme.Spacing.s) {
                                ForEach(Self.emojiChoices, id: \.self) { choice in
                                    Button {
                                        emoji = choice
                                    } label: {
                                        PlayerAvatar(emoji: choice, size: 48, highlighted: emoji == choice)
                                    }
                                    .accessibilityLabel("Avatar \(choice)")
                                }
                            }
                        }

                        TextField("Handicap index (optional)", text: $handicapText)
                            .keyboardType(.decimalPad)
                            .font(Theme.Typo.body)
                            .padding(Theme.Spacing.m)
                            .background(Theme.Colors.surfaceRaised)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip))
                    }
                }

                VStack(spacing: Theme.Spacing.m) {
                    SignInWithAppleButton(.continue) { request in
                        request.requestedScopes = [.fullName]
                    } onCompletion: { result in
                        env.auth.handleSignIn(
                            result,
                            context: context,
                            fallbackName: trimmedName.isEmpty ? "Player" : trimmedName,
                            emoji: emoji,
                            handicapIndex: handicapIndex
                        )
                    }
                    .signInWithAppleButtonStyle(.white)
                    .frame(height: Theme.minTarget + 4)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.button))

                    Button("Continue without an account") {
                        env.auth.continueAsGuest(
                            name: trimmedName.isEmpty ? "Player" : trimmedName,
                            emoji: emoji,
                            handicapIndex: handicapIndex,
                            context: context
                        )
                    }
                    .buttonStyle(PrimaryButtonStyle(prominent: false))
                }

                Text("Birdie tracks bets and who owes whom. It never touches real money — settle in cash or Venmo like always.")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, Theme.Spacing.l)
            }
            .padding(Theme.Spacing.m)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.Colors.background)
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
