import CoreLocation
import Foundation

/// GPS distances to the green — strictly a garnish. Every screen that uses
/// this must render sensibly in `.denied` (we show yardage-book numbers
/// from the course card instead of live distances, plus a quiet hint).
///
/// Uses the iOS 17 `CLLocationUpdate.liveUpdates()` async sequence rather
/// than the delegate dance; a tiny delegate remains only for authorization
/// change callbacks.
@MainActor
@Observable
final class LocationService: NSObject {

    enum Availability: Equatable {
        case notDetermined
        case denied
        case authorized
    }

    private(set) var availability: Availability = .notDetermined
    private(set) var lastLocation: CLLocation?

    private let manager = CLLocationManager()
    private var updatesTask: Task<Void, Never>?

    override init() {
        super.init()
        manager.delegate = self
        readAuthorization()
    }

    func requestPermission() {
        guard availability == .notDetermined else { return }
        manager.requestWhenInUseAuthorization()
    }

    /// Begin streaming positions (call when a round screen appears).
    func startUpdates() {
        guard availability == .authorized, updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            do {
                for try await update in CLLocationUpdate.liveUpdates(.otherNavigation) {
                    guard let self, !Task.isCancelled else { return }
                    if let location = update.location {
                        self.lastLocation = location
                    }
                }
            } catch {
                // GPS hiccups are non-fatal; distances just go stale.
            }
        }
    }

    func stopUpdates() {
        updatesTask?.cancel()
        updatesTask = nil
    }

    // MARK: Distances

    /// Whole-yard distance from the player to a coordinate, or nil when we
    /// have no fix (callers fall back to card yardage).
    func yards(to coordinate: CLLocationCoordinate2D?) -> Int? {
        guard let coordinate, let lastLocation else { return nil }
        let target = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        let meters = lastLocation.distance(from: target)
        return Int((meters * 1.09361).rounded())
    }

    static func yards(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) -> Int {
        let a = CLLocation(latitude: from.latitude, longitude: from.longitude)
        let b = CLLocation(latitude: to.latitude, longitude: to.longitude)
        return Int((a.distance(from: b) * 1.09361).rounded())
    }

    private func readAuthorization() {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            availability = .authorized
        case .denied, .restricted:
            availability = .denied
        case .notDetermined:
            availability = .notDetermined
        @unknown default:
            availability = .denied
        }
    }
}

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.readAuthorization()
            if self.availability == .authorized {
                self.startUpdates()
            }
        }
    }
}
