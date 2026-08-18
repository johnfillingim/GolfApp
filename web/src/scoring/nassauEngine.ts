import type {
  BetEvaluation,
  NassauBetLine,
  NassauSegmentResult,
  ScoringEvent,
  StandingLine,
} from './evaluation';
import { matchMargin } from './evaluation';
import { perLoserStake, sideName } from './engineSupport';
import { addAll, type Balances } from './money';
import { matchStatus, rawOutcomes, type RawOutcomes } from './matchEngine';
import { holesInRange, type RoundSnapshot } from './snapshot';
import {
  nassauMembers,
  opponent,
  type Bet,
  type MatchSide,
  type NassauConfig,
  type NassauSegment,
  type PlayerID,
} from './types';

/**
 * Nassau: three matches (front nine, back nine, overall) at one stake, plus
 * presses.
 *
 * ## Press semantics
 * A press opens a brand-new match over the *remaining* holes of its segment, at
 * the segment's stake. Manual presses arrive as append-only `PressEvent`s.
 *
 * Auto-pressing ("2-down automatic") follows the most common convention: the
 * app watches the **most recently opened bet** in each segment, and the moment
 * its trailing side goes exactly `autoPressTrigger` holes down with at least one
 * hole left, a new press opens on the next hole. Each new press then becomes the
 * watched bet, so a side that keeps losing generates the classic press cascade —
 * but an *old* bet drifting further down does not multiply presses.
 *
 * Auto-presses are derived purely from the scorecard (never stored), so all
 * devices agree on them without any sync coordination.
 *
 * ## 9-hole rounds
 * A round without both nines collapses to a single "Match" segment (one bet plus
 * presses) — front/back/total would triple-charge the same nine holes.
 */

interface Line {
  firstHole: number;
  isPress: boolean;
  isAuto: boolean;
  pressedBy: MatchSide;
}

function lineLabel(line: Line, segmentLabel: string): string {
  if (!line.isPress) return segmentLabel;
  return `Press from ${line.firstHole}${line.isAuto ? ' (auto)' : ''}`;
}

export function evaluateNassau(
  bet: Bet,
  config: NassauConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const frontHoles = holesInRange(snapshot, 1, 9);
  const backHoles = holesInRange(snapshot, 10, 18);
  const hasBothNines = frontHoles.length > 0 && backHoles.length > 0;

  const segments: { segment: NassauSegment; holes: number[]; label: string }[] =
    hasBothNines
      ? [
          { segment: 'front', holes: frontHoles, label: 'Front 9' },
          { segment: 'back', holes: backHoles, label: 'Back 9' },
          { segment: 'total', holes: snapshot.holeNumbers, label: 'Overall 18' },
        ]
      : [{ segment: 'total', holes: snapshot.holeNumbers, label: 'Match' }];

  const segmentResults: NassauSegmentResult[] = [];
  const lines: StandingLine[] = [];
  const settled: Balances = {};
  const projected: Balances = {};
  const events: ScoringEvent[] = [];
  const headlineParts: string[] = [];
  let pressCount = 0;

  for (const { segment, holes, label } of segments) {
    if (holes.length === 0) continue;

    const outcomes = rawOutcomes(
      config.sideA,
      config.sideB,
      holes,
      snapshot,
      config.handicapMode,
      config.allowance,
    );

    // Convention: auto-presses ride on the nines. The overall-18 bet only
    // presses manually — otherwise one bad stretch would spawn parallel presses
    // on front AND total. A 9-hole round's single segment is the match, so
    // auto-press applies there.
    const autoAllowed = !(hasBothNines && segment === 'total');
    const betLines = deriveLines(bet, config, segment, holes, outcomes, snapshot, autoAllowed);
    pressCount += betLines.filter((l) => l.isPress).length;

    const resultLines: NassauBetLine[] = [];
    for (const line of betLines) {
      const lineHoles = holes.filter((h) => h >= line.firstHole);
      const comp = matchStatus(lineHoles, outcomes);
      resultLines.push({
        label: lineLabel(line, label),
        segment,
        firstHole: line.firstHole,
        isPress: line.isPress,
        isAutoPress: line.isAuto,
        match: comp,
      });

      // Money: a line pays out when it is mathematically closed or every one of
      // its holes is decided. Otherwise the current leader carries it in
      // `projected` only.
      const decided = comp.status.closed || comp.status.remaining === 0;
      const leaderSide =
        comp.status.winner ?? (comp.status.upA > 0 ? 'a' : comp.status.upA < 0 ? 'b' : null);

      if (decided && comp.status.winner !== null) {
        const winner = comp.status.winner;
        const move = perLoserStake(
          nassauMembers(config, winner),
          nassauMembers(config, opponent(winner)),
          config.stakePerPlayer,
        );
        addAll(settled, move);
        addAll(projected, move);
      } else if (!decided && leaderSide !== null) {
        addAll(
          projected,
          perLoserStake(
            nassauMembers(config, leaderSide),
            nassauMembers(config, opponent(leaderSide)),
            config.stakePerPlayer,
          ),
        );
      }

      // Standings row.
      const leaderNames: PlayerID[] =
        leaderSide !== null ? nassauMembers(config, leaderSide) : [];
      const statusText =
        leaderSide !== null
          ? `${sideName(snapshot, nassauMembers(config, leaderSide))} ${comp.status.display}`
          : comp.status.display;
      lines.push({
        id: `${bet.id}-${segment}-${line.firstHole}`,
        title: lineLabel(line, label),
        status: statusText,
        leaders: leaderNames,
        isSettled: decided,
      });

      // Events with stable IDs.
      if (line.isPress) {
        events.push({
          id: `${bet.id}-press-${segment}-${line.firstHole}`,
          kind: { type: 'pressStarted', auto: line.isAuto },
          betID: bet.id,
          players: nassauMembers(config, line.pressedBy),
          hole: line.firstHole,
          amount: config.stakePerPlayer,
        });
      }
      if (decided && comp.status.winner !== null && !line.isPress) {
        const winner = comp.status.winner;
        events.push({
          id: `${bet.id}-${segment}-final`,
          kind: { type: 'segmentDecided', segment },
          betID: bet.id,
          players: nassauMembers(config, winner),
          ...(comp.status.thruHole !== null ? { hole: comp.status.thruHole } : {}),
          amount: config.stakePerPlayer * nassauMembers(config, opponent(winner)).length,
        });
      }
    }

    segmentResults.push({ segment, bets: resultLines });

    // Headline fragment for this segment, driven by the original bet.
    const original = resultLines[0];
    if (original) {
      const st = original.match.status;
      const prefix =
        segment === 'front' ? 'F' : segment === 'back' ? 'B' : hasBothNines ? 'T' : 'M';
      const side = st.winner ?? (st.upA > 0 ? 'a' : st.upA < 0 ? 'b' : null);
      if (side !== null) {
        const arrow = st.closed || st.remaining === 0 ? '✓' : '↑';
        headlineParts.push(
          `${prefix}: ${sideName(snapshot, nassauMembers(config, side))} ${matchMargin(st)}${arrow}`,
        );
      } else {
        headlineParts.push(`${prefix}: AS`);
      }
    }
  }

  let headline = headlineParts.join(' · ');
  if (pressCount > 0) {
    headline += ` · ${pressCount} press${pressCount === 1 ? '' : 'es'}`;
  }

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Nassau',
    headline,
    lines,
    settled,
    projected,
    events,
    detail: { type: 'nassau', value: { segments: segmentResults } },
  };
}

