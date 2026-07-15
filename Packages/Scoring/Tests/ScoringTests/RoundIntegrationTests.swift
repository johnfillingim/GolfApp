import XCTest
@testable import Scoring

/// End-to-end: several bets on one round, consolidated into a single
/// who-pays-whom settlement.
final class RoundIntegrationTests: XCTestCase {

    func testMultiBetRoundSettlesToMinimalTransfers() {
        let players = [Fixtures.jack(), Fixtures.jill()]
        // Cards from the Nassau worked example: front to Jill, back and total
        // to Jack, one auto-press each way → Jack +$10 on the Nassau.
        let jackCard: [Int?] = [5, 5, 3, 5, 4, 4, 4, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4].optional
        let jillCard: [Int?] = [4, 4, 3, 4, 5, 4, 4, 5, 4, 5, 4, 5, 5, 4, 5, 3, 4, 4].optional

        let nassau = Bet(name: "Nassau", kind: .nassau(NassauConfig(
            sideA: [Fixtures.jackID],
            sideB: [Fixtures.jillID],
            stakePerPlayer: .dollars(5),
            handicapMode: .gross,
            autoPressTrigger: 2
        )))
        let skins = Bet(name: "Skins", kind: .skins(SkinsConfig(
            players: [Fixtures.jackID, Fixtures.jillID],
            stakePerHole: .dollars(2),
            handicapMode: .gross,
            carryover: false
        )))

        let snapshot = Fixtures.snapshot(
            players: players,
            scores: [Fixtures.jackID: jackCard, Fixtures.jillID: jillCard]
        )

        let evals = BetEvaluator.evaluateAll([nassau, skins], snapshot: snapshot)

        // Skins (no carryover): Jill wins holes 1, 2, 4 ($2 each = $6);
        // Jack wins holes 5, 10, 11, 13 ($8). Net skins: Jack +$2.
        let skinsEval = evals[1]
        XCTAssertEqual(skinsEval.settled[Fixtures.jackID], .dollars(2))

        let net = Settlement.netBalances(evals.map(\.settled))
        XCTAssertEqual(net[Fixtures.jackID], .dollars(12))
        XCTAssertEqual(net[Fixtures.jillID], .dollars(-12))

        let transfers = Settlement.minimalTransfers(
            balances: net,
            playerOrder: players.map(\.id)
        )
        XCTAssertEqual(transfers, [
            Transfer(from: Fixtures.jillID, to: Fixtures.jackID, amount: .dollars(12)),
        ])
    }

    /// Every engine keeps its books balanced on a messy round: withdrawals,
    /// missing scores, and mid-round state all at once.
    func testZeroSumHoldsUnderChaos() {
        let players = [Fixtures.jack(2), Fixtures.jill(9), Fixtures.bob(14), Fixtures.sue(21)]
        let bets: [Bet] = [
            Bet(name: "N", kind: .nassau(NassauConfig(
                sideA: [Fixtures.jackID, Fixtures.bobID],
                sideB: [Fixtures.jillID, Fixtures.sueID],
                stakePerPlayer: .dollars(5), handicapMode: .net, autoPressTrigger: 2
            ))),
            Bet(name: "S", kind: .skins(SkinsConfig(
                players: players.map(\.id), stakePerHole: .dollars(1), handicapMode: .net
            ))),
            Bet(name: "M", kind: .matchPlay(MatchPlayConfig(
                sideA: [Fixtures.jackID], sideB: [Fixtures.bobID],
                stakePerPlayer: .dollars(10), handicapMode: .net
            ))),
            Bet(name: "P", kind: .strokePlay(StrokePlayConfig(
                players: players.map(\.id), ante: .dollars(5), handicapMode: .net
            ))),
        ]

        // Scores with gaps; Sue withdraws after hole 6.
        var scores: [PlayerID: [Int?]] = [:]
        let cards: [[Int?]] = [
            [4, 5, 3, 4, 5, 4, 3, 6, 4, 4, 3, nil, 4, 5, 5, 3, 4, 4],
            [5, 6, 4, 5, 5, 5, 4, 6, 5, 5, nil, 6, 5, 5, 6, 4, 5, 5],
            [6, 6, 4, 5, 6, 5, 4, 7, 5, 5, 4, 6, 5, 6, 6, 4, 5, 6],
            [6, 7, 5, 6, 6, 6, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil],
        ]
        for (index, player) in players.enumerated() {
            scores[player.id] = cards[index]
        }

        let snapshot = Fixtures.snapshot(
            players: players,
            scores: scores,
            withdrawals: [Fixtures.sueID: 6]
        )

        for eval in BetEvaluator.evaluateAll(bets, snapshot: snapshot) {
            XCTAssertEqual(eval.settled.totalCents, 0, "\(eval.kindName) settled leaks money")
            XCTAssertEqual(eval.projected.totalCents, 0, "\(eval.kindName) projected leaks money")
        }
    }
}
