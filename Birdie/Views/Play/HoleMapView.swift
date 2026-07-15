import MapKit
import SwiftUI
import Scoring

/// Satellite view of the current hole with live distance to the green and
/// optional shot pins. Entirely optional garnish: scoring never depends on
/// anything here, and the whole tab degrades gracefully with location off.
struct HoleMapView: View {
    @Bindable var session: RoundSession
    @Environment(AppEnvironment.self) private var env

    @State private var position: MapCameraPosition = .automatic

    private var catalogCourse: CatalogCourse? {
        CatalogCourse.decode(session.round.courseData)
    }

    private var hole: CatalogHole? {
        catalogCourse?.hole(session.currentHole)
    }

    private var myShots: [ShotModel] {
        guard let myID = session.myPlayerID else { return [] }
        return session.round.shots
            .filter { $0.playerID == myID && $0.hole == session.currentHole }
            .sorted { $0.sequence < $1.sequence }
    }

    var body: some View {
        VStack(spacing: 0) {
            holeStepper

            if let hole {
                map(hole: hole)
                controls(hole: hole)
            } else {
                EmptyState(
                    emoji: "🗺️",
                    title: "No geometry for this hole",
                    message: "This course card has no GPS data; the scorecard still works everywhere."
                )
                Spacer()
            }
        }
        .background(Theme.Colors.background)
    }

    private var holeStepper: some View {
        HStack {
            Button {
                step(-1)
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: Theme.minTarget, height: Theme.minTarget)
            }
            .accessibilityLabel("Previous hole")
            Spacer()
            Text("Hole \(session.currentHole)")
                .font(Theme.Typo.title)
                .foregroundStyle(Theme.Colors.textPrimary)
            Spacer()
            Button {
                step(1)
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: Theme.minTarget, height: Theme.minTarget)
            }
            .accessibilityLabel("Next hole")
        }
        .foregroundStyle(Theme.Colors.money)
        .padding(.horizontal, Theme.Spacing.m)
    }

    private func step(_ delta: Int) {
        let holes = session.snapshot.holeNumbers
        guard let index = holes.firstIndex(of: session.currentHole) else { return }
        let next = holes.index(index, offsetBy: delta, limitedBy: holes.indices.last ?? 0) ?? index
        if holes.indices.contains(next) {
            session.currentHole = holes[next]
        }
    }

    // MARK: Map

    private func map(hole: CatalogHole) -> some View {
        Map(position: $position) {
            if let green = hole.greenCenter {
                Annotation("Green", coordinate: green) {
                    Image(systemName: "flag.fill")
                        .foregroundStyle(Theme.Colors.money)
                        .padding(6)
                        .background(Circle().fill(.black.opacity(0.55)))
                }
            }
            if let tee = hole.tee {
                Annotation("Tee", coordinate: tee) {
                    Image(systemName: "circle.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(Theme.Colors.textPrimary)
                        .padding(5)
                        .background(Circle().fill(.black.opacity(0.55)))
                }
            }
            ForEach(Array(myShots.enumerated()), id: \.element.id) { index, shot in
                Annotation("Shot \(index + 1)", coordinate: CLLocationCoordinate2D(latitude: shot.latitude, longitude: shot.longitude)) {
                    Text("\(index + 1)")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.textOnAccent)
                        .padding(6)
                        .background(Circle().fill(Theme.Colors.money))
                }
            }
            UserAnnotation()
        }
        .mapStyle(.hybrid(elevation: .flat))
        .onChange(of: session.currentHole) { _, _ in
            frameHole()
        }
        .onAppear {
            frameHole()
        }
    }

    private func frameHole() {
        guard let hole, let tee = hole.tee, let green = hole.greenCenter else { return }
        let center = CLLocationCoordinate2D(
            latitude: (tee.latitude + green.latitude) / 2,
            longitude: (tee.longitude + green.longitude) / 2
        )
        let spanMeters = Double(max(hole.yards, 120)) * 0.9144 * 1.6
        position = .region(MKCoordinateRegion(
            center: center,
            latitudinalMeters: spanMeters,
            longitudinalMeters: spanMeters
        ))
    }

    // MARK: Controls

    private func controls(hole: CatalogHole) -> some View {
        VStack(spacing: Theme.Spacing.s) {
            HStack(spacing: Theme.Spacing.l) {
                distanceBlock(label: "FRONT", yards: env.location.yards(to: hole.greenFront))
                distanceBlock(label: "CENTER", yards: env.location.yards(to: hole.greenCenter), hero: true)
                distanceBlock(label: "BACK", yards: env.location.yards(to: hole.greenBack))
            }
            .frame(maxWidth: .infinity)

            switch env.location.availability {
            case .authorized:
                Button {
                    dropShotPin()
                } label: {
                    Label(myShots.isEmpty ? "Mark tee shot" : "Mark shot \(myShots.count + 1)", systemImage: "scope")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(env.location.lastLocation == nil || session.myPlayerID == nil)

                if let lastDistance = lastShotDistance {
                    Text("Last shot: \(lastDistance) yds")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.money)
                }
            case .denied:
                Text("Location is off — distances use the card yardage (\(hole.yards) yds). Enable location in Settings for live numbers and shot tracking.")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                    .multilineTextAlignment(.center)
            case .notDetermined:
                Button("Enable GPS distances") {
                    env.location.requestPermission()
                }
                .buttonStyle(PrimaryButtonStyle(prominent: false))
            }
        }
        .padding(Theme.Spacing.m)
        .background(Theme.Colors.surface)
    }

    private func distanceBlock(label: String, yards: Int?, hero: Bool = false) -> some View {
        VStack(spacing: 0) {
            Text(yards.map(String.init) ?? "–")
                .font(hero ? Theme.Typo.moneyLarge : Theme.Typo.money)
                .foregroundStyle(hero ? Theme.Colors.money : Theme.Colors.textPrimary)
                .contentTransition(.numericText())
            Text(label)
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    /// Distance between the two most recent pins — "how far did I hit that?"
    private var lastShotDistance: Int? {
        guard myShots.count >= 2 else { return nil }
        let a = myShots[myShots.count - 2]
        let b = myShots[myShots.count - 1]
        return LocationService.yards(
            from: CLLocationCoordinate2D(latitude: a.latitude, longitude: a.longitude),
            to: CLLocationCoordinate2D(latitude: b.latitude, longitude: b.longitude)
        )
    }

    private func dropShotPin() {
        guard let myID = session.myPlayerID,
              let location = env.location.lastLocation else { return }
        let shot = ShotModel(
            playerID: myID,
            hole: session.currentHole,
            sequence: myShots.count + 1,
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        )
        shot.round = session.round
        session.round.shots.append(shot)
        HapticPlayer.shared.confirm()
    }
}