// MARK: - Line derivation

/** Original bet + manual presses + derived auto-presses for one segment. */
function deriveLines(
  bet: Bet,
  config: NassauConfig,
  segment: NassauSegment,
  holes: number[],
  outcomes: RawOutcomes,
  snapshot: RoundSnapshot,
  autoPressAllowed: boolean,
): Line[] {
  const ordered = [...holes].sort((a, b) => a - b);
  const firstHole = ordered[0];
  if (firstHole === undefined) return [];

  const lines: Line[] = [
    { firstHole, isPress: false, isAuto: false, pressedBy: 'a' },
  ];

  // Manual presses for this bet+segment, validated to a pressable hole (after
  // the segment start, within the segment).
  const manuals = snapshot.events.presses
    .filter((p) => p.betID === bet.id && p.segment === segment)
    .filter((p) => ordered.includes(p.firstHole) && p.firstHole > firstHole)
    .sort((x, y) => x.firstHole - y.firstHole || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const press of manuals) {
    if (lines.some((l) => l.firstHole === press.firstHole)) continue;
    lines.push({
      firstHole: press.firstHole,
      isPress: true,
      isAuto: false,
      pressedBy: press.pressedBy,
    });
  }

  const trigger = config.autoPressTrigger;
  if (autoPressAllowed && trigger != null && trigger > 0) {
    deriveAutoPresses(trigger, ordered, outcomes, lines);
  }

  return [...lines].sort((a, b) => a.firstHole - b.firstHole);
}

/**
 * Chronological auto-press derivation. Repeatedly scans the segment for the
 * earliest hole where the *watched* bet (the one with the latest start at that
 * point in play) transitions to exactly `trigger` down, and opens a press on the
 * next hole. Every spawned press starts strictly later than the previous one, so
 * this terminates.
 */
function deriveAutoPresses(
  trigger: number,
  holes: number[],
  outcomes: RawOutcomes,
  lines: Line[],
): void {
  for (;;) {
    let spawn: { firstHole: number; pressedBy: MatchSide } | null = null;

    for (let index = 0; index < holes.length; index++) {
      const hole = holes[index]!;
      if (outcomes.byHole[hole] === undefined) continue;

      // The bet being watched while this hole is played.
      const started = lines.filter((l) => l.firstHole <= hole);
      if (started.length === 0) continue;
      let watched = started[0]!;
      for (const candidate of started) {
        if (watched.firstHole < candidate.firstHole) watched = candidate;
      }

      // Timeline of the watched bet (its own closure applies).
      const comp = matchStatus(
        holes.filter((h) => h >= watched.firstHole),
        outcomes,
      );
      const result = comp.holeResults.find((r) => r.hole === hole);
      if (!result) continue;

      const earlier = comp.holeResults.filter((r) => r.hole < hole);
      const before = earlier.length > 0 ? earlier[earlier.length - 1]!.upAAfter : 0;
      const transitioned =
        Math.abs(result.upAAfter) === trigger && Math.abs(before) < trigger;
      if (!transitioned) continue;

      // Press opens on the next hole of the segment, if any, and only if no bet
      // already starts there.
      if (index + 1 >= holes.length) continue;
      const next = holes[index + 1]!;
      if (lines.some((l) => l.firstHole === next)) continue;

      // The pressing side is the one that is down.
      spawn = { firstHole: next, pressedBy: result.upAAfter < 0 ? 'a' : 'b' };
      break;
    }

    if (!spawn) break;
    lines.push({
      firstHole: spawn.firstHole,
      isPress: true,
      isAuto: true,
      pressedBy: spawn.pressedBy,
    });
  }
}
