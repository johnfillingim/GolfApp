// swift-tools-version:5.9
import PackageDescription

// Scoring is a pure Swift package: no UIKit/SwiftUI, no SwiftData, no CloudKit.
// Every dollar of betting math in the app lives here so it can be unit-tested
// in isolation (it even runs on Linux CI).
let package = Package(
    name: "Scoring",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "Scoring", targets: ["Scoring"]),
    ],
    targets: [
        .target(name: "Scoring"),
        .testTarget(name: "ScoringTests", dependencies: ["Scoring"]),
    ]
)
