import SwiftData
import SwiftUI

struct RootView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.modelContext) private var context

    var body: some View {
        ZStack {
            Theme.Colors.background.ignoresSafeArea()

            switch env.auth.state {
            case .checking:
                ProgressView()
            case .needsOnboarding:
                OnboardingView()
            case .ready:
                MainTabView()
            }

            // Celebrations render above everything but never block below —
            // see CelebrationOverlay for the passthrough behavior.
            CelebrationOverlay()
        }
        .task {
            env.auth.bootstrap(context: context)
        }
    }
}

struct MainTabView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Play", systemImage: "figure.golf") }
            HistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        .tint(Theme.Colors.money)
    }
}
