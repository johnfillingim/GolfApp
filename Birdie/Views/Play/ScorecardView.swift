import SwiftUI
import Scoring

/// Per-hole score entry: one hole per page, your score front and center
/// with giant steppers, buddies' live scores below, optional putts/FIR/GIR,
/// wolf declarations and presses inline. Built to be operated with one
/// thumb while walking off a green.
struct ScorecardView: View {
    @Bindable var session: RoundSession
    @Environment(AppEnvironment.self) private var env

    @State private var showWolfSheet = false
    @State private var showPressSheet = false

    var body: some View {
        VStack(spacing: 0) {
            holePicker

            TabView(selection: $session.currentHole) {
                ForEach(session.snapshot.holeNumbers, id: \.self) { hole in
                    HoleEntryPage(
                        session: session,
                        hole: hole,
                        onWolf: { showWolfSheet = true },
                        onPress: { showPressSheet = true }
                    )
                    .tag(hole)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(Theme.Motion.standard, value: session.currentHole)
        }
        .background(Theme.Colors.background)
        .sheet(isPresented: $showWolfSheet) {
            WolfDecisionSheet(session: session, hole: session.currentHole)
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showPressSheet) {
            PressSheet(session: session, hole: session.currentHole)
                .presentationDetents([.medium])
        }
    }

    /// Horizontal hole strip — jump anywhere, see what's scored at a glance.
    private var holePicker: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.xs) {
                    ForEach(session.snapshot.holeNumbers, id: \.self) { hole in
                        let mine = session.myPlayerID.flatMap { session.strokes(for: $0, hole: hole) }
                        let isCurrent = hole == session.currentHole
                        Button {
                            session.currentHole = hole
                        } label: {
                            VStack(spacing: 1) {
                                Text("\(hole)")
                                    .font(Theme.Typo.grid)
                                Circle()
                                    .fill(mine != nil ? Theme.Colors.money : Theme.Colors.stroke)
                                    .frame(width: 5, height: 5)
                            }
                            .frame(width: 40, height: 44)
                            .background(isCurrent ? Theme.Colors.fairway : Theme.Colors.surface)
                            .foregroundStyle(isCurrent ? Theme.Colors.textOnAccent : Theme.Colors.textPrimary)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip))
                        }
                        .id(hole)
                        .accessibilityLabel("Hole \(hole)\(mine != nil ? ", scored" : "")")
                    }
                }
                .padding(.horizontal, Theme.Spacing.m)
                .padding(.vertical, Theme.Spacing.s)
            }
            .onChange(of: session.currentHole) { _, hole in
                withAnimation(Theme.Motion.snappy) { proxy.scrollTo(hole, anchor: .center) }
            }
        }
    }
}

// MARK: - One hole's entry page

private struct HoleEntryPage: View {
    @Bindable var session: RoundSession
    @Environment(AppEnvironment.self) private var env

    let hole: Int
    let onWolf: () -> Void
    let onPress: () -> Void

    private var holeInfo: HoleInfo? {
        session.snapshot.course.hole(hole)
    }

