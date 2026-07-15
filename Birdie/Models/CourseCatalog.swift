import Foundation
import CoreLocation
import Scoring

// MARK: - Course catalog
//
// v1 bundles a few demo courses. The shapes here (`CatalogCourse` /
// `CatalogHole`) are the ingestion contract for a future course API: a
// provider only has to emit this Codable structure. Rounds snapshot the
// course card into `Round.courseData`, so catalog changes never rewrite
// history.

struct CatalogHole: Codable, Hashable, Identifiable {
    var id: Int { number }
    let number: Int
    let par: Int
    let strokeIndex: Int
    let yards: Int
    // Green geometry for GPS distances. Front/back are along the approach
    // line; all optional so imported courses without geometry still work.
    let greenFrontLat: Double?
    let greenFrontLon: Double?
    let greenCenterLat: Double?
    let greenCenterLon: Double?
    let greenBackLat: Double?
    let greenBackLon: Double?
    let teeLat: Double?
    let teeLon: Double?

    var greenCenter: CLLocationCoordinate2D? {
        guard let greenCenterLat, let greenCenterLon else { return nil }
        return CLLocationCoordinate2D(latitude: greenCenterLat, longitude: greenCenterLon)
    }
    var greenFront: CLLocationCoordinate2D? {
        guard let greenFrontLat, let greenFrontLon else { return nil }
        return CLLocationCoordinate2D(latitude: greenFrontLat, longitude: greenFrontLon)
    }
    var greenBack: CLLocationCoordinate2D? {
        guard let greenBackLat, let greenBackLon else { return nil }
        return CLLocationCoordinate2D(latitude: greenBackLat, longitude: greenBackLon)
    }
    var tee: CLLocationCoordinate2D? {
        guard let teeLat, let teeLon else { return nil }
        return CLLocationCoordinate2D(latitude: teeLat, longitude: teeLon)
    }

    var holeInfo: HoleInfo {
        HoleInfo(number: number, par: par, strokeIndex: strokeIndex, yardage: yards)
    }
}

struct CatalogCourse: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let location: String
    let holes: [CatalogHole]

    var holeCount: Int { holes.count }
    var totalPar: Int { holes.reduce(0) { $0 + $1.par } }
    var totalYards: Int { holes.reduce(0) { $0 + $1.yards } }

    var courseInfo: CourseInfo {
        CourseInfo(name: name, holes: holes.map(\.holeInfo))
    }

    func hole(_ number: Int) -> CatalogHole? {
        holes.first { $0.number == number }
    }
}

enum CourseCatalog {

    static let all: [CatalogCourse] = [
        make(
            id: "demo.pinemeadow",
            name: "Pine Meadow Links",
            location: "Demo course · 18 holes",
            origin: CLLocationCoordinate2D(latitude: 36.5725, longitude: -121.9486),
            pars: [4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4],
            strokeIndexes: [5, 1, 17, 9, 13, 7, 15, 3, 11, 6, 16, 2, 10, 14, 4, 18, 8, 12],
            yards: [385, 540, 165, 410, 395, 430, 180, 555, 370,
                    400, 155, 570, 415, 380, 525, 145, 445, 405]
        ),
        make(
            id: "demo.oakridge",
            name: "Oak Ridge Municipal",
            location: "Demo course · 18 holes",
            origin: CLLocationCoordinate2D(latitude: 33.5021, longitude: -111.9280),
            pars: [4, 4, 5, 3, 4, 5, 4, 3, 4, 5, 4, 3, 4, 4, 4, 5, 3, 4],
            strokeIndexes: [7, 3, 11, 15, 1, 13, 5, 17, 9, 8, 2, 18, 12, 4, 10, 14, 16, 6],
            yards: [370, 425, 510, 175, 460, 495, 390, 150, 405,
                    520, 440, 160, 385, 450, 395, 505, 170, 415]
        ),
        make(
            id: "demo.creekside9",
            name: "Creekside Nine",
            location: "Demo course · 9 holes",
            origin: CLLocationCoordinate2D(latitude: 30.2955, longitude: -97.7841),
            pars: [4, 3, 5, 4, 4, 3, 4, 5, 4],
            strokeIndexes: [3, 7, 1, 5, 9, 8, 4, 2, 6],
            yards: [390, 170, 535, 405, 380, 155, 420, 515, 400]
        ),
    ]

    static func course(id: String) -> CatalogCourse? {
        all.first { $0.id == id }
    }

    /// Lays holes along a serpentine routing from an origin point so demo
    /// GPS distances behave like a real walk. One degree of latitude is
    /// ~111,111 m; longitude is scaled by cos(latitude).
    private static func make(
        id: String,
        name: String,
        location: String,
        origin: CLLocationCoordinate2D,
        pars: [Int],
        strokeIndexes: [Int],
        yards: [Int]
    ) -> CatalogCourse {
        let metersPerDegreeLat = 111_111.0
        let metersPerDegreeLon = metersPerDegreeLat * cos(origin.latitude * .pi / 180)

        var holes: [CatalogHole] = []
        var cursor = origin
        for index in 0..<pars.count {
            let lengthMeters = Double(yards[index]) * 0.9144
            // Alternate directions to snake the routing: E, N, W, N, …
            let dEast = [1.0, 0.0, -1.0, 0.0][index % 4] * lengthMeters
            let dNorth = [0.0, 1.0, 0.0, 1.0][index % 4] * lengthMeters

            let tee = cursor
            let green = CLLocationCoordinate2D(
                latitude: tee.latitude + dNorth / metersPerDegreeLat,
                longitude: tee.longitude + dEast / metersPerDegreeLon
            )
            // Front/back ±14 m along the approach line.
            let approachLength = max(lengthMeters, 1)
            let unitNorth = dNorth / approachLength
            let unitEast = dEast / approachLength
            func offset(_ meters: Double) -> CLLocationCoordinate2D {
                CLLocationCoordinate2D(
                    latitude: green.latitude + unitNorth * meters / metersPerDegreeLat,
                    longitude: green.longitude + unitEast * meters / metersPerDegreeLon
                )
            }
            let front = offset(-14)
            let back = offset(14)

            holes.append(CatalogHole(
                number: index + 1,
                par: pars[index],
                strokeIndex: strokeIndexes[index],
                yards: yards[index],
                greenFrontLat: front.latitude, greenFrontLon: front.longitude,
                greenCenterLat: green.latitude, greenCenterLon: green.longitude,
                greenBackLat: back.latitude, greenBackLon: back.longitude,
                teeLat: tee.latitude, teeLon: tee.longitude
            ))

            // Next tee: 30 m past this green.
            cursor = CLLocationCoordinate2D(
                latitude: green.latitude + unitNorth * 30 / metersPerDegreeLat,
                longitude: green.longitude + unitEast * 30 / metersPerDegreeLon
            )
        }

        return CatalogCourse(id: id, name: name, location: location, holes: holes)
    }
}

// MARK: - Course persistence helpers

extension CatalogCourse {
    /// Frozen copy stored on the round.
    func encoded() throws -> Data {
        try JSONEncoder().encode(self)
    }

    static func decode(_ data: Data) -> CatalogCourse? {
        try? JSONDecoder().decode(CatalogCourse.self, from: data)
    }
}
