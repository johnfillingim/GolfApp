import XCTest
@testable import Scoring

final class BetSummaryTests: XCTestCase {

    private let players = [Fixtures.jack(), Fixtures.jill(), Fixtures.bob(), Fixtures.sue()]

    func testNassauSummary() {
        let bet = Bet(name: "Nassau", kind: .nassau(NassauConfig(
            sideA: [Fixtures.jackID],
            sideB: [Fixtures.jillID],
            stakePerPlayer: .dollars(5),
            handicapMode: .net,
            allowance: .offLow,
            autoPressTrigger: 2
        )))
        let text = BetSummary.describe(bet, players: players)
        XCTAssertTrue(text.contains("$5.00 Nassau"), text)
        XCTAssertTrue(text.contains("Jack Palmer vs Jill Hogan"), text)
        XCTAssertTrue(text.contains("Auto-press when a side goes 2 down"), text)
        XCTAssertTrue(text.contains("off the low ball"), text)
    }

    func testSkinsSummary() {
        let bet = Bet(name: "Skins", kind: .skins(SkinsConfig(
            players: players.map(\.id),
            stakePerHole: .dollars(2),
            handicapMode: .gross,
            carryover: true,
            requireValidation: true
        )))
        let text = BetSummary.describe(bet, players: players)
        XCTAssertTrue(text.contains("$2.00 skins"), text)
        XCTAssertTrue(text.contains("Ties carry over"), text)
        XCTAssertTrue(text.contains("par or better"), text)
    }

    func testWolfSummary() {
        let bet = Bet(name: "Wolf", kind: .wolf(WolfConfig(
            rotation: players.map(\.id),
            stakePerHole: .dollars(1),
            handicapMode: .net
        )))
        let text = BetSummary.describe(bet, players: players)
        XCTAssertTrue(text.contains("Lone wolf 2×"), text)
        XCTAssertTrue(text.contains("blind wolf 3×"), text)
        XCTAssertTrue(text.contains("push"), text)
    }

    func testStrokePlaySummary() {
        let bet = Bet(name: "Medal", kind: .strokePlay(StrokePlayConfig(
            players: players.map(\.id),
            ante: .dollars(10),
            handicapMode: .net
        )))
        let text = BetSummary.describe(bet, players: players)
        XCTAssertTrue(text.contains("$40.00 pot"), text)
        XCTAssertTrue(text.contains("ties split"), text)
    }
}
