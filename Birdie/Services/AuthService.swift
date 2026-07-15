import AuthenticationServices
import Foundation
import SwiftData

/// Sign in with Apple, with a deliberate guest path.
///
/// Identity is intentionally lightweight: the app has no server accounts.
/// SIWA gives us a stable `appleUserID` (nice for restoring "me" after a
/// reinstall) and a name hint on first sign-in; declining it costs nothing
/// but that. Round sharing rides on iCloud (CKShare), which is orthogonal
/// to whether the user signed in with Apple here.
@MainActor
@Observable
final class AuthService {

    enum AuthState: Equatable {
        case checking
        case needsOnboarding
        case ready
    }

    private(set) var state: AuthState = .checking

    /// Loads the local "me" profile if one exists.
    func bootstrap(context: ModelContext) {
        state = Self.myProfile(context: context) == nil ? .needsOnboarding : .ready
    }

    static func myProfile(context: ModelContext) -> PlayerProfile? {
        var descriptor = FetchDescriptor<PlayerProfile>(predicate: #Predicate { $0.isMe })
        descriptor.fetchLimit = 1
        return try? context.fetch(descriptor).first
    }

    /// Completes Sign in with Apple. Returns the created/updated profile.
    @discardableResult
    func handleSignIn(
        _ result: Result<ASAuthorization, Error>,
        context: ModelContext,
        fallbackName: String,
        emoji: String,
        handicapIndex: Double?
    ) -> PlayerProfile? {
        guard case .success(let authorization) = result,
              let credential = authorization.credential as? ASAuthorizationAppleIDCredential
        else {
            return nil
        }

        // Apple only provides the name on the FIRST authorization —
        // capture it now or never.
        let appleName = credential.fullName.flatMap { components in
            let formatted = PersonNameComponentsFormatter.localizedString(from: components, style: .default)
            return formatted.isEmpty ? nil : formatted
        }

        let profile = Self.myProfile(context: context) ?? {
            let fresh = PlayerProfile(name: fallbackName, emoji: emoji, isMe: true)
            context.insert(fresh)
            return fresh
        }()
        profile.isMe = true
        profile.appleUserID = credential.user
        if let appleName, profile.name.isEmpty || profile.name == fallbackName {
            profile.name = appleName
        } else if profile.name.isEmpty {
            profile.name = fallbackName
        }
        profile.emoji = emoji
        profile.handicapIndex = handicapIndex

        state = .ready
        return profile
    }

    /// Skip SIWA entirely — everything works, identity is just local.
    @discardableResult
    func continueAsGuest(
        name: String,
        emoji: String,
        handicapIndex: Double?,
        context: ModelContext
    ) -> PlayerProfile {
        let profile = Self.myProfile(context: context) ?? {
            let fresh = PlayerProfile(name: name, emoji: emoji, isMe: true)
            context.insert(fresh)
            return fresh
        }()
        profile.name = name
        profile.emoji = emoji
        profile.handicapIndex = handicapIndex
        state = .ready
        return profile
    }
}
