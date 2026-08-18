import { Button, Card, MoneyText, Screen } from '../components/ui';
import {
  balanceOf,
  nassauMembers,
  segmentLabel,
  type Bet,
  type BetEvaluation,
  type PlayerID,
} from '../scoring';
import type { RoundSession } from '../state/useRoundSession';

/**
 * Live standings, ported from `StandingsView.swift`.
 *
 * The screen leads with **projected** money — settled plus every open component
 * at its current leader — because that is the number players actually want
 * ("you're up $23 right now"). Settle-up pays only the settled figure, and the
 * two are labelled distinctly so nobody confuses them.
 */
export function StandingsView({
  session,
  onBack,
}: {
  session: RoundSession;
  onBack: () => void;
}) {
  const { snapshot, projectedBalances, settledBalances, evaluations } = session;

  const ranked = [...snapshot.players].sort(
    (a, b) => balanceOf(projectedBalances, b.id) - balanceOf(projectedBalances, a.id),
  );

  return (
    <Screen title="Standings" subtitle="Projected — if it ended now" onBack={onBack}>
      <div className="p-4 space-y-6">
        <Card className="divide-y divide-stroke">
          {ranked.map((player, position) => {
            const projected = balanceOf(projectedBalances, player.id);
            const settled = balanceOf(settledBalances, player.id);
            return (
              <div key={player.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-5 text-caption text-text-secondary tnum">
                  {position + 1}
                </span>
                <span className="text-title">{session.emojiFor(player.id)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-body truncate">{player.name}</span>
                  <span className="block text-caption text-text-secondary tnum">
                    {settled === projected
                      ? 'all settled'
                      : `${settled >= 0 ? '+' : ''}$${Math.abs(settled / 100).toFixed(2)} locked in`}
                  </span>
                </span>
                <MoneyText cents={projected} signed size="lg" />
              </div>
            );
          })}
        </Card>

        {evaluations.map((evaluation) => {
          const bet = session.bets.find((b) => b.id === evaluation.betID);
          return (
            <BetDetail
              key={evaluation.betID}
              session={session}
              evaluation={evaluation}
              bet={bet}
            />
          );
        })}
      </div>
    </Screen>
  );
}

function BetDetail({
  session,
  evaluation,
  bet,
}: {
  session: RoundSession;
  evaluation: BetEvaluation;
  bet: Bet | undefined;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
        <span className="text-caption uppercase tracking-wider text-text-secondary">
          {evaluation.kindName}
        </span>
        <span className="text-caption text-text-secondary truncate">
          {evaluation.betName}
        </span>
      </div>

      <Card className="divide-y divide-stroke">
        <div className="px-4 py-3 text-body">{evaluation.headline}</div>

        {evaluation.lines.map((line) => (
          <div key={line.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex-1 min-w-0">
              <span className="block text-body truncate">{line.title}</span>
              <span className="block text-caption text-text-secondary truncate">
                {line.status}
              </span>
            </span>
            {line.isSettled && (
              <span className="text-caption text-money shrink-0">final</span>
            )}
          </div>
        ))}

        {bet?.kind.type === 'nassau' && <PressControls session={session} bet={bet} />}
      </Card>
    </div>
  );
}

/**
 * Manual presses. Auto-presses are derived from the scorecard and never need a
 * button; this is for the "press you" that gets called out loud on the tee.
 */
function PressControls({ session, bet }: { session: RoundSession; bet: Bet }) {
  if (bet.kind.type !== 'nassau') return null;
  const config = bet.kind.config;
  const hole = session.currentHole;

  const segments = session.round.holeNumbers.some((h) => h > 9)
    ? ([hole <= 9 ? 'front' : 'back', 'total'] as const)
    : (['total'] as const);

  const sideName = (side: 'a' | 'b'): string =>
    nassauMembers(config, side)
      .map((id: PlayerID) => session.playerNamed(id)?.name.split(' ')[0] ?? '?')
      .join(' & ');

  return (
    <div className="px-4 py-3">
      <div className="text-caption text-text-secondary mb-2">
        Press from hole {hole}
      </div>
      <div className="flex flex-wrap gap-2">
        {segments.map((segment) =>
          (['a', 'b'] as const).map((side) => (
            <Button
              key={`${segment}-${side}`}
              variant="secondary"
              onClick={() => session.declarePress(bet.id, segment, hole, side)}
            >
              {sideName(side)} · {segmentLabel(segment)}
            </Button>
          )),
        )}
      </div>
    </div>
  );
}
