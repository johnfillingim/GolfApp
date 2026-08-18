import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  detectMilestones,
  evaluateAll,
  makeSnapshot,
  minimalTransfers,
  netBalances,
  transferID,
  type Bet,
  type BetEvaluation,
  type Balances,
  type JunkKind,
  type MatchSide,
  type Milestone,
  type NassauSegment,
  type PlayerID,
  type RoundSnapshot,
  type ScoringPlayer,
  type Transfer,
  type WolfChoice,
} from '../scoring';
import { courseInfoFrom } from '../data/courses';
import { saveRound } from '../data/db';
import {
  scoreEntry,
  type ScoreEntry,
  type StoredRound,
} from '../data/model';
import {
  allCelebrationIDs,
  newCelebrations,
  TIER_DURATION,
  type Celebration,
} from './celebrations';

/**
 * The live-round brain, ported from `RoundSession.swift`. Every mutation runs
 * the same offline-first sequence the iOS app documented:
 *
 *   1. write the round document (source of truth — UI reads only this)
 *   2. recompute snapshot + bet evaluations (pure, from the scoring module)
 *   3. hand new milestones/events to the celebration queue (dedup by ID)
 *   4. persist to IndexedDB (fire-and-forget)
 *
 * Steps 2 and 3 fall out of React's render cycle here rather than being called
 * explicitly, but the ordering guarantee is the same: nothing is displayed that
 * wasn't derived from the persisted document.
 */

export interface RoundSession {
  round: StoredRound;
  snapshot: RoundSnapshot;
  bets: Bet[];
  evaluations: BetEvaluation[];
  milestones: Milestone[];

  currentHole: number;
  setCurrentHole: (hole: number) => void;

  myPlayerID: PlayerID | null;

  /** Live money including open components at their current leaders. */
  projectedBalances: Balances;
  /** Money that can no longer move. */
  settledBalances: Balances;
  transfers: Transfer[];
  isComplete: boolean;

  strokesFor: (player: PlayerID, hole: number) => number | null;
  entryFor: (player: PlayerID, hole: number) => ScoreEntry | undefined;
  playerNamed: (id: PlayerID) => ScoringPlayer | undefined;
  emojiFor: (id: PlayerID) => string;

  setStrokes: (player: PlayerID, hole: number, strokes: number | null) => void;
  adjustStrokes: (player: PlayerID, hole: number, delta: number) => void;
  setPutts: (player: PlayerID, hole: number, putts: number | null) => void;
  setFairway: (player: PlayerID, hole: number, hit: boolean | null) => void;
  setGIR: (player: PlayerID, hole: number, hit: boolean | null) => void;

  declarePress: (
    betID: string,
    segment: NassauSegment,
    fromHole: number,
    side: MatchSide,
  ) => void;
  declareWolf: (
    betID: string,
    hole: number,
    wolf: PlayerID,
    choice: WolfChoice,
  ) => void;
  withdraw: (player: PlayerID, afterHole: number) => void;
  addBet: (bet: Bet) => void;

  pendingWolfDecision: (hole: number) => { bet: Bet; wolf: ScoringPlayer } | null;

  toggleJunkClaim: (
    betID: string,
    hole: number,
    kind: JunkKind,
    player: PlayerID,
  ) => void;
  hasJunkClaim: (
    betID: string,
    hole: number,
    kind: JunkKind,
    player: PlayerID,
  ) => boolean;

  markSettled: (transfer: Transfer, settled: boolean) => void;
  isSettled: (transfer: Transfer) => boolean;
  finishRound: () => void;

  celebration: Celebration | null;
  skipCelebration: () => void;
}

const MAX_STROKES = 19;

function firstOpenHole(round: StoredRound, playerID: PlayerID | null): number {
  const holes = round.holeNumbers;
  if (holes.length === 0) return 1;
  if (playerID === null) return holes[0]!;
  const open = holes.find((hole) => scoreEntry(round, playerID, hole)?.strokes == null);
  return open ?? holes[holes.length - 1]!;
}

