import Foundation

/// Nassau: three matches (front nine, back nine, overall) at one stake, plus
/// presses.
///
/// ## Press semantics
/// A press opens a brand-new match over the *remaining* holes of its segment,
/// at the segment's stake. Manual presses arrive as append-only `PressEvent`s.
///
/// Auto-pressing ("2-down automatic") follows the most common convention:
/// the app watches the **most recently opened bet** in each segment, and the
/// moment its trailing side goes exactly `autoPressTrigger` holes down with at
/// least one hole left, a new press opens on the next hole. Each new press
/// then becomes the watched bet, so a side that keeps losing generates the
/// classic press cascade — but an *old* bet drifting further down does not
/// multiply presses.
///
/// Auto-presses are derived purely from the scorecard (never stored), so all
/// devices agree on them without any sync coordination. The derivation walks
/// holes chronologically: a manual press "arrives" at its first hole, so
/// earlier auto-press triggers are unaffected by presses declared later.
///
/// ## 9-hole rounds
/// A round without both nines collapses to a single "Match" segment (one bet
/// plus presses) — front/back/total would triple-charge the same nine holes.
public enum NassauEngine {

    public static func evaluate(bet: Bet, config: NassauConfig, snapshot: RoundSnapshot) -> BetEvaluation {
        let frontHoles = snapshot.holes(in: 1...9)
        let backHoles = snapshot.holes(in: 10...18)
        let hasBothNines = !frontHoles.isEmpty && !backHoles.isEmpty

        let segments: [(NassauSegment, [Int], String)] = hasBothNines
            ? [(.front, frontHoles, "Front 9"), (.back, backHoles, "Back 9"), (.total, snapshot.holeNumbers, "Overall 18")]
            : [(.total, snapshot.holeNumbers, "Match")]

        var segmentResults: [NassauEvaluation.SegmentResult] = []
        var lines: [StandingLine] = []
        var settled: [PlayerID: Money] = [:]
        var projected: [PlayerID: Money] = [:]
        var events: [ScoringEvent] = []
        var headlineParts: [String] = []
        var pressCount = 0

        for (segment, holes, label) in segments {
            guard !holes.isEmpty else { continue }

            let outcomes = MatchEngine.rawOutcomes(
                sideA: config.sideA, sideB: config.sideB, holes: holes,
                snapshot: snapshot, mode: config.handicapMode, allowance: config.allowance
            )

            // Convention: auto-presses ride on the nines. The overall-18 bet
            // only presses manually — otherwise one bad stretch would spawn
            // parallel presses on front AND total. A 9-hole round's single
            // segment is the match, so auto-press applies there.
            let autoAllowed = !(hasBothNines && segment == .total)
            let betLines = deriveLines(
                bet: bet, config: config, segment: segment,
                holes: holes, outcomes: outcomes, snapshot: snapshot,
                autoPressAllowed: autoAllowed
            )
            pressCount += betLines.filter(\.isPress).count

            var resultLines: [NassauEvaluation.BetLine] = []
            for line in betLines {
                let lineHoles = holes.filter { $0 >= line.firstHole }
                let comp = MatchEngine.status(over: lineHoles, outcomes: outcomes)
                resultLines.append(.init(
                    label: line.label(segmentLabel: label),
                    segment: segment,
                    firstHole: line.firstHole,
                    isPress: line.isPress,
                    isAutoPress: line.isAuto,
                    match: comp
                ))

                // Money: a line pays out when it is mathematically closed or
                // every one of its holes is decided. Otherwise the current
                // leader carries it in `projected` only.
                let decided = comp.status.closed || comp.status.remaining == 0
                if decided, let winner = comp.status.winner {
                    let transfer = Transfers.perLoserStake(
                        winners: config.members(of: winner),
                        losers: config.members(of: winner.opponent),
                        stakePerLoser: config.stakePerPlayer
                    )
                    settled.add(transfer)
                    projected.add(transfer)
                } else if !decided, let leader = comp.status.leader {
                    projected.add(Transfers.perLoserStake(
                        winners: config.members(of: leader),
                        losers: config.members(of: leader.opponent),
                        stakePerLoser: config.stakePerPlayer
                    ))
                }

                // Standings row.
                let leaderSide = comp.status.winner ?? comp.status.leader
                let leaderNames = leaderSide.map { config.members(of: $0) } ?? []
                let statusText: String
                if let side = leaderSide {
                    statusText = "\(snapshot.sideName(config.members(of: side))) \(comp.status.display)"
                } else {
                    statusText = comp.status.display
                }
                lines.append(StandingLine(
                    id: "\(bet.id)-\(segment.rawValue)-\(line.firstHole)",
                    title: line.label(segmentLabel: label),
                    status: statusText,
                    leaders: leaderNames,
                    isSettled: decided
                ))

                // Events with stable IDs.
                if line.isPress {
                    events.append(ScoringEvent(
                        id: "\(bet.id)-press-\(segment.rawValue)-\(line.firstHole)",
                        kind: .pressStarted(auto: line.isAuto),
                        betID: bet.id,
                        players: config.members(of: line.pressedBy),
                        hole: line.firstHole,
                        amount: config.stakePerPlayer
                    ))
                }
                if decided, let winner = comp.status.winner, !line.isPress {
                    events.append(ScoringEvent(
                        id: "\(bet.id)-\(segment.rawValue)-final",
                        kind: .segmentDecided(segment),
                        betID: bet.id,
                        players: config.members(of: winner),
                        hole: comp.status.thruHole,
                        amount: config.stakePerPlayer * config.members(of: winner.opponent).count
                    ))
                }
            }

            segmentResults.append(.init(segment: segment, bets: resultLines))

            // Headline fragment for this segment, driven by the original bet.
            if let original = resultLines.first {
                let st = original.match.status
                let prefix: String
                switch segment {
                case .front: prefix = "F"
                case .back: prefix = "B"
                case .total: prefix = hasBothNines ? "T" : "M"
                }
                if let side = st.winner ?? st.leader {
                    let arrow = st.closed || st.remaining == 0 ? "✓" : "↑"
                    headlineParts.append("\(prefix): \(snapshot.sideName(config.members(of: side))) \(st.margin)\(arrow)")
                } else {
                    headlineParts.append("\(prefix): AS")
                }
            }
        }

        var headline = headlineParts.joined(separator: " · ")
        if pressCount > 0 {
            headline += " · \(pressCount) press\(pressCount == 1 ? "" : "es")"
        }

        return BetEvaluation(
            betID: bet.id,
            betName: bet.name,
            kindName: "Nassau",
            headline: headline,
            lines: lines,
            settled: settled,
            projected: projected,
            events: events,
            detail: .nassau(NassauEvaluation(segments: segmentResults))
        )
    }

