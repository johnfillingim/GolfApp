# Birdie — Architecture & Decision Log

## The product in one paragraph

A group of golfers configures side bets on a round (Nassau, skins, match
play, Wolf, stroke-play pot), everyone enters their own scores hole by hole,
every phone shows live standings and running money for every bet, great
moments trigger tiered celebrations, and the round ends in a minimal
who-pays-whom settlement. Offline-first; sync is an enhancement, never a
gate. No real money ever moves through the app.

## Module boundaries

```
┌────────────────────────────  Birdie app  ───────────────────────────┐
│  Views (SwiftUI) ── RoundSession ── SnapshotBuilder ── SwiftData    │
│        │                  │                                         │
│  CelebrationEngine   SyncService  ◄── protocol; two implementations │
│  (haptics/sound/     ├─ LocalSyncService (always available)         │
│   confetti overlay)  └─ CloudKitSyncService (CKSyncEngine + CKShare)│
└─────────────────────────────────────────────────────────────────────┘
                       depends on ▼ (one direction only)
┌──────────────────────  Packages/Scoring (pure)  ────────────────────┐
│  Bet configs · engines · handicapping · MatchEngine · settlement    │
│  RoundMerge (LWW) · milestones · plain-English summaries            │
└─────────────────────────────────────────────────────────────────────┘
```

**Rule: money math never touches UI or persistence.** `Scoring` imports
Foundation only, so the entire rules layer is testable on any platform (CI
runs it on Linux) and portable to watchOS/widgets later.

The app's one data flow (see `RoundSession`):

1. every edit writes SwiftData (single source of truth),
2. rebuild `RoundSnapshot` → `BetEvaluator.evaluateAll` (pure),
3. new milestone/event IDs → `CelebrationEngine`,
4. changeset → `SyncService` (fire-and-forget).

Remote changes enter through the same door: merge into SwiftData, recompute.
A synced birdie celebrates exactly like a local one.

## Decision log

### Sync backend: CloudKit (over Firebase Firestore)

| | CloudKit | Firestore |
|---|---|---|
| Backend to run/pay for | none | project, billing, rules |
| Invite flow | native `CKShare` links | custom auth + deep links |
| Accounts | users already have iCloud | needs sign-in system |
| Real-time latency | good-enough (push-driven) | excellent listeners |
| Cross-platform later | Apple-only | easy Android path |
| Offline outbox | CKSyncEngine (iOS 17) built-in | SDK built-in |

For a v1 whose whole audience holds iPhones on a golf course, zero backend
and native share links beat Firestore's nicer listeners. The risk that we
want Android later is hedged the only way that matters: **everything above
`SyncService` speaks `RoundChangeSet`**, and the merge rules live in the
Scoring package, not in the transport. A Firestore adapter is a new file,
not a rewrite.

### Conflict resolution: LWW per (player, hole) + append-only events

- **Score cells** merge last-write-wins keyed by `(updatedAt, editorID,
  content)` — a total order, so merge is commutative/associative and every
  device converges (`RoundMergeTests`). LWW is right here because score entry
  is naturally single-writer (you type your own score); the only real
  conflict is "buddy marked my card, I corrected it," and "latest touch
  wins" is exactly what players expect.
- **Presses and Wolf picks** are append-only facts with identity → grow-only
  set union, conflict-free by construction.
- **Auto-presses are derived, not stored.** They're a pure function of the
  scorecard, so devices can't disagree about them and they need no sync.
- **Withdrawals** merge to the earliest hole.

### Animation: native SwiftUI now, Rive-shaped seam for later

Recommendation between the two named options: **Rive** — celebrations here
are *state-driven* (tier, mine-vs-buddy, money amount) and Rive's state
machines map to that directly, where Lottie is a fire-and-forget clip player.
But v1 ships **zero animation dependencies**: the confetti/banner system is
Canvas + TimelineView + springs (`CelebrationOverlay.swift`), because there
are no designer assets yet and a parametric particle system already hits the
"Duolingo-punchy" bar. The seam is honest: `CelebrationEngine` decides *what
and how much*, the overlay only renders — swapping in `RiveView` per tier
touches one file. Revisit when there's a motion designer producing `.riv`
files.

### Money: integer cents, zero-sum by construction

