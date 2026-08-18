import { gross, orderIndex, type RoundSnapshot } from './snapshot';
import { holeAt, type PlayerID } from './types';

export type MilestoneKind =
  | { type: 'birdie' }
  | { type: 'eagle' }
  | { type: 'albatross' }
  | { type: 'holeInOne' }
  /** `count` consecutive holes at birdie or better, fired at each extension. */
  | { type: 'birdieStreak'; count: number };

/**
 * Score-quality moments (independent of any bet): birdies, eagles, aces, and
 * birdie streaks. The celebration engine consumes these alongside
 * `ScoringEvent`s; like them, milestones carry stable IDs so re-evaluating a
 * snapshot never re-fires a celebration.
 */
export interface Milestone {
  id: string;
  kind: MilestoneKind;
  player: PlayerID;
  hole: number;
}

/**
 * All milestones present in the snapshot, ordered by hole then player tee
 * order. Gross scores only — a net birdie is money, not glory.
 */
export function detectMilestones(snapshot: RoundSnapshot): Milestone[] {
  const result: Milestone[] = [];

  for (const player of snapshot.players) {
    let streak = 0;
    for (const hole of snapshot.holeNumbers) {
      const par = holeAt(snapshot.course, hole)?.par;
      const strokes = gross(snapshot, player.id, hole);
      if (par === undefined || strokes === undefined) {
        // A gap (unscored hole) breaks any running streak.
        streak = 0;
        continue;
      }

      const toPar = strokes - par;

      // An ace outranks its to-par classification (an ace on a par 3 is also an
      // eagle — celebrate the ace).
      if (strokes === 1) {
        result.push({
          id: `ace-${player.id}-${hole}`,
          kind: { type: 'holeInOne' },
          player: player.id,
          hole,
        });
      } else if (toPar === -1) {
        result.push({
          id: `birdie-${player.id}-${hole}`,
          kind: { type: 'birdie' },
          player: player.id,
          hole,
        });
      } else if (toPar === -2) {
        result.push({
          id: `eagle-${player.id}-${hole}`,
          kind: { type: 'eagle' },
          player: player.id,
          hole,
        });
      } else if (toPar <= -3) {
        result.push({
          id: `albatross-${player.id}-${hole}`,
          kind: { type: 'albatross' },
          player: player.id,
          hole,
        });
      }

      if (toPar <= -1) {
        streak += 1;
        if (streak >= 2) {
          result.push({
            id: `streak-${player.id}-${hole}-${streak}`,
            kind: { type: 'birdieStreak', count: streak },
            player: player.id,
            hole,
          });
        }
      } else {
        streak = 0;
      }
    }
  }

  return result.sort(
    (a, b) =>
      a.hole - b.hole ||
      orderIndex(snapshot, a.player) - orderIndex(snapshot, b.player),
  );
}
