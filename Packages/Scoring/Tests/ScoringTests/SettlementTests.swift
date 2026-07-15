import XCTest
@testable import Scoring

final class SettlementTests: XCTestCase {

    func testNetBalancesSumsAcrossBets() {
        let net = Settlement.netBalances([
            [Fixtures.jackID: .dollars(5)],
            [Fixtures.jackID: .dollars(-2), Fixtures.jillID: .dollars(2)],
            [Fixtures.jillID: .dollars(-5)],
        ])
        XCTAssertEqual(net[Fixtures.jackID], .dollars(3))
        XCTAssertEqual(net[Fixtures.jillID], .dollars(-3))
    }

    func testGreedyConsolidation() {
        let transfers = Settlement.minimalTransfers(balances: [
            Fixtures.jackID: .dollars(20),
            Fixtures.jillID: .dollars(-5),
            Fixtures.bobID: .dollars(-15),
        ])
        // Largest debtor pays first: Bob $15 → Jack, then Jill $5 → Jack.
        XCTAssertEqual(transfers, [
            Transfer(from: Fixtures.bobID, to: Fixtures.jackID, amount: .dollars(15)),
            Transfer(from: Fixtures.jillID, to: Fixtures.jackID, amount: .dollars(5)),
        ])
    }

    func testTransactionCountStaysUnderPlayerCount() {
        let transfers = Settlement.minimalTransfers(balances: [
            Fixtures.jackID: .dollars(10),
            Fixtures.jillID: .dollars(10),
            Fixtures.bobID: .dollars(-10),
            Fixtures.sueID: .dollars(-10),
        ])
        XCTAssertEqual(transfers.count, 2)
        // Conservation: total paid equals total received.
        let paid = transfers.reduce(Money.zero) { $0 + $1.amount }
        XCTAssertEqual(paid, .dollars(20))
    }

    func testDeterministicTieBreakByPlayerOrder() {
        let order = [Fixtures.jackID, Fixtures.jillID, Fixtures.bobID]
        let transfers = Settlement.minimalTransfers(
            balances: [
                Fixtures.jackID: .dollars(10),
                Fixtures.jillID: .dollars(10),
                Fixtures.bobID: .dollars(-20),
            ],
            playerOrder: order
        )
        // Jack and Jill are tied at +$10; tee order puts Jack first — always.
        XCTAssertEqual(transfers, [
            Transfer(from: Fixtures.bobID, to: Fixtures.jackID, amount: .dollars(10)),
            Transfer(from: Fixtures.bobID, to: Fixtures.jillID, amount: .dollars(10)),
        ])
    }

    func testZeroBalancesProduceNoTransfers() {
        XCTAssertTrue(Settlement.minimalTransfers(balances: [:]).isEmpty)
        XCTAssertTrue(Settlement.minimalTransfers(balances: [Fixtures.jackID: .zero]).isEmpty)
    }

    func testOddCentsSettleExactly() {
        // Three-way skins-like outcome that doesn't divide evenly.
        let transfers = Settlement.minimalTransfers(balances: [
            Fixtures.jackID: Money(cents: 1001),
            Fixtures.jillID: Money(cents: -500),
            Fixtures.bobID: Money(cents: -501),
        ])
        let paid = transfers.reduce(Money.zero) { $0 + $1.amount }
        XCTAssertEqual(paid, Money(cents: 1001))
        XCTAssertEqual(transfers.count, 2)
    }
}