All amounts are `Money` (Int cents). Every engine builds balances from
symmetric transfer helpers, and `BetEvaluator` asserts each bet's settled and
projected maps sum to zero. Splits (`Money.split`) distribute odd cents
deterministically by tee order so every phone shows identical numbers.

### Two money views: settled vs projected

`settled` = mathematically final (closed-out match, awarded skin); can never
go backward. `projected` = settled + open components at current leaders. The
standings lead with projected; settle-up pays only settled. This is the
difference between "you're up $23 right now" and "you are owed $15."

### Handicaps

Playing handicap = rounded index (9-hole rounds use half), allocated by
stroke-index **rank within the holes actually played** (a back-nine-only
round allocates sensibly). Match formats default to the USGA convention of
playing off the low ball; skins/wolf/pots use full allowance. Slope/rating
math is deliberately out until real course data exists.

### Bets are immutable; mid-round entry via new bets

Editing a live bet's stake retroactively corrupts settled results, so bets
are add-only. Late joiners (and mid-round side action) use `firstHole` on the
hole-based formats. Withdrawals: match formats concede remaining holes,
skins/wolf drop the player from later pots, stroke play forfeits the ante.

### Nassau press semantics (the one genuinely contested rule)

Manual presses: anytime, by event. Auto-press ("2-down automatic"): the
engine watches the **most recently opened bet** per nine and opens a press
when it goes exactly 2 down with holes left — the classic cascade without
press explosions, and the same convention the popular scoring apps use.
Auto-presses ride the nines only (the overall-18 presses manually). All of
this is worked-example-tested in `NassauTests`.

## Data model (SwiftData)

`PlayerProfile` (me + buddies) · `BuddyGroup` · `Round` (frozen course card,
events blob, withdrawals blob, share anchor) · `RoundPlayer` (**its UUID is
the scoring `PlayerID`**; snapshots name/handicap at round time) ·
`HoleScoreModel` (the LWW cell: strokes/putts/FIR/GIR + `updatedAt`,
`editorID`) · `BetModel` (opaque Codable `BetKind` payload) · `ShotModel`
(GPS pins; pure garnish) · `SettlementMark` (paid/unpaid per transfer ID).

CloudKit record mapping (zone per round, shared via one zone-wide CKShare):
`seed` (course/players/bets), `events`, `withdrawals`, `cell|player|hole`.
Conflicts resolve with the same RoundMerge rules the tests cover.

## Celebrations

Deterministic inputs (stable-ID `Milestone`s and `ScoringEvent`s from the
Scoring layer) → fired-ID set per round (persisted) → tier queue (highest
first) → overlay + CoreHaptics signature per tier + optional `.ambient`
sounds. Never blocks touch below; tap to skip; Reduce Motion drops particles
for fades; joining a round with history is silent (`suppressExisting`).
Tiers: toast (buddy's minor moment) → minor (press) → medium (your birdie,
skin) → major (eagle, lone wolf, closed match) → jackpot (ace/albatross,
full-screen gold).

## Testing strategy

All correctness risk is concentrated in `Packages/Scoring`, and that's where
the tests are: 69 cases of hand-computed worked examples (full Nassau with
auto-press cascade and manual press, carryover chains with freeze/release,
validation skins, wolf multipliers/carries/withdrawn-wolf, dormie and "3&2"
closures, pot splits with odd cents, ≤ n−1 settlement, merge
commutativity, streak detection). CI runs them on every push. UI is kept
deliberately thin over the pure layer; UI tests are a later investment.

## Open questions for the product owner

1. **Skins "validation"** is implemented as *winning score must be net par or
   better* (self-contained per hole). Some groups instead require winning the
   *next* hole to validate. Config flag exists — which default do you want?
2. **Nassau team stakes** are per man (each loser pays $X). Some groups play
   per team. Worth a config toggle?
3. **Wolf with 3 or 5+ players** works (pairwise transfers stay zero-sum);
   the "last-place picks rotation on 17/18" house rule is not implemented.
4. **Guideline 5.3 posture**: fully on the right side (no money handling),
   but consider copy review of "bets/stakes" language before submission if
   you want extra margin.
5. **Group join codes** need a directory service to work across devices —
   CloudKit public database would do it for free. Priority?
