import type { BetEvaluation, StandingLine, VegasHoleLine } from './evaluation';
import { perLoserStake, sideName } from './engineSupport';
import { addAll, describeMoney, type Balances } from './money';
import { netScorer } from './pointsSupport';
import { activePlayers, type RoundSnapshot } from './snapshot';
import { holeAt, type Bet, type PlayerID, type VegasConfig } from './types';

/**
 * Vegas: two-on-two, where each side's hole score is its two scores read as one
 * number, low digit first. A 4 and a 6 make 46. The gap between the two numbers
 * is the swing, paid at `stakePerPoint`.
 *
 * Two conventions matter and are both encoded here:
 * - **Scores of 10 or more are appended, not concatenated as a digit.** A 10 and
 *   a 4 make 410, not 104 — the low score always leads.
 * - **The flip.** When a side makes a birdie or better, the opponent's number is
 *   reversed (65 instead of 56). This is what makes Vegas swing so hard, and why
 *   a blow-up hole against a birdie is genuinely expensive.
 */
export function evaluateVegas(
  bet: Bet,
  config: VegasConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const first = config.firstHole ?? allHoles[0] ?? 1;
  const holes = allHoles.filter((h) => h >= first);
  const members = [...config.sideA, ...config.sideB];
  const net = netScorer(snapshot, members, config.handicapMode, config.allowance);

  const lines: VegasHoleLine[] = [];
  let totalSwing = 0;

  for (const hole of holes) {
    const activeA = activePlayers(snapshot, config.sideA, hole);
    const activeB = activePlayers(snapshot, config.sideB, hole);
    const par = holeAt(snapshot.course, hole)?.par;

    if (activeA.length === 0 || activeB.length === 0 || par === undefined) {
      lines.push({ hole, numberA: null, numberB: null, swing: 0, flipped: null });
      continue;
    }

    const netsA = activeA.map((p) => net(p, hole));
    const netsB = activeB.map((p) => net(p, hole));
    if (netsA.some((n) => n === undefined) || netsB.some((n) => n === undefined)) {
      lines.push({ hole, numberA: null, numberB: null, swing: 0, flipped: null });
      continue;
    }

    // A birdie is judged on gross, like every other piece of glory in the app.
    const birdieA = config.flipOnBirdie && sideHasBirdie(snapshot, activeA, hole, par);
    const birdieB = config.flipOnBirdie && sideHasBirdie(snapshot, activeB, hole, par);

    const numberA = vegasNumber(netsA as number[], birdieB);
    const numberB = vegasNumber(netsB as number[], birdieA);
    const swing = numberB - numberA; // lower number is better, so B−A favors A

    totalSwing += swing;
    lines.push({
      hole,
      numberA,
      numberB,
      swing,
      flipped: birdieB ? 'a' : birdieA ? 'b' : null,
    });
  }

  // Every completed hole is banked immediately — there is nothing open to
  // project, so settled and projected agree.
  const balances: Balances = {};
  if (totalSwing !== 0) {
    const winners = totalSwing > 0 ? config.sideA : config.sideB;
    const losers = totalSwing > 0 ? config.sideB : config.sideA;
    addAll(
      balances,
      perLoserStake(winners, losers, Math.abs(totalSwing) * config.stakePerPoint),
    );
  }

  const played = lines.filter((l) => l.numberA !== null).length;
  const standingLines: StandingLine[] = lines
    .filter((line) => line.numberA !== null)
    .map((line) => ({
      id: `${bet.id}-hole-${line.hole}`,
      title: `Hole ${line.hole}`,
      status: `${line.numberA} v ${line.numberB}${line.flipped ? ' · flipped' : ''} · ${line.swing >= 0 ? '+' : ''}${line.swing}`,
      leaders: line.swing > 0 ? config.sideA : line.swing < 0 ? config.sideB : [],
      isSettled: true,
    }));

  const leaderName =
    totalSwing > 0
      ? sideName(snapshot, config.sideA)
      : sideName(snapshot, config.sideB);
  const headline =
    played === 0
      ? 'No holes scored yet'
      : totalSwing === 0
        ? `All square thru ${played}`
        : `${leaderName} +${Math.abs(totalSwing)} pts · ${describeMoney(Math.abs(totalSwing) * config.stakePerPoint)} thru ${played}`;

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Vegas',
    headline,
    lines: standingLines,
    settled: balances,
    projected: { ...balances },
    events: [],
    detail: { type: 'vegas', value: { holes: lines, totalSwing } },
  };
}

/** Whether anyone on the side made a gross birdie or better. */
function sideHasBirdie(
  snapshot: RoundSnapshot,
  side: PlayerID[],
  hole: number,
  par: number,
): boolean {
  return side.some((player) => {
    const strokes = snapshot.scores[player]?.[hole];
    return strokes !== undefined && strokes - par <= -1;
  });
}

/**
 * Builds a side's Vegas number. Low score leads; a score of 10+ is appended
 * whole rather than treated as a digit. `flip` reverses the pair.
 */
export function vegasNumber(scores: number[], flip: boolean): number {
  const sorted = [...scores].sort((a, b) => a - b);
  const low = sorted[0] ?? 0;
  const high = sorted[sorted.length - 1] ?? low;
  const [lead, trail] = flip ? [high, low] : [low, high];
  const shift = trail >= 10 ? 100 : 10;
  return lead * shift + trail;
}
