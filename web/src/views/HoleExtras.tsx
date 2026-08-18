import { Card } from '../components/ui';
import { junkLabel, type JunkKind, type PlayerID } from '../scoring';
import type { RoundSession } from '../state/useRoundSession';

/**
 * The two things a scorecard can't work out for itself.
 *
 * **Putts** matter only when a Snake is running: "did anyone three-putt?" is
 * unknowable from a total, so the field appears when — and only when — a bet
 * needs it. Same reasoning as the Wolf prompt, which shows up only on a hole
 * that needs a declaration.
 *
 * **Junk** is claimed, not computed. Nobody can tell a sandy from a plain par by
 * looking at a 4, so each enabled achievement gets a tap target per player.
 */

export function PuttsRow({
  session,
  hole,
}: {
  session: RoundSession;
  hole: number;
}) {
  const needsPutts = session.bets.some((bet) => bet.kind.type === 'snake');
  if (!needsPutts) return null;

  const active = session.snapshot.players.filter((p) => {
    const withdrawnAt = session.round.withdrawals[p.id];
    return withdrawnAt === undefined || hole <= withdrawnAt;
  });

  return (
    <Card className="p-4">
      <div className="text-caption text-text-secondary mb-1">Putts</div>
      <div className="text-caption text-text-secondary mb-3">
        A three-putt hands over the snake. Leave blank if nobody was counting.
      </div>
      <div className="space-y-2">
        {active.map((player) => {
          const putts = session.entryFor(player.id, hole)?.putts ?? null;
          return (
            <div key={player.id} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-body">
                {session.emojiFor(player.id)} {player.name.split(' ')[0]}
              </span>
              {[1, 2, 3, 4].map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-label={`${player.name}: ${count} putts`}
                  aria-pressed={putts === count}
                  onClick={() =>
                    session.setPutts(player.id, hole, putts === count ? null : count)
                  }
                  className={`tap w-11 rounded-chip border text-body tnum ${
                    putts === count
                      ? count >= 3
                        ? 'bg-down border-down text-text-onBright'
                        : 'bg-primary border-primary text-text-onAccent'
                      : 'border-stroke text-text-secondary'
                  }`}
                >
                  {count}
                  {count === 4 ? '+' : ''}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function JunkRow({ session, hole }: { session: RoundSession; hole: number }) {
  const junkBets = session.bets.filter((bet) => bet.kind.type === 'junk');
  if (junkBets.length === 0) return null;

  const active: PlayerID[] = session.snapshot.players
    .filter((p) => {
      const withdrawnAt = session.round.withdrawals[p.id];
      return withdrawnAt === undefined || hole <= withdrawnAt;
    })
    .map((p) => p.id);

  return (
    <>
      {junkBets.map((bet) => {
        if (bet.kind.type !== 'junk') return null;
        const kinds: JunkKind[] = bet.kind.config.enabled;
        if (kinds.length === 0) return null;

        return (
          <Card key={bet.id} className="p-4">
            <div className="text-caption text-text-secondary mb-3">
              {bet.name} — tap what happened on {hole}
            </div>
            <div className="space-y-3">
              {kinds.map((kind) => (
                <div key={kind}>
                  <div className="text-caption text-text-secondary mb-1">
                    {junkLabel(kind)}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {active.map((playerID) => {
                      const claimed = session.hasJunkClaim(bet.id, hole, kind, playerID);
                      return (
                        <button
                          key={playerID}
                          type="button"
                          aria-pressed={claimed}
                          onClick={() =>
                            session.toggleJunkClaim(bet.id, hole, kind, playerID)
                          }
                          className={`tap px-3 rounded-chip border text-body ${
                            claimed
                              ? 'bg-money border-money text-text-onBright font-semibold'
                              : 'border-stroke text-text-secondary'
                          }`}
                        >
                          {session.emojiFor(playerID)}{' '}
                          {session.playerNamed(playerID)?.name.split(' ')[0] ?? '?'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}
