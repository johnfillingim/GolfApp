import { Button, Card, EmptyState, MoneyText, Screen } from '../components/ui';
import { courseInfoFrom } from '../data/courses';
import { holesStarted, type StoredRound } from '../data/model';
import {
  balanceOf,
  evaluateAll,
  makeSnapshot,
  netBalances,
  type PlayerID,
} from '../scoring';

/**
 * The opening screen: resume what's in progress, or start something new.
 *
 * History rows show each round's final money without opening it, which is the
 * question people actually ask afterwards ("what did I end up down?").
 */

function finalBalances(round: StoredRound): Record<PlayerID, number> {
  const scores: Record<PlayerID, Record<number, number>> = {};
  for (const player of round.players) {
    const byHole: Record<number, number> = {};
    for (const [holeKey, entry] of Object.entries(round.scores[player.id] ?? {})) {
      if (entry.strokes != null) byHole[Number(holeKey)] = entry.strokes;
    }
    scores[player.id] = byHole;
  }
  const snapshot = makeSnapshot({
    course: courseInfoFrom(round.course),
    players: round.players
      .slice()
      .sort((a, b) => a.teeOrder - b.teeOrder)
      .map((p) => ({ id: p.id, name: p.name, playingHandicap: p.playingHandicap })),
    holeNumbers: round.holeNumbers,
    scores,
    withdrawals: round.withdrawals,
    events: round.events,
  });
  return netBalances(evaluateAll(round.bets, snapshot).map((e) => e.settled));
}

export function HomeView({
  rounds,
  onNewRound,
  onOpenRound,
  onDeleteRound,
}: {
  rounds: StoredRound[];
  onNewRound: () => void;
  onOpenRound: (round: StoredRound) => void;
  onDeleteRound: (round: StoredRound) => void;
}) {
  const inProgress = rounds.filter((r) => r.status !== 'finished');
  const finished = rounds.filter((r) => r.status === 'finished');

  return (
    <Screen
      title="Birdie"
      subtitle="Side bets, settled"
      footer={
        <Button size="lg" onClick={onNewRound}>
          New round
        </Button>
      }
    >
      <div className="p-4 space-y-6">
        {inProgress.length > 0 && (
          <div>
            <div className="text-caption uppercase tracking-wider text-text-secondary mb-2 px-1">
              In progress
            </div>
            <Card className="divide-y divide-stroke">
              {inProgress.map((round) => (
                <button
                  key={round.id}
                  type="button"
                  onClick={() => onOpenRound(round)}
                  className="tap w-full flex items-center gap-3 px-4 py-4 text-left active:bg-raised"
                >
                  <span className="text-title">⛳️</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-body truncate">{round.course.name}</span>
                    <span className="block text-caption text-text-secondary">
                      {round.players.length} players · thru {holesStarted(round)} of{' '}
                      {round.holeNumbers.length}
                    </span>
                  </span>
                  <span className="text-caption text-money shrink-0">Resume ›</span>
                </button>
              ))}
            </Card>
          </div>
        )}

        {finished.length > 0 && (
          <div>
            <div className="text-caption uppercase tracking-wider text-text-secondary mb-2 px-1">
              History
            </div>
            <Card className="divide-y divide-stroke">
              {finished.map((round) => {
                const balances = finalBalances(round);
                const leaders = [...round.players].sort(
                  (a, b) => balanceOf(balances, b.id) - balanceOf(balances, a.id),
                );
                const winner = leaders[0];
                return (
                  <div key={round.id} className="flex items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onOpenRound(round)}
                      className="flex-1 min-w-0 text-left tap flex items-center gap-3"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-body truncate">
                          {round.course.name}
                        </span>
                        <span className="block text-caption text-text-secondary">
                          {new Date(round.createdAt).toLocaleDateString()} ·{' '}
                          {winner ? `${winner.name.split(' ')[0]} up` : 'all square'}
                        </span>
                      </span>
                      {winner && (
                        <MoneyText cents={balanceOf(balances, winner.id)} signed />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${round.course.name} round`}
                      onClick={() => onDeleteRound(round)}
                      className="tap text-text-secondary text-caption px-1"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </Card>
          </div>
        )}

        {rounds.length === 0 && (
          <EmptyState
            emoji="⛳️"
            title="No rounds yet"
            message="Set up your bets on the first tee and everyone can see the money all the way in."
          />
        )}
      </div>
    </Screen>
  );
}
