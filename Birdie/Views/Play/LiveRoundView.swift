import SwiftData
import SwiftUI
import Scoring

/// Container for a live round: hosts the RoundSession, wires it to the
/// sync pump, and tabs between scoring, the full card, standings, GPS,
/// and money.
struct LiveRoundView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.modelContext) private var context

    let round: Round
    @State private var session: RoundSession?
    @State private var shareURL: URL?
    @State private var shareError: String?

    var body: some View {
        Group {
            if let session {
                content(session: session)
            } else {
                ProgressView()
            }
        }
        .background(Theme.Colors.background)
        .task {
            if session == nil {
                let newSession = RoundSession(
                    round: round,
                    context: context,
                    sync: env.sync,
                    celebrations: env.celebrations,
                    myProfileID: AuthService.myProfile(context: context)?.id
                )
                session = newSession
                env.activeSession = newSession
            }
            env.location.requestPermission()
            env.location.startUpdates()
        }
        .onDisappear {
            env.location.stopUpdates()
        }
    }

    private func content(session: RoundSession) -> some View {
        TabView {
            ScorecardView(session: session)
                .tabItem { Label("Score", systemImage: "pencil.circle.fill") }
            ScoreGridView(session: session)
                .tabItem { Label("Card", systemImage: "tablecells") }
            StandingsView(session: session)
                .tabItem { Label("Standings", systemImage: "chart.bar.fill") }
            HoleMapView(session: session)
                .tabItem { Label("GPS", systemImage: "location.fill") }
            SettlementView(session: session)
                .tabItem { Label("Money", systemImage: "dollarsign.circle.fill") }
        }
        .tint(Theme.Colors.money)
        .navigationTitle(session.snapshot.course.name)
        .navigationBarTitleDisplayMode(.inline)
        // The round has its own tab bar; hide the app-level one while
        // playing so there aren't two stacked bars.
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                shareButton(session: session)
            }
        }
        .alert("Sharing unavailable", isPresented: .init(
            get: { shareError != nil },
            set: { if !$0 { shareError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(shareError ?? "")
        }
    }

    @ViewBuilder
    private func shareButton(session: RoundSession) -> some View {
        if let shareURL {
            ShareLink(item: shareURL) {
                Image(systemName: "person.crop.circle.badge.plus")
            }
            .accessibilityLabel("Share round invite link")
        } else {
            Button {
                Task {
                    do {
                        shareURL = try await env.sync.startSharing(round: round)
                    } catch {
                        shareError = error.localizedDescription
                    }
                }
            } label: {
                Image(systemName: env.sync.status.isShareCapable
                      ? "person.crop.circle.badge.plus"
                      : "iphone.slash")
            }
            .accessibilityLabel("Invite the group to score live")
        }
    }
}
