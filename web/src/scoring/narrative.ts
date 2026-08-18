import type { BetEvaluation } from './evaluation';
import { shortName } from './engineSupport';
import { describeMoney, type Money } from './money';
import { detectMilestones } from './milestones';
import type { RoundSnapshot } from './snapshot';
import { junkLabel, segmentLabel, type PlayerID } from './types';

/**
 * The hole-by-hole account of what actually happened.
 *
 * A settlement table tells you the answer; it doesn't tell you the story, and
 * the story is what the argument in the parking lot is about. This turns the
 * same deterministic evaluation data into sentences: who took the skin, when the
 * press opened, where the carryover landed.
 *
 * It reads only from evaluations and the snapshot, so it stays a pure function
 * of the round — no separate log to keep in sync, and nothing here can disagree
 * with the money.
 */

export interface NarrativeEntry {
  /** null for round-level lines that don't belong to a hole. */
  hole: number | null;
  text: string;
  /** Headline money attached to the moment, when there is any. */
  amount?: Money;
  /** Drives emphasis in the UI: a closed match reads louder than a par. */
  weight: 'major' | 'normal' | 'minor';
  /** Stable so React keys don't churn between recomputes. */
  id: string;
}

export function buildNarrative(
  snapshot: RoundSnapshot,
  evaluations: BetEvaluation[],
): NarrativeEntry[] {
  const entries: NarrativeEntry[] = [];
  const name = (id: PlayerID) => shortName(snapshot, id);
  const names = (ids: PlayerID[]) => ids.map(name).join(' & ');

  for (const evaluation of evaluations) {
    const detail = evaluation.detail;

    switch (detail.type) {
      case 'skins': {
        for (const { hole, outcome } of detail.value.outcomes) {
          if (outcome.type === 'won') {
            const units = outcome.units;
            entries.push({
              id: `${evaluation.betID}-skin-${hole}`,
              hole,
              weight: units > 1 ? 'major' : 'normal',
              text:
                units > 1
                  ? `${name(outcome.winner)} swept ${units} skins on ${hole} — the carryover from the last ${units - 1} came with it.`
                  : `${name(outcome.winner)} took the skin on ${hole}.`,
              amount: outcome.perPlayer,
            });
          } else if (outcome.type === 'carried') {
            entries.push({
              id: `${evaluation.betID}-carry-${hole}`,
              hole,
              weight: 'minor',
              text: `Hole ${hole} was halved — the skin carries.`,
            });
          }
        }
        break;
      }

      case 'nassau': {
        for (const segment of detail.value.segments) {
          for (const line of segment.bets) {
            if (line.isPress) {
              entries.push({
                id: `${evaluation.betID}-press-${line.segment}-${line.firstHole}`,
                hole: line.firstHole,
                weight: 'normal',
                text: line.isAutoPress
                  ? `Auto-press opened on ${line.firstHole} — a new bet over the rest of the ${segmentLabel(line.segment).toLowerCase()}.`
                  : `Press called from ${line.firstHole}.`,
              });
            }
            const status = line.match.status;
            if (status.closed && status.winner !== null) {
              entries.push({
                id: `${evaluation.betID}-closed-${line.segment}-${line.firstHole}`,
                hole: status.thruHole,
                weight: 'major',
                text: `${line.label} closed out ${status.display}.`,
              });
            }
          }
        }
        break;
      }

      case 'matchPlay': {
        const status = detail.value.match.status;
        if (status.closed && status.winner !== null) {
          entries.push({
            id: `${evaluation.betID}-match-closed`,
            hole: status.thruHole,
            weight: 'major',
            text: `The match ended ${status.display}.`,
          });
        }
        break;
      }

      case 'wolf': {
        for (const line of detail.value.holes) {
          if (line.outcome.type === 'wolfTeamWon') {
            const multiplier = line.outcome.multiplier;
            entries.push({
              id: `${evaluation.betID}-wolf-${line.hole}`,
              hole: line.hole,
              weight: multiplier > 1 ? 'major' : 'normal',
              text:
                multiplier > 1
                  ? `${name(line.wolf)} went alone on ${line.hole} and beat the pack at ${multiplier}×.`
                  : `${name(line.wolf)} and partner took ${line.hole}.`,
            });
          } else if (line.outcome.type === 'othersWon' && line.outcome.multiplier > 1) {
            entries.push({
              id: `${evaluation.betID}-wolf-lost-${line.hole}`,
              hole: line.hole,
              weight: 'normal',
              text: `${name(line.wolf)} went alone on ${line.hole} and got caught.`,
            });
          }
        }
        break;
      }

      case 'vegas': {
        for (const line of detail.value.holes) {
          if (line.numberA === null || line.swing === 0) continue;
          if (Math.abs(line.swing) < 10 && !line.flipped) continue;
          entries.push({
            id: `${evaluation.betID}-vegas-${line.hole}`,
            hole: line.hole,
            weight: Math.abs(line.swing) >= 20 ? 'major' : 'normal',
            text: line.flipped
              ? `Vegas on ${line.hole}: a birdie flipped the other side to ${line.flipped === 'a' ? line.numberA : line.numberB} — ${Math.abs(line.swing)} points.`
              : `Vegas on ${line.hole}: ${line.numberA} against ${line.numberB}, ${Math.abs(line.swing)} points.`,
          });
        }
        break;
      }

      case 'snake': {
        for (const pass of detail.value.passes) {
          entries.push({
            id: `${evaluation.betID}-snake-${pass.hole}-${pass.player}`,
            hole: pass.hole,
            weight: 'normal',
            text: `${name(pass.player)} three-putted ${pass.hole} and picked up the snake.`,
          });
        }
        if (detail.value.holder !== null && detail.value.isFinal) {
          entries.push({
            id: `${evaluation.betID}-snake-final`,
            hole: null,
            weight: 'major',
            text: `${name(detail.value.holder)} finished holding the snake.`,
            amount: detail.value.valuePerPlayer,
          });
        }
        break;
      }

      case 'junk': {
        for (const claim of detail.value.claims) {
          entries.push({
            id: `${evaluation.betID}-junk-${claim.hole}-${claim.kind}-${claim.player}`,
            hole: claim.hole,
            weight: 'minor',
            text: `${name(claim.player)} claimed a ${junkLabel(claim.kind as never).toLowerCase()} on ${claim.hole}.`,
            amount: claim.amount,
          });
        }
        break;
      }

      case 'segments': {
        for (const segment of detail.value.segments) {
          if (!segment.isSettled || segment.margin === 0) continue;
          const winners = segment.margin > 0 ? segment.sideA : segment.sideB;
          entries.push({
            id: `${evaluation.betID}-seg-${segment.label}`,
            hole: segment.holes[segment.holes.length - 1] ?? null,
            weight: 'normal',
            text: `${segment.label}: ${names(winners)} took it, ${segment.status}.`,
          });
        }
        break;
      }

      case 'points':
      case 'strokePlay':
        // These have no discrete moments — they're a running tally, and the
        // standings already say everything there is to say.
        break;
    }
  }

  // Score-quality moments are independent of any bet, and they're most of what
  // people actually remember about a round.
  for (const milestone of detectMilestones(snapshot)) {
    const who = name(milestone.player);
    const kind = milestone.kind;
    if (kind.type === 'holeInOne') {
      entries.push({
        id: milestone.id,
        hole: milestone.hole,
        weight: 'major',
        text: `${who} aced ${milestone.hole}.`,
      });
    } else if (kind.type === 'albatross') {
      entries.push({
        id: milestone.id,
        hole: milestone.hole,
        weight: 'major',
        text: `${who} made albatross on ${milestone.hole}.`,
      });
    } else if (kind.type === 'eagle') {
      entries.push({
        id: milestone.id,
        hole: milestone.hole,
        weight: 'major',
        text: `${who} eagled ${milestone.hole}.`,
      });
    } else if (kind.type === 'birdie') {
      entries.push({
        id: milestone.id,
        hole: milestone.hole,
        weight: 'minor',
        text: `${who} birdied ${milestone.hole}.`,
      });
    } else if (kind.type === 'birdieStreak' && kind.count >= 3) {
      entries.push({
        id: milestone.id,
        hole: milestone.hole,
        weight: 'normal',
        text: `${who} made it ${kind.count} birdies in a row through ${milestone.hole}.`,
      });
    }
  }

  // Hole order, with round-level lines last.
  return entries.sort((a, b) => {
    if (a.hole === null && b.hole === null) return 0;
    if (a.hole === null) return 1;
    if (b.hole === null) return -1;
    return a.hole - b.hole;
  });
}

/** Groups the narrative by hole for a sectioned recap view. */
export function narrativeByHole(
  entries: NarrativeEntry[],
): { hole: number | null; entries: NarrativeEntry[] }[] {
  const groups: { hole: number | null; entries: NarrativeEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.hole === entry.hole) {
      last.entries.push(entry);
    } else {
      groups.push({ hole: entry.hole, entries: [entry] });
    }
  }
  return groups;
}

/** One-line summary of a moment's money, for the recap rows. */
export function narrativeAmount(entry: NarrativeEntry): string | null {
  if (entry.amount === undefined || entry.amount === 0) return null;
  return describeMoney(entry.amount);
}
