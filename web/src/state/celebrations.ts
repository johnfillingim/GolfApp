import {
  describeMoney,
  playerIn,
  type Milestone,
  type Money,
  type PlayerID,
  type RoundSnapshot,
  type ScoringEvent,
} from '../scoring';

/**
 * Decides *what deserves celebrating and how much*, exactly once.
 *
 * Inputs are the deterministic, stably-identified outputs of the scoring module
 * (`Milestone`s and `ScoringEvent`s). Because IDs are stable across
 * re-evaluation, "have we fired this?" is a set lookup, persisted per round —
 * score edits and reloads can never double-fire a fanfare.
 *
 * Ported from `CelebrationEngine.swift`. Haptics are gone: iOS Safari has no
 * vibration API, so the overlay carries the whole payload visually.
 */

/**
 * Intensity ladder. Everything above `toast` gets motion; `jackpot` is the
 * full-screen showstopper.
 */
export type CelebrationTier = 'toast' | 'minor' | 'medium' | 'major' | 'jackpot';

const TIER_RANK: Record<CelebrationTier, number> = {
  toast: 0,
  minor: 1,
  medium: 2,
  major: 3,
  jackpot: 4,
};

/** Milliseconds on screen when not skipped. */
export const TIER_DURATION: Record<CelebrationTier, number> = {
  toast: 2200,
  minor: 1800,
  medium: 2600,
  major: 3400,
  jackpot: 5000,
};

/** One queued celebration, ready for the overlay to render. */
export interface Celebration {
  /** Stable — mirrors the milestone/event ID. */
  id: string;
  tier: CelebrationTier;
  title: string;
  subtitle: string | null;
  emoji: string;
  money: Money | null;
  /** The local player earned it (bigger treatment) vs. a buddy did. */
  isMine: boolean;
}

function shortName(snapshot: RoundSnapshot, id: PlayerID): string {
  const name = playerIn(snapshot, id)?.name;
  if (!name) return '?';
  return name.split(' ').filter(Boolean)[0] ?? name;
}

function forMilestone(
  milestone: Milestone,
  snapshot: RoundSnapshot,
  myPlayerID: PlayerID | null,
): Celebration {
  const isMine = milestone.player === myPlayerID;
  const name = shortName(snapshot, milestone.player);
  const hole = milestone.hole;

  switch (milestone.kind.type) {
    case 'birdie':
      return {
        id: milestone.id,
        tier: isMine ? 'medium' : 'toast',
        title: isMine ? 'Birdie!' : `${name} birdied ${hole}`,
        subtitle: isMine ? `Hole ${hole}` : null,
        emoji: '🐦',
        money: null,
        isMine,
      };
    case 'eagle':
      return {
        id: milestone.id,
        tier: isMine ? 'major' : 'minor',
        title: isMine ? 'EAGLE!' : `${name} eagled ${hole}!`,
        subtitle: isMine ? `Hole ${hole} — two under` : null,
        emoji: '🦅',
        money: null,
        isMine,
      };
    case 'albatross':
      return {
        id: milestone.id,
        tier: 'jackpot',
        title: isMine ? 'ALBATROSS!!' : `${name} — ALBATROSS!`,
        subtitle: `Hole ${hole} — three under. Once a lifetime.`,
        emoji: '🕊️',
        money: null,
        isMine,
      };
    case 'holeInOne':
      return {
        id: milestone.id,
        tier: 'jackpot',
        title: isMine ? 'HOLE IN ONE!!' : `${name} ACED IT!`,
        subtitle: `Hole ${hole}. Drinks are on ${isMine ? 'you' : name}.`,
        emoji: '⛳️',
        money: null,
        isMine,
      };
    case 'birdieStreak': {
      const count = milestone.kind.count;
      return {
        id: milestone.id,
        tier: isMine ? (count >= 3 ? 'major' : 'medium') : 'toast',
        title: isMine
          ? `${count} birdies in a row!`
          : `${name}: ${count} straight birdies`,
        subtitle: isMine ? "You're on fire" : null,
        emoji: '🔥',
        money: null,
        isMine,
      };
    }
  }
}

