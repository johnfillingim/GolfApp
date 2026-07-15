import XCTest
@testable import Scoring

final class MoneyTests: XCTestCase {

    func testArithmetic() {
        XCTAssertEqual(Money.dollars(5) + Money(cents: 50), Money(cents: 550))
        XCTAssertEqual(Money.dollars(5) - Money.dollars(7), Money(cents: -200))
        XCTAssertEqual(Money.dollars(3) * 4, Money.dollars(12))
        XCTAssertEqual(-Money.dollars(2), Money(cents: -200))
        XCTAssertTrue(Money(cents: 1).isPositive)
        XCTAssertTrue(Money(cents: -1).isNegative)
    }

    func testSplitExactness() {
        // $10 three ways: 334 + 333 + 333 = 1000, extra cent to the first share.
        XCTAssertEqual(Money.split(Money.dollars(10), ways: 3).map(\.cents), [334, 333, 333])
        // Splits must always re-sum to the original total.
        XCTAssertEqual(Money.split(Money(cents: 1001), ways: 4).map(\.cents).reduce(0, +), 1001)
        // Negative totals mirror the behavior.
        XCTAssertEqual(Money.split(Money(cents: -1000), ways: 3).map(\.cents), [-334, -333, -333])
        // Splitting one way is identity.
        XCTAssertEqual(Money.split(Money(cents: 77), ways: 1), [Money(cents: 77)])
    }

    func testDescription() {
        XCTAssertEqual(Money.dollars(5).description, "$5.00")
        XCTAssertEqual(Money(cents: 250).description, "$2.50")
        XCTAssertEqual(Money(cents: -450).description, "-$4.50")
        XCTAssertEqual(Money(cents: 5).description, "$0.05")
    }

    func testBalanceDictionaryHelpers() {
        var balances: [PlayerID: Money] = [:]
        balances.add(Money.dollars(5), to: Fixtures.jackID)
        balances.add(Money.dollars(-5), to: Fixtures.jillID)
        balances.add(Money.dollars(2), to: Fixtures.jackID)
        XCTAssertEqual(balances[Fixtures.jackID], Money.dollars(7))
        XCTAssertEqual(balances.totalCents, 200)
    }
}