export function useRoundSession(
  initial: StoredRound,
  myProfileID: string | null,
): RoundSession {
  const [round, setRound] = useState<StoredRound>(initial);

  // "Me" drives the bigger celebration treatment and which row the scorecard
  // opens on. On a shared phone the owner is usually playing; if they aren't,
  // falling back to the first player keeps the UI sensible rather than blank.
  const myPlayerID = useMemo(() => {
    const mine =
      myProfileID !== null
        ? round.players.find((p) => p.profileID === myProfileID)
        : undefined;
    return mine?.id ?? round.players[0]?.id ?? null;
  }, [round.players, myProfileID]);

  const [currentHole, setCurrentHole] = useState(() =>
    firstOpenHole(initial, initial.players[0]?.id ?? null),
  );

  // MARK: Derived state — the pure pipeline

  const snapshot = useMemo<RoundSnapshot>(() => {
    const players: ScoringPlayer[] = [...round.players]
      .sort((a, b) => a.teeOrder - b.teeOrder)
      .map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap }));

    const scores: Record<PlayerID, Record<number, number>> = {};
    for (const player of round.players) {
      const byHole: Record<number, number> = {};
      const entries = round.scores[player.id] ?? {};
      for (const holeKey of Object.keys(entries)) {
        const hole = Number(holeKey);
        const strokes = entries[hole]?.strokes;
        if (strokes != null) byHole[hole] = strokes;
      }
      scores[player.id] = byHole;
    }

    // Snake is the one format that reads putts, so they ride along with the
    // strokes rather than being a separate lookup.
    const putts: Record<PlayerID, Record<number, number>> = {};
    for (const player of round.players) {
      const byHole: Record<number, number> = {};
      const entries = round.scores[player.id] ?? {};
      for (const holeKey of Object.keys(entries)) {
        const hole = Number(holeKey);
        const value = entries[hole]?.putts;
        if (value != null) byHole[hole] = value;
      }
      putts[player.id] = byHole;
    }

    return makeSnapshot({
      course: courseInfoFrom(round.course),
      players,
      holeNumbers: round.holeNumbers,
      scores,
      putts,
      withdrawals: round.withdrawals,
      events: round.events,
    });
  }, [round]);

  const evaluations = useMemo(
    () => evaluateAll(round.bets, snapshot),
    [round.bets, snapshot],
  );
  const milestones = useMemo(() => detectMilestones(snapshot), [snapshot]);

  const projectedBalances = useMemo(
    () => netBalances(evaluations.map((e) => e.projected)),
    [evaluations],
  );
  const settledBalances = useMemo(
    () => netBalances(evaluations.map((e) => e.settled)),
    [evaluations],
  );
  const transfers = useMemo(
    () => minimalTransfers(settledBalances, snapshot.players.map((p) => p.id)),
    [settledBalances, snapshot.players],
  );

  const isComplete = useMemo(
    () =>
      round.players.every((player) => {
        if (round.withdrawals[player.id] !== undefined) return true;
        return round.holeNumbers.every(
          (hole) => scoreEntry(round, player.id, hole)?.strokes != null,
        );
      }),
    [round],
  );

  // MARK: Persistence

  // Skip the very first save: nothing has changed yet, and writing on mount
  // would bump `updatedAt` just for opening a finished round.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void saveRound(round);
  }, [round]);

  // MARK: Celebrations

  const firedRef = useRef<Set<string>>(new Set(initial.firedCelebrations));
  const [queue, setQueue] = useState<Celebration[]>([]);
  const [celebration, setCelebration] = useState<Celebration | null>(null);

  // Opening a round with history stays quiet: everything already computed is
  // marked celebrated without firing.
  const suppressed = useRef(false);
  useEffect(() => {
    if (suppressed.current) return;
    suppressed.current = true;
    const existing = allCelebrationIDs(
      milestones,
      evaluations.flatMap((e) => e.events),
    );
    for (const id of existing) firedRef.current.add(id);
    // Persist the suppression so a reload doesn't fire it either.
    setRound((current) => {
      const merged = new Set([...current.firedCelebrations, ...existing]);
      if (merged.size === current.firedCelebrations.length) return current;
      return { ...current, firedCelebrations: [...merged] };
    });
  }, [milestones, evaluations]);

  useEffect(() => {
    if (!suppressed.current) return;
    const { celebrations, firedIDs } = newCelebrations({
      milestones,
      events: evaluations.flatMap((e) => e.events),
      snapshot,
      myPlayerID,
      alreadyFired: firedRef.current,
    });
    if (celebrations.length === 0) return;
    for (const id of firedIDs) firedRef.current.add(id);
    setQueue((current) => [...current, ...celebrations]);
    setRound((current) => ({
      ...current,
      firedCelebrations: [...current.firedCelebrations, ...firedIDs],
    }));
  }, [milestones, evaluations, snapshot, myPlayerID]);

  // Play the queue one at a time, highest tier first.
  useEffect(() => {
    if (celebration !== null || queue.length === 0) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    setCelebration(next ?? null);
  }, [queue, celebration]);

  useEffect(() => {
    if (celebration === null) return;
    const timer = window.setTimeout(
      () => setCelebration(null),
      TIER_DURATION[celebration.tier],
    );
    return () => window.clearTimeout(timer);
  }, [celebration]);

  const skipCelebration = useCallback(() => setCelebration(null), []);

  // MARK: Mutations

  const mutateScore = useCallback(
    (player: PlayerID, hole: number, change: (entry: ScoreEntry) => ScoreEntry) => {
      setRound((current) => {
        const existing = current.scores[player]?.[hole] ?? {
          strokes: null,
          putts: null,
          fairwayHit: null,
          greenInRegulation: null,
          updatedAt: Date.now(),
        };
        const updated = { ...change(existing), updatedAt: Date.now() };
        return {
          ...current,
          status: current.status === 'setup' ? 'live' : current.status,
          scores: {
            ...current.scores,
            [player]: { ...(current.scores[player] ?? {}), [hole]: updated },
          },
        };
      });
    },
    [],
  );

  const strokesFor = useCallback(
    (player: PlayerID, hole: number) => scoreEntry(round, player, hole)?.strokes ?? null,
    [round],
  );

  const entryFor = useCallback(
    (player: PlayerID, hole: number) => scoreEntry(round, player, hole),
    [round],
  );

  const setStrokes = useCallback(
    (player: PlayerID, hole: number, strokes: number | null) => {
      mutateScore(player, hole, (entry) => ({
        ...entry,
        strokes: strokes === null ? null : Math.max(1, Math.min(strokes, MAX_STROKES)),
      }));
    },
    [mutateScore],
  );

  const adjustStrokes = useCallback(
    (player: PlayerID, hole: number, delta: number) => {
      const par = round.course.holes.find((h) => h.number === hole)?.par ?? 4;
      const current = strokesFor(player, hole);
      // First tap lands on par — the most common score — so a typical hole is
      // one or two thumb taps, gloved.
      const next = current === null ? par : current + delta;
      setStrokes(player, hole, Math.max(1, Math.min(next, MAX_STROKES)));
    },
    [round.course.holes, strokesFor, setStrokes],
  );

  const setPutts = useCallback(
    (player: PlayerID, hole: number, putts: number | null) => {
      mutateScore(player, hole, (entry) => ({
        ...entry,
        putts: putts === null ? null : Math.max(0, Math.min(putts, 9)),
      }));
    },
    [mutateScore],
  );

  const setFairway = useCallback(
    (player: PlayerID, hole: number, hit: boolean | null) => {
      mutateScore(player, hole, (entry) => ({ ...entry, fairwayHit: hit }));
    },
    [mutateScore],
  );

  const setGIR = useCallback(
    (player: PlayerID, hole: number, hit: boolean | null) => {
      mutateScore(player, hole, (entry) => ({ ...entry, greenInRegulation: hit }));
    },
    [mutateScore],
  );

  const declarePress = useCallback(
    (betID: string, segment: NassauSegment, fromHole: number, side: MatchSide) => {
      setRound((current) => ({
        ...current,
        events: {
          ...current.events,
          presses: [
            ...current.events.presses,
            {
              id: crypto.randomUUID(),
              betID,
              segment,
              firstHole: fromHole,
              pressedBy: side,
            },
          ],
        },
      }));
    },
    [],
  );

  const declareWolf = useCallback(
    (betID: string, hole: number, wolf: PlayerID, choice: WolfChoice) => {
      setRound((current) => {
        const exists = current.events.wolfDecisions.some(
          (d) => d.betID === betID && d.hole === hole,
        );
        if (exists) return current;
        return {
          ...current,
          events: {
            ...current.events,
            wolfDecisions: [
              ...current.events.wolfDecisions,
              { betID, hole, wolf, choice },
            ],
          },
        };
      });
    },
    [],
  );

  const toggleJunkClaim = useCallback(
    (betID: string, hole: number, kind: JunkKind, player: PlayerID) => {
      setRound((current) => {
        const claims = current.events.junkClaims ?? [];
        const existing = claims.find(
          (c) =>
            c.betID === betID &&
            c.hole === hole &&
            c.kind === kind &&
            c.player === player,
        );
        return {
          ...current,
          events: {
            ...current.events,
            junkClaims: existing
              ? claims.filter((c) => c !== existing)
              : [...claims, { betID, hole, kind, player }],
          },
        };
      });
    },
    [],
  );

  const hasJunkClaim = useCallback(
    (betID: string, hole: number, kind: JunkKind, player: PlayerID) =>
      (round.events.junkClaims ?? []).some(
        (c) =>
          c.betID === betID && c.hole === hole && c.kind === kind && c.player === player,
      ),
    [round.events.junkClaims],
  );

  const withdraw = useCallback((player: PlayerID, afterHole: number) => {
    setRound((current) => {
      const existing = current.withdrawals[player];
      return {
        ...current,
        withdrawals: {
          ...current.withdrawals,
          [player]: existing === undefined ? afterHole : Math.min(existing, afterHole),
        },
      };
    });
  }, []);

  const addBet = useCallback((bet: Bet) => {
    setRound((current) => ({ ...current, bets: [...current.bets, bet] }));
  }, []);

  const pendingWolfDecision = useCallback(
    (hole: number): { bet: Bet; wolf: ScoringPlayer } | null => {
      for (const bet of round.bets) {
        if (bet.kind.type !== 'wolf') continue;
        const config = bet.kind.config;
        const first = config.firstHole ?? snapshot.holeNumbers[0] ?? 1;
        const holes = snapshot.holeNumbers.filter((h) => h >= first);
        const index = holes.indexOf(hole);
        if (index === -1) continue;
        if (config.rotation.length === 0) continue;
        const wolfID = config.rotation[index % config.rotation.length]!;
        const withdrawnAt = round.withdrawals[wolfID];
        if (withdrawnAt !== undefined && hole > withdrawnAt) continue;
        const declared = snapshot.events.wolfDecisions.some(
          (d) => d.betID === bet.id && d.hole === hole,
        );
        if (declared) continue;
        const wolf = snapshot.players.find((p) => p.id === wolfID);
        if (!wolf) continue;
        return { bet, wolf };
      }
      return null;
    },
    [round.bets, round.withdrawals, snapshot],
  );

  const isSettled = useCallback(
    (transfer: Transfer) => {
      const id = transferID(transfer);
      return round.settlementMarks.some((m) => m.transferID === id && m.settledAt !== null);
    },
    [round.settlementMarks],
  );

  const markSettled = useCallback((transfer: Transfer, settled: boolean) => {
    const id = transferID(transfer);
    setRound((current) => {
      const others = current.settlementMarks.filter((m) => m.transferID !== id);
      return {
        ...current,
        settlementMarks: [
          ...others,
          { transferID: id, settledAt: settled ? Date.now() : null, note: null },
        ],
      };
    });
  }, []);

  const finishRound = useCallback(() => {
    setRound((current) => ({ ...current, status: 'finished' }));
  }, []);

  const playerNamed = useCallback(
    (id: PlayerID) => snapshot.players.find((p) => p.id === id),
    [snapshot.players],
  );

  const emojiFor = useCallback(
    (id: PlayerID) => round.players.find((p) => p.id === id)?.emoji ?? '⛳️',
    [round.players],
  );

  return {
    round,
    snapshot,
    bets: round.bets,
    evaluations,
    milestones,
    currentHole,
    setCurrentHole,
    myPlayerID,
    projectedBalances,
    settledBalances,
    transfers,
    isComplete,
    strokesFor,
    entryFor,
    playerNamed,
    emojiFor,
    setStrokes,
    adjustStrokes,
    setPutts,
    setFairway,
    setGIR,
    declarePress,
    declareWolf,
    withdraw,
    addBet,
    pendingWolfDecision,
    toggleJunkClaim,
    hasJunkClaim,
    markSettled,
    isSettled,
    finishRound,
    celebration,
    skipCelebration,
  };
}
