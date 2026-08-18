import type {
  CourseInfo,
  HoleInfo,
  PlayerID,
  ScoringPlayer,
} from '../types';
import { makeCourse } from '../types';
import { emptyEvents, makeSnapshot, type RoundEvents, type RoundSnapshot } from '../snapshot';

/**
 * Shared fixtures, ported from `TestFixtures.swift`. Player IDs are fixed so
 * tests can assert deterministic tie-breaks; the course is a conventional par-72
 * with odd stroke indexes on the front nine and even on the back.
 */

export const jackID: PlayerID = '00000000-0000-0000-0000-000000000001';
export const jillID: PlayerID = '00000000-0000-0000-0000-000000000002';
export const bobID: PlayerID = '00000000-0000-0000-0000-000000000003';
export const sueID: PlayerID = '00000000-0000-0000-0000-000000000004';

export const jack = (handicap = 0): ScoringPlayer => ({
  id: jackID,
  name: 'Jack Palmer',
  playingHandicap: handicap,
});
export const jill = (handicap = 0): ScoringPlayer => ({
  id: jillID,
  name: 'Jill Hogan',
  playingHandicap: handicap,
});
export const bob = (handicap = 0): ScoringPlayer => ({
  id: bobID,
  name: 'Bob Snead',
  playingHandicap: handicap,
});
export const sue = (handicap = 0): ScoringPlayer => ({
  id: sueID,
  name: 'Sue Zaharias',
  playingHandicap: handicap,
});

/**
 * Par-72: front 36 / back 36.
 * Pars:           4 5 3 4 4 4 3 5 4 | 4 3 5 4 4 5 3 4 4
 * Stroke indexes: 5 1 17 9 13 7 15 3 11 | 6 16 2 10 14 4 18 8 12
 */
export const pars = [4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 5, 3, 4, 4];
export const strokeIndexes = [5, 1, 17, 9, 13, 7, 15, 3, 11, 6, 16, 2, 10, 14, 4, 18, 8, 12];

function buildHoles(count: number): HoleInfo[] {
  const holes: HoleInfo[] = [];
  for (let number = 1; number <= count; number++) {
    holes.push({
      number,
      par: pars[number - 1]!,
      strokeIndex: strokeIndexes[number - 1]!,
      yardage: 150 + number * 10,
    });
  }
  return holes;
}

export function course18(): CourseInfo {
  return makeCourse('Fixture National', buildHoles(18));
}

export function course9(): CourseInfo {
  return makeCourse('Fixture Nine', buildHoles(9));
}

/** A hole with no score entered yet. */
export const _ = null;

/** Per-player cards where index 0 is hole 1; `null` entries are unscored. */
export type Card = (number | null)[];

/** Builds a score table from per-player arrays. */
export function scoresFrom(
  perPlayer: Record<PlayerID, Card>,
): Record<PlayerID, Record<number, number>> {
  const table: Record<PlayerID, Record<number, number>> = {};
  for (const player of Object.keys(perPlayer)) {
    const byHole: Record<number, number> = {};
    (perPlayer[player] ?? []).forEach((strokes, index) => {
      if (strokes !== null && strokes !== undefined) byHole[index + 1] = strokes;
    });
    table[player] = byHole;
  }
  return table;
}

export interface SnapshotOptions {
  players: ScoringPlayer[];
  scores?: Record<PlayerID, Card>;
  withdrawals?: Record<PlayerID, number>;
  events?: RoundEvents;
  course?: CourseInfo;
}

/** 18-hole snapshot with the given players and scores. */
export function snapshot(options: SnapshotOptions): RoundSnapshot {
  return makeSnapshot({
    course: options.course ?? course18(),
    players: options.players,
    scores: scoresFrom(options.scores ?? {}),
    withdrawals: options.withdrawals ?? {},
    events: options.events ?? emptyEvents(),
  });
}
