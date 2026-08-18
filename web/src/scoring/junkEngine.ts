import type { BetEvaluation, StandingLine } from './evaluation';
import { pairwise, shortName } from './engineSupport';
import { addAll, describeMoney, type Balances } from './money';
import { activePlayers, orderIndex, type RoundSnapshot } from './snapshot';
import { junkLabel, type Bet, type JunkConfig, type PlayerID } from './types';

/**
 * Junk: the grab-bag of one-off achievements — greenies, sandies, barkies and
 * the rest. Each claim is worth `stakePerItem` from every other participant.
 *
 * This is the only format that can't be derived from a scorecard. Nobody can
 * tell from a 4 whether it came out of a bunker, so somebody has to say so.
 * Claims therefore arrive as append-only events with the same conflict-free
 * identity shape as Wolf picks: one claim per (bet, hole, kind, player).
 *
 * Because a claim is a stated fact rather than a computed one, it settles the
 * moment it's made — there is nothing to project.
 */
export function evaluateJunk(
  bet: Bet,
  config: JunkConfig,
  snapshot: RoundSnapshot,
): BetEvaluation {
  const allHoles = snapshot.holeNumbers;
  const first = config.firstHole ?? allHoles[0] ?? 1;

  const claims = (snapshot.events.junkClaims ?? [])
    .filter((claim) => claim.betID === bet.id)
    .filter((claim) => claim.hole >= first && allHoles.includes(claim.hole))
    .filter((claim) => config.enabled.includes(claim.kind))
    .filter((claim) => config.players.includes(claim.player))
    // A claim only pays if the claimant was still in the round on that hole.
    .filter((claim) => activePlayers(snapshot, [claim.player], claim.hole).length > 0)
    .sort((x, y) => x.hole - y.hole || (x.kind < y.kind ? -1 : x.kind > y.kind ? 1 : 0));

  const balances: Balances = {};
  const counts: Record<PlayerID, number> = {};
  const detailClaims: { hole: number; kind: string; player: PlayerID; amount: number }[] = [];

  for (const claim of claims) {
    const payers = activePlayers(snapshot, config.players, claim.hole).filter(
      (p) => p !== claim.player,
    );
    if (payers.length === 0) continue;
    addAll(balances, pairwise([claim.player], payers, config.stakePerItem));
    counts[claim.player] = (counts[claim.player] ?? 0) + 1;
    detailClaims.push({
      hole: claim.hole,
      kind: claim.kind,
      player: claim.player,
      amount: config.stakePerItem * payers.length,
    });
  }

  const lines: StandingLine[] = claims.map((claim) => ({
    id: `${bet.id}-${claim.hole}-${claim.kind}-${claim.player}`,
    title: `Hole ${claim.hole} · ${junkLabel(claim.kind)}`,
    status: `${shortName(snapshot, claim.player)} — ${describeMoney(config.stakePerItem)}/player`,
    leaders: [claim.player],
    isSettled: true,
  }));

  const ranked = [...config.players].sort(
    (a, b) =>
      (counts[b] ?? 0) - (counts[a] ?? 0) || orderIndex(snapshot, a) - orderIndex(snapshot, b),
  );
  const top = ranked[0];

  const headline =
    claims.length === 0
      ? 'No junk claimed yet'
      : `${claims.length} claimed · ${top ? `${shortName(snapshot, top)} ${counts[top] ?? 0}` : ''}`.trim();

  return {
    betID: bet.id,
    betName: bet.name,
    kindName: 'Junk',
    headline,
    lines,
    settled: balances,
    projected: { ...balances },
    events: [],
    detail: { type: 'junk', value: { claims: detailClaims, counts } },
  };
}