function forEvent(
  event: ScoringEvent,
  snapshot: RoundSnapshot,
  myPlayerID: PlayerID | null,
): Celebration {
  const isMine = myPlayerID !== null && event.players.includes(myPlayerID);
  const names = event.players.map((p) => shortName(snapshot, p)).join(' & ');
  const holeText = event.hole !== undefined ? `Hole ${event.hole}` : null;

  switch (event.kind.type) {
    case 'skinWon': {
      const units = event.kind.units;
      return {
        id: event.id,
        tier: isMine ? 'medium' : 'toast',
        title: isMine
          ? units > 1
            ? `You took ${units} skins!`
            : 'Skin won!'
          : `${names} took ${units > 1 ? `${units} skins` : 'the skin'}`,
        subtitle: holeText,
        emoji: '💰',
        money: event.amount ?? null,
        isMine,
      };
    }
    case 'pressStarted':
      return {
        id: event.id,
        tier: 'minor',
        title: event.kind.auto ? 'Auto-press!' : 'Press!',
        subtitle: event.hole !== undefined ? `New bet from hole ${event.hole}` : null,
        emoji: '♻️',
        money: null,
        isMine,
      };
    case 'matchClosed': {
      const margin = event.kind.margin;
      return {
        id: event.id,
        tier: isMine ? 'major' : 'minor',
        title: isMine ? `Match closed out ${margin}` : `${names} win ${margin}`,
        subtitle: null,
        emoji: '🏆',
        money: event.amount ?? null,
        isMine,
      };
    }
    case 'segmentDecided': {
      const segment = event.kind.segment;
      const segmentName =
        segment === 'front'
          ? 'the front nine'
          : segment === 'back'
            ? 'the back nine'
            : 'the match';
      return {
        id: event.id,
        tier: isMine ? 'medium' : 'toast',
        title: isMine ? `You took ${segmentName}!` : `${names} take ${segmentName}`,
        subtitle: null,
        emoji: '💵',
        money: event.amount ?? null,
        isMine,
      };
    }
    case 'wolfWon': {
      const multiplier = event.kind.multiplier;
      return {
        id: event.id,
        tier: isMine ? 'major' : 'minor',
        title: isMine
          ? `Lone wolf ×${multiplier}!`
          : `${names} — lone wolf ×${multiplier}!`,
        subtitle: 'Beat the pack alone',
        emoji: '🐺',
        money: event.amount ?? null,
        isMine,
      };
    }
  }
}

/**
 * Given everything currently true about a round and the set already fired,
 * returns the fresh celebrations (highest tier first, so an eagle isn't queued
 * behind three toasts) plus the IDs to record as fired.
 *
 * Pure: the caller owns the fired set and its persistence.
 */
export function newCelebrations(options: {
  milestones: Milestone[];
  events: ScoringEvent[];
  snapshot: RoundSnapshot;
  myPlayerID: PlayerID | null;
  alreadyFired: ReadonlySet<string>;
}): { celebrations: Celebration[]; firedIDs: string[] } {
  const { milestones, events, snapshot, myPlayerID, alreadyFired } = options;
  const fresh: Celebration[] = [];
  const firedIDs: string[] = [];

  for (const milestone of milestones) {
    if (alreadyFired.has(milestone.id)) continue;
    firedIDs.push(milestone.id);
    fresh.push(forMilestone(milestone, snapshot, myPlayerID));
  }
  for (const event of events) {
    if (alreadyFired.has(event.id)) continue;
    firedIDs.push(event.id);
    fresh.push(forEvent(event, snapshot, myPlayerID));
  }

  fresh.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
  return { celebrations: fresh, firedIDs };
}

/** Every celebratable ID currently present — used to open a round quietly. */
export function allCelebrationIDs(
  milestones: Milestone[],
  events: ScoringEvent[],
): string[] {
  return [...milestones.map((m) => m.id), ...events.map((e) => e.id)];
}

/** Money line for the overlay, when the moment carries one. */
export function celebrationMoneyText(celebration: Celebration): string | null {
  if (celebration.money === null || celebration.money === 0) return null;
  return describeMoney(celebration.money);
}
