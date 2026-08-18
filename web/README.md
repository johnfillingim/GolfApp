# Birdie — web

The golf-bets app as an installable web app, so it runs on a phone without a Mac
or Xcode. Same product as the SwiftUI build in `../Birdie`, same money math.

## Run it locally

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # 71 tests
npm run build      # typecheck + production bundle into dist/
```

## Put it on your phone

Pushing to `main` builds and publishes to GitHub Pages via
[`.github/workflows/web.yml`](../.github/workflows/web.yml). One-time setup:
**Settings → Pages → Source → GitHub Actions**.

The published URL is `https://<user>.github.io/GolfApp/`. Open it in Safari,
then **Share → Add to Home Screen** — it installs as a standalone app with its
own icon, and the service worker precaches everything, so it opens and runs with
no signal at all. That matters: course reception is usually terrible, and the
app never needs the network after the first load.

## What's here

```
src/scoring/     A direct port of Packages/Scoring — pure, no DOM, no storage.
                 All money math lives here. 69 worked-example tests came across
                 from the Swift XCTest suite.
src/data/        Course catalog, the stored round document, IndexedDB access.
src/state/       useRoundSession (the RoundSession port) and the celebration
                 engine.
src/views/       Home, the three-step setup wizard, live score entry, the
                 scorecard grid, standings, and settle-up.
src/components/  Shared controls and the canvas celebration overlay.
```

The one-way data flow from `ARCHITECTURE.md` is intact: an edit writes the round
document, the snapshot is rebuilt from it, `evaluateAll` runs over that, and new
milestone/event IDs feed the celebration queue. Nothing renders that wasn't
derived from persisted state.

## How this differs from the iOS app

| | iOS | Web |
|---|---|---|
| Devices | Every player's phone, live-synced | One phone, shared |
| Sync | CloudKit (`CKSyncEngine` + `CKShare`) | None — local only |
| Storage | SwiftData | IndexedDB |
| GPS hole map | MapKit view | Cut |
| Haptics | CoreHaptics per tier | None — no web API on iOS |
| Screen | Always-on while playing | Screen Wake Lock API |

**Sync** is the real difference. CloudKit has no usable web story, so scores are
entered on one device — normal for a group where one person keeps the card.
The seam for adding it back is deliberately intact: `RoundChangeSet` and the
LWW/union merge rules are ported and tested in `src/scoring/roundMerge.ts`, with
no caller. A future backend is a transport that produces and consumes
changesets, not a rewrite.

**Everything else is a faithful port**, including the parts that are easy to get
wrong: the Nassau auto-press cascade, skins carry/freeze semantics, wolf
multipliers and carries, dormie and "3&2" closures, odd-cent splits by tee
order, and the ≤ n−1 settlement.

## Testing

`src/scoring/__tests__` mirrors `Packages/Scoring/Tests` case for case — the
hand-computed expectations are the specification, and they are the only real
proof the translation preserved the money math.

`src/test/app.test.tsx` drives the actual components through a full round
(setup → scores → standings → settle-up) and a reload, which is what catches
wiring bugs that unit tests can't see.