    private var catalogHole: CatalogHole? {
        CatalogCourse.decode(session.round.courseData)?.hole(hole)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Spacing.m) {
                holeHeader

                if let (bet, wolf) = session.pendingWolfDecision(hole: hole) {
                    wolfPrompt(bet: bet, wolf: wolf)
                }

                if let myID = session.myPlayerID {
                    myScoreCard(myID: myID)
                } else {
                    Card {
                        Text("You're scorekeeping — tap any player below to enter their score.")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }

                buddiesCard

                if hasNassau {
                    Button {
                        onPress()
                    } label: {
                        Label("Press", systemImage: "arrow.up.right.circle.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle(prominent: false))
                }
            }
            .padding(Theme.Spacing.m)
            .padding(.bottom, Theme.Spacing.xl)
        }
    }

    private var hasNassau: Bool {
        session.bets.contains { if case .nassau = $0.kind { return true } else { return false } }
    }

    // MARK: Header

    private var holeHeader: some View {
        Card(raised: true) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Hole \(hole)")
                        .font(Theme.Typo.display)
                        .foregroundStyle(Theme.Colors.textPrimary)
                    if let holeInfo {
                        Text("Par \(holeInfo.par) · SI \(holeInfo.strokeIndex)\(holeInfo.yardage.map { " · \($0) yds" } ?? "")")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                }
                Spacer()
                distances
            }
        }
    }

    /// Live GPS distances to the green; falls back to card yardage text
    /// when location is denied or unavailable.
    @ViewBuilder
    private var distances: some View {
        if env.location.availability == .authorized,
           let catalogHole,
           let center = env.location.yards(to: catalogHole.greenCenter) {
            HStack(spacing: Theme.Spacing.m) {
                distanceStat(label: "F", value: env.location.yards(to: catalogHole.greenFront))
                VStack(spacing: 0) {
                    Text("\(center)")
                        .font(Theme.Typo.moneyLarge)
                        .foregroundStyle(Theme.Colors.money)
                        .contentTransition(.numericText())
                    Text("CENTER")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.textSecondary)
                }
                distanceStat(label: "B", value: env.location.yards(to: catalogHole.greenBack))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Distance to green: \(center) yards to the center")
        } else if env.location.availability == .denied {
            VStack(alignment: .trailing, spacing: 2) {
                Text("GPS off")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.neutral)
                Text("card yardage shown")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
            }
        }
    }

    private func distanceStat(label: String, value: Int?) -> some View {
        VStack(spacing: 0) {
            Text(value.map(String.init) ?? "–")
                .font(Theme.Typo.money)
                .foregroundStyle(Theme.Colors.textPrimary)
            Text(label)
                .font(Theme.Typo.caption)
                .foregroundStyle(Theme.Colors.textSecondary)
        }
    }

    // MARK: Wolf prompt

    private func wolfPrompt(bet: Bet, wolf: ScoringPlayer) -> some View {
        Button {
            onWolf()
        } label: {
            Card(raised: true) {
                HStack {
                    Text("🐺")
                        .font(.system(size: 32))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(wolf.id == session.myPlayerID ? "You're the wolf!" : "\(wolf.name) is the wolf")
                            .font(Theme.Typo.headline)
                            .foregroundStyle(Theme.Colors.textPrimary)
                        Text("Pick a partner after tee shots — or go it alone")
                            .font(Theme.Typo.caption)
                            .foregroundStyle(Theme.Colors.textSecondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .foregroundStyle(Theme.Colors.money)
                }
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: My score

    private func myScoreCard(myID: PlayerID) -> some View {
        Card {
            VStack(spacing: Theme.Spacing.m) {
                BigStepper(
                    value: session.strokes(for: myID, hole: hole),
                    par: holeInfo?.par ?? 4
                ) { delta in
                    session.adjustStrokes(player: myID, hole: hole, delta: delta)
                }

                extrasRow(playerID: myID)
            }
        }
    }

    /// Putts / fairway / GIR — optional, collapsed into one compact row.
    private func extrasRow(playerID: PlayerID) -> some View {
        let cell = session.scoreCell(player: playerID, hole: hole)
        return HStack(spacing: Theme.Spacing.m) {
            // Putts stepper.
            HStack(spacing: Theme.Spacing.xs) {
                Text("Putts")
                    .font(Theme.Typo.caption)
                    .foregroundStyle(Theme.Colors.textSecondary)
                Button("−") { session.setPutts(max(0, (cell?.putts ?? 2) - 1), player: playerID, hole: hole) }
                    .frame(width: 34, height: 34)
                    .background(Theme.Colors.surfaceRaised)
                    .clipShape(Circle())
                Text(cell?.putts.map(String.init) ?? "–")
                    .font(Theme.Typo.grid)
                    .frame(minWidth: 18)
                Button("+") { session.setPutts((cell?.putts ?? 1) + 1, player: playerID, hole: hole) }
                    .frame(width: 34, height: 34)
                    .background(Theme.Colors.surfaceRaised)
                    .clipShape(Circle())
            }
            .foregroundStyle(Theme.Colors.textPrimary)

            Spacer()

            if holeInfo?.par ?? 4 > 3 {
                statToggle(label: "FWY", isOn: cell?.fairwayHit) { value in
                    session.setFairway(value, player: playerID, hole: hole)
                }
            }
            statToggle(label: "GIR", isOn: cell?.greenInRegulation) { value in
                session.setGIR(value, player: playerID, hole: hole)
            }
        }
    }

    private func statToggle(label: String, isOn: Bool?, action: @escaping (Bool?) -> Void) -> some View {
        Button {
            // Cycle: unset → hit → missed → unset.
            switch isOn {
            case nil: action(true)
            case true?: action(false)
            case false?: action(nil)
            }
        } label: {
            Text(label)
                .font(Theme.Typo.caption)
                .foregroundStyle(
                    isOn == true ? Theme.Colors.textOnAccent :
                    isOn == false ? Theme.Colors.down : Theme.Colors.textSecondary
                )
                .padding(.horizontal, Theme.Spacing.s + 2)
                .frame(height: 34)
                .background(isOn == true ? Theme.Colors.money : Theme.Colors.surfaceRaised)
                .clipShape(Capsule())
        }
        .accessibilityLabel("\(label) \(isOn == true ? "hit" : isOn == false ? "missed" : "not recorded")")
    }

    // MARK: Buddies

    private var buddiesCard: some View {
        Card {
            VStack(spacing: Theme.Spacing.s) {
                ForEach(session.snapshot.players.filter { $0.id != session.myPlayerID }) { player in
                    BuddyScoreRow(session: session, player: player, hole: hole, par: holeInfo?.par ?? 4)
                }
            }
        }
    }
}

// MARK: - Buddy row (live score + marker entry)

private struct BuddyScoreRow: View {
    @Bindable var session: RoundSession
    let player: ScoringPlayer
    let hole: Int
    let par: Int

    private var strokes: Int? {
        session.strokes(for: player.id, hole: hole)
    }

    private var withdrawn: Bool {
        !session.snapshot.isActive(player.id, atHole: hole)
    }

    var body: some View {
        HStack(spacing: Theme.Spacing.m) {
            PlayerAvatar(emoji: session.emoji(for: player.id), size: 38)
            VStack(alignment: .leading, spacing: 0) {
                Text(player.name)
                    .font(Theme.Typo.headline)
                    .foregroundStyle(withdrawn ? Theme.Colors.neutral : Theme.Colors.textPrimary)
                if withdrawn {
                    Text("withdrew")
                        .font(Theme.Typo.caption)
                        .foregroundStyle(Theme.Colors.neutral)
                }
            }

            Spacer()

            if withdrawn {
                EmptyView()
            } else {
                // Marker mode: anyone can key a buddy's score (last write
                // wins across phones, so a correction by the owner sticks).
                Button {
                    session.adjustStrokes(player: player.id, hole: hole, delta: -1)
                } label: {
                    Image(systemName: "minus")
                        .frame(width: 40, height: 40)
                        .background(Theme.Colors.surfaceRaised)
                        .clipShape(Circle())
                }
                .accessibilityLabel("Lower \(player.name)'s score")

                Text(strokes.map(String.init) ?? "–")
                    .font(Theme.Typo.moneyLarge)
                    .foregroundStyle(strokes.map { ScoreQuality(strokes: $0, par: par).color } ?? Theme.Colors.textSecondary)
                    .frame(minWidth: 44)
                    .contentTransition(.numericText())
                    .animation(Theme.Motion.snappy, value: strokes)

                Button {
                    session.adjustStrokes(player: player.id, hole: hole, delta: +1)
                } label: {
                    Image(systemName: "plus")
                        .frame(width: 40, height: 40)
                        .background(Theme.Colors.surfaceRaised)
                        .clipShape(Circle())
                }
                .accessibilityLabel("Raise \(player.name)'s score")
            }
        }
        .foregroundStyle(Theme.Colors.textPrimary)
        .contextMenu {
            Button(role: .destructive) {
                session.setStrokes(nil, player: player.id, hole: hole)
            } label: {
                Label("Clear score", systemImage: "eraser")
            }
            Button(role: .destructive) {
                session.withdraw(player: player.id, afterHole: hole - 1)
            } label: {
                Label("Mark withdrawn after hole \(hole - 1)", systemImage: "figure.walk.departure")
            }
        }
    }
}

// MARK: - Wolf decision sheet

private struct WolfDecisionSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: RoundSession
    let hole: Int

    var body: some View {
        NavigationStack {
            Group {
                if let (bet, wolf) = session.pendingWolfDecision(hole: hole) {
                    decisionBody(bet: bet, wolf: wolf)
                } else {
                    EmptyState(emoji: "🐺", title: "No decision needed", message: "This hole's wolf has already declared.")
                }
            }
            .background(Theme.Colors.background)
            .navigationTitle("Hole \(hole) — Wolf")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func decisionBody(bet: Bet, wolf: ScoringPlayer) -> some View {
        guard case .wolf(let config) = bet.kind else {
            return AnyView(EmptyView())
        }
        let partners = session.snapshot.players.filter {
            $0.id != wolf.id && session.snapshot.isActive($0.id, atHole: hole)
        }
        return AnyView(
            ScrollView {
                VStack(spacing: Theme.Spacing.m) {
                    Text("\(wolf.name) declares:")
                        .font(Theme.Typo.headline)
                        .foregroundStyle(Theme.Colors.textPrimary)

                    ForEach(partners) { partner in
                        Button {
                            declare(bet: bet, wolf: wolf, choice: .partner(partner.id))
                        } label: {
                            HStack {
                                PlayerAvatar(emoji: session.emoji(for: partner.id), size: 36)
                                Text("Partner with \(partner.name)")
                                    .font(Theme.Typo.headline)
                                Spacer()
                            }
                            .padding(Theme.Spacing.m)
                            .frame(maxWidth: .infinity)
                            .background(Theme.Colors.surface)
                            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card))
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        declare(bet: bet, wolf: wolf, choice: .lone)
                    } label: {
                        Label("Lone wolf — \(config.loneMultiplier)× stakes", systemImage: "flame.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle())

                    Button {
                        declare(bet: bet, wolf: wolf, choice: .blindLone)
                    } label: {
                        Label("Blind wolf (before tee shots) — \(config.blindMultiplier)×", systemImage: "eye.slash.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle(prominent: false))
                }
                .padding(Theme.Spacing.m)
            }
        )
    }

    private func declare(bet: Bet, wolf: ScoringPlayer, choice: WolfChoice) {
        session.declareWolf(betID: bet.id, hole: hole, wolf: wolf.id, choice: choice)
        dismiss()
    }
}

// MARK: - Press sheet

private struct PressSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Bindable var session: RoundSession
    let hole: Int

    private var nassauBets: [(Bet, NassauConfig)] {
        session.bets.compactMap { bet in
            if case .nassau(let config) = bet.kind { return (bet, config) }
            return nil
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.Spacing.m) {
                    Text("A press opens a fresh bet from hole \(hole) to the end of the nine, at the same stake. Traditionally declared by the side that's down.")
                        .font(Theme.Typo.body)
                        .foregroundStyle(Theme.Colors.textSecondary)

                    ForEach(nassauBets, id: \.0.id) { bet, config in
                        // A 9-hole round runs a single "match" segment; with
                        // both nines the press rides the current one.
                        let hasBothNines = !session.snapshot.holes(in: 1...9).isEmpty
                            && !session.snapshot.holes(in: 10...18).isEmpty
                        let segment: NassauSegment = hasBothNines ? (hole <= 9 ? .front : .back) : .total
                        let segmentLabel = hasBothNines ? (segment == .front ? "the front" : "the back") : "the match"
                        ForEach([MatchSide.a, MatchSide.b], id: \.self) { side in
                            Button {
                                session.declarePress(betID: bet.id, segment: segment, fromHole: hole, by: side)
                                dismiss()
                            } label: {
                                Text("\(session.snapshot.sideNamePublic(config.members(of: side))) press \(segmentLabel)")
                            }
                            .buttonStyle(PrimaryButtonStyle(prominent: side == .a))
                        }
                    }
                }
                .padding(Theme.Spacing.m)
            }
            .background(Theme.Colors.background)
            .navigationTitle("Press — hole \(hole)")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

extension RoundSnapshot {
    /// App-side mirror of the module-internal side label helper.
    func sideNamePublic(_ ids: [PlayerID]) -> String {
        switch ids.count {
        case 0: return "—"
        case 1: return shortNamePublic(ids[0])
        case 2: return "\(shortNamePublic(ids[0])) & \(shortNamePublic(ids[1]))"
        default: return "\(shortNamePublic(ids[0])) +\(ids.count - 1)"
        }
    }
}
