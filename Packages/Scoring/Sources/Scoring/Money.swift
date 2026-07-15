import Foundation

/// An exact currency amount stored as integer cents.
///
/// Betting math must never accumulate floating-point error, so `Money` is a
/// thin wrapper over `Int`. All bet engines produce zero-sum dictionaries of
/// `Money` — the invariant "everything won was lost by someone" is asserted
/// centrally in `BetEvaluator`.
public struct Money: Hashable, Codable, Sendable, Comparable, AdditiveArithmetic, CustomStringConvertible {
    public var cents: Int

    public init(cents: Int) {
        self.cents = cents
    }

    /// Convenience for whole-dollar stakes ("a $5 Nassau").
    public static func dollars(_ dollars: Int) -> Money {
        Money(cents: dollars * 100)
    }

    public static let zero = Money(cents: 0)

    public var isZero: Bool { cents == 0 }
    public var isPositive: Bool { cents > 0 }
    public var isNegative: Bool { cents < 0 }

    // MARK: Arithmetic

    public static func + (lhs: Money, rhs: Money) -> Money { Money(cents: lhs.cents + rhs.cents) }
    public static func - (lhs: Money, rhs: Money) -> Money { Money(cents: lhs.cents - rhs.cents) }
    public static func * (lhs: Money, rhs: Int) -> Money { Money(cents: lhs.cents * rhs) }
    public static func * (lhs: Int, rhs: Money) -> Money { Money(cents: lhs * rhs.cents) }
    public static prefix func - (value: Money) -> Money { Money(cents: -value.cents) }

    public static func < (lhs: Money, rhs: Money) -> Bool { lhs.cents < rhs.cents }

    /// Splits `total` into `ways` shares that sum *exactly* to `total`.
    /// Remainder cents go to the earliest shares, which keeps splits
    /// deterministic across devices (callers pass a stable participant order).
    public static func split(_ total: Money, ways: Int) -> [Money] {
        precondition(ways > 0, "Cannot split money zero ways")
        let base = total.cents / ways
        var remainder = total.cents - base * ways
        // Integer division truncates toward zero, so for negative totals the
        // remainder is negative too; distributing it one cent at a time keeps
        // the exact-sum property in both directions.
        let step = remainder >= 0 ? 1 : -1
        return (0..<ways).map { _ in
            var share = base
            if remainder != 0 {
                share += step
                remainder -= step
            }
            return Money(cents: share)
        }
    }

    // MARK: Display

    /// Plain "$4.50" / "-$4.50" rendering. UI-facing formatting (locale,
    /// currency symbol) belongs in the app layer; this is for logs and tests.
    public var description: String {
        let sign = cents < 0 ? "-" : ""
        let absCents = abs(cents)
        return String(format: "%@$%d.%02d", sign, absCents / 100, absCents % 100)
    }
}

extension Dictionary where Value == Money {
    /// Adds `amount` to `key`, treating a missing key as zero.
    /// The building block for balance dictionaries.
    public mutating func add(_ amount: Money, to key: Key) {
        self[key, default: .zero] += amount
    }

    /// Sum of all values — engines assert this is zero for every balance map.
    public var totalCents: Int {
        values.reduce(0) { $0 + $1.cents }
    }

    /// Merges another balance map into this one by addition.
    public mutating func add(_ other: [Key: Money]) {
        for (key, value) in other {
            add(value, to: key)
        }
    }
}