    // MARK: - Line derivation

    struct Line {
        let firstHole: Int
        let isPress: Bool
        let isAuto: Bool
        let pressedBy: MatchSide
        let manualIndex: Int?

        func label(segmentLabel: String) -> String {
            guard isPress else { return segmentLabel }
            return "Press from \(firstHole)\(isAuto ? " (auto)" : "")"
        }
    }

    /// Original bet + manual presses + derived auto-presses for one segment.
    static func deriveLines(
        bet: Bet,
        config: NassauConfig,
        segment: NassauSegment,
        holes: [Int],
        outcomes: MatchEngine.RawOutcomes,
        snapshot: RoundSnapshot,
        autoPressAllowed: Bool = true
    ) -> [Line] {
        let ordered = holes.sorted()
        guard let firstHole = ordered.first else { return [] }

        var lines: [Line] = [Line(firstHole: firstHole, isPress: false, isAuto: false, pressedBy: .a, manualIndex: nil)]

        // Manual presses for this bet+segment, validated to a pressable hole
        // (after the segment start, within the segment).
        let manuals = snapshot.events.presses
            .filter { $0.betID == bet.id && $0.segment == segment }
            .filter { press in ordered.contains(press.firstHole) && press.firstHole > firstHole }
            .sorted { ($0.firstHole, $0.id.uuidString) < ($1.firstHole, $1.id.uuidString) }
        for (index, press) in manuals.enumerated() where !lines.contains(where: { $0.firstHole == press.firstHole }) {
            lines.append(Line(firstHole: press.firstHole, isPress: true, isAuto: false, pressedBy: press.pressedBy, manualIndex: index))
        }

        if autoPressAllowed, let trigger = config.autoPressTrigger, trigger > 0 {
            deriveAutoPresses(trigger: trigger, holes: ordered, outcomes: outcomes, lines: &lines)
        }

        return lines.sorted { $0.firstHole < $1.firstHole }
    }

    /// Chronological auto-press derivation. Repeatedly scans the segment for
    /// the earliest hole where the *watched* bet (the one with the latest
    /// start at that point in play) transitions to exactly `trigger` down,
    /// and opens a press on the next hole. Every spawned press starts
    /// strictly later than the previous one, so this terminates.
    static func deriveAutoPresses(
        trigger: Int,
        holes: [Int],
        outcomes: MatchEngine.RawOutcomes,
        lines: inout [Line]
    ) {
        while true {
            var spawn: (firstHole: Int, pressedBy: MatchSide)? = nil

            scan: for (index, hole) in holes.enumerated() {
                guard outcomes.byHole[hole] != nil else { continue }

                // The bet being watched while this hole is played.
                let started = lines.filter { $0.firstHole <= hole }
                guard let watched = started.max(by: { $0.firstHole < $1.firstHole }) else { continue }

                // Timeline of the watched bet (its own closure applies).
                let comp = MatchEngine.status(over: holes.filter { $0 >= watched.firstHole }, outcomes: outcomes)
                guard let result = comp.holeResults.first(where: { $0.hole == hole }) else { continue }

                let before = comp.holeResults.last(where: { $0.hole < hole })?.upAAfter ?? 0
                let transitioned = abs(result.upAAfter) == trigger && abs(before) < trigger
                guard transitioned else { continue }

                // Press opens on the next hole of the segment, if any, and
                // only if no bet already starts there.
                guard index + 1 < holes.count else { continue }
                let next = holes[index + 1]
                guard !lines.contains(where: { $0.firstHole == next }) else { continue }

                // The pressing side is the one that is down.
                spawn = (next, result.upAAfter < 0 ? .a : .b)
                break scan
            }

            guard let found = spawn else { break }
            lines.append(Line(firstHole: found.firstHole, isPress: true, isAuto: true, pressedBy: found.pressedBy, manualIndex: nil))
        }
    }
}
