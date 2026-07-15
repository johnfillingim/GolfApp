import CloudKit
import SwiftData
import SwiftUI

@main
struct BirdieApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var environment = AppEnvironment()

    let container: ModelContainer

    init() {
        do {
            container = try ModelContainer(for: Schema(BirdieSchema.models))
        } catch {
            // A corrupt store on a dev device is the only realistic path
            // here; failing hard beats silently losing rounds.
            fatalError("Could not open the data store: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(environment)
                // Birdie is a dark-first product; the palette is tuned for
                // OLED and sunlight, not for a light variant.
                .preferredColorScheme(.dark)
                .task {
                    AppDelegate.environment = environment
                    environment.startSyncPump(container: container)
                }
        }
        .modelContainer(container)
    }
}

/// Exists for one job SwiftUI can't do natively: receiving CloudKit share
/// acceptances (a buddy tapped a round invite link).
final class AppDelegate: NSObject, UIApplicationDelegate {
    @MainActor static weak var environment: AppEnvironment?

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

final class SceneDelegate: NSObject, UIWindowSceneDelegate {
    func windowScene(
        _ windowScene: UIWindowScene,
        userDidAcceptCloudKitShareWith cloudKitShareMetadata: CKShare.Metadata
    ) {
        Task { @MainActor in
            guard let cloudSync = AppDelegate.environment?.sync as? CloudKitSyncService else { return }
            try? await cloudSync.acceptInvite(metadata: cloudKitShareMetadata)
        }
    }
}
