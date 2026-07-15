# Birdie 🐦

A dark-themed, delightfully animated iPhone app for running your golf group's
side bets — Nassau, skins, match play, Wolf, stroke-play pots. Everyone scores
on their own phone; standings and running money update live; the app settles
the round to a minimal "who pays whom" at the end.

**Birdie is not a sportsbook.** It never holds, transfers, or processes money —
it tracks bets and computes debts. Groups settle in cash or their payment app,
exactly like they do today with a pencil and a napkin (App Store guideline 5.3:
no wagering functionality, no consideration handled by the app).

## Layout

```
Birdie.xcworkspace          ← open this
├── Birdie.xcodeproj        iOS app (SwiftUI, SwiftData, iOS 17+)
│   └── Birdie/             app sources (synchronized folder)
└── Packages/Scoring        pure Swift package: ALL betting math + tests
```

| Layer | What lives there |
|---|---|
| `Packages/Scoring` | Bet engines (Nassau/presses, skins/carryovers, match play, Wolf, stroke play), handicap allocation, settlement minimization, LWW merge logic, milestone/streak detection. Zero UI/persistence imports; runs on Linux CI. |
| `Birdie/Models` | SwiftData schema, bundled demo courses (with GPS geometry), bridges to `Scoring` types |
| `Birdie/Services` | `SyncService` protocol + CloudKit (CKSyncEngine) & local implementations, Sign in with Apple, CoreLocation, CoreHaptics, sound |
| `Birdie/ViewModels` | `RoundSession` — the live-round pipeline (edit → recompute → celebrate → sync) |
| `Birdie/Views` | Setup wizard, live scorecard, standings, GPS/shots, settle-up, history |
| `Birdie/Theme` | Every color/space/type/motion token, shared components |

## Getting started

1. **Requirements**: Xcode 16+, iOS 17+ deployment target.
2. Open `Birdie.xcworkspace`.
3. Select the *Birdie* target → Signing & Capabilities → pick your team.
   The bundle ID is `com.example.birdie` — change it to yours.
4. Run. Everything works immediately on simulator or device in **local-only
   mode**: full scoring, all bets, celebrations, settlement. No account needed.

### Enabling live multi-phone sync (CloudKit)

Sharing rides on CloudKit (see `ARCHITECTURE.md` for the CloudKit-vs-Firebase
call). To turn it on:

1. With your team selected, Xcode auto-provisions the iCloud container from
   `Birdie/Birdie.entitlements` (`iCloud.$(CFBundleIdentifier)`), plus push
   notifications used by CKSyncEngine.
2. Run on a device signed into iCloud. The Settings tab shows "iCloud" as the
   sync state.
3. In a live round, tap the invite button (top right) and send the link.
   Buddies who open it get the round via CloudKit sharing; their scores merge
   live (deterministic last-write-wins per player-per-hole — see
   `Scoring/RoundMerge.swift`).

No iCloud account → the app silently uses `LocalSyncService` and stays fully
usable on one phone.

> ⚠️ CloudKit sharing needs real devices + a provisioned container to
> exercise; it cannot run in this repo's CI. The merge semantics it relies on
> are unit-tested in the Scoring package (`RoundMergeTests`).

## Running the tests

The betting math — the part that must be exactly right — is a pure package:

```bash
swift test --package-path Packages/Scoring     # macOS or Linux
```

or select the `Scoring` scheme in Xcode (⌘U). CI (`.github/workflows/
scoring-tests.yml`) runs the suite on every push in a Linux Swift container:
69 tests covering worked examples like a full 18-hole Nassau with an
auto-press cascade, carryover skins chains, lone-wolf multipliers, dormie/
auto-close, settlement minimization, and merge determinism.

## What's demo / needs a decision

- **Courses**: three bundled demo courses with fabricated GPS geometry
  (`CourseCatalog.swift`). The `CatalogCourse` Codable shape is the ingestion
  contract for a real course API.
- **Handicaps**: playing handicap = rounded index (half for 9 holes). Proper
  slope/rating course handicaps need course data we don't have yet.
- **Sound assets**: `SoundPlayer` looks for short `.caf` files
  (`chime-birdie`, `chime-eagle`, `fanfare-ace`, `money-win`, `tick`); ship
  without them and the app is simply quiet.
- **App icon**: placeholder slot in `Assets.xcassets`.
- **Group directory**: groups + join codes are local rosters today; a tiny
  directory service (or CloudKit public DB) would make codes work across
  devices. Round sharing itself already works via CKShare links.

See `ARCHITECTURE.md` for the full decision log and open questions.
