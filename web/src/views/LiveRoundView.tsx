import { useMemo } from 'react';
import { Button, Card, MoneyText } from '../components/ui';
import { JunkRow, PuttsRow } from './HoleExtras';
import { balanceOf, holeAt, type PlayerID } from '../scoring';
import type { RoundSession } from '../state/useRoundSession';

/**
 * Hole-by-hole score entry — the screen that's open for four hours.
 *
 * Design constraints carried from `LiveRoundView.swift`:
 * - One player per row, big −/+ steppers either side of the number. First tap
 *   on an empty hole lands on par, so a typical hole is one or two gloved taps.
 * - The running money for each player is on the same row as their score, so
 *   nobody has to leave this screen to know where they stand.
 * - Hole navigation is edge-anchored and thumb-sized.
 */

function toParLabel(strokes: number | null, par: number): string | null {
  if (strokes === null) return null;
  const diff = strokes - par;
  if (diff === 0) return 'Par';
  if (diff === -1) return 'Birdie';
  if (diff === -2) return 'Eagle';
  if (diff <= -3) return 'Albatross';
  if (diff === 1) return 'Bogey';
  return `+${diff}`;
}

function scoreColor(strokes: number | null, par: number): string {
  if (strokes === null) return 'text-text-secondary';
  const diff = strokes - par;
  if (diff < 0) return 'text-money';
  if (diff === 0) return 'text-text-primary';
  return 'text-text-secondary';
}

export function LiveRoundView({
  session,
  onExit,
  onOpenScorecard,
  onOpenStandings,
  onOpenSettle,
  onOpenRecap,
}: {
  session: RoundSession;
  onExit: () => void;
  onOpenScorecard: () => void;
  onOpenStandings: () => void;
  onOpenSettle: () => void;
  onOpenRecap: () => void;
}) {
  const { round, snapshot, currentHole, setCurrentHole } = session;
  const holes = round.holeNumbers;
  const index = holes.indexOf(currentHole);
  const hole = holeAt(snapshot.course, currentHole);
  const par = hole?.par ?? 4;

  const wolfPending = useMemo(
    () => session.pendingWolfDecision(currentHole),
    [session, currentHole],
  );

  const activePlayers = snapshot.players.filter((p) => {
    const withdrawnAt = round.withdrawals[p.id];
    return withdrawnAt === undefined || currentHole <= withdrawnAt;
  });

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Hole header */}
      <header className="safe-top px-4 pb-3 border-b border-stroke shrink-0 bg-violet-hero">
        {/* Installed to the home screen there is no browser chrome, so the way
            back out of a round has to live in the app itself. */}
        <div className="flex items-center justify-between gap-3 mb-1">
          <button
            type="button"
            onClick={onExit}
            className="tap -ml-2 px-2 text-caption text-text-secondary text-left"
          >
            ‹ Rounds
          </button>
          <span className="text-caption text-text-secondary truncate">
            {round.course.name}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label="Previous hole"
            disabled={index <= 0}
            onClick={() => setCurrentHole(holes[index - 1] ?? currentHole)}
            className="tap text-title text-text-secondary disabled:opacity-25"
          >
            ‹
          </button>

          <div className="text-center">
            <div className="text-caption text-text-secondary uppercase tracking-wider">
              Hole
            </div>
            <div className="text-display tnum leading-none">{currentHole}</div>
            <div className="text-caption text-text-secondary mt-1">
              Par {par}
              {hole?.yardage ? ` · ${hole.yardage} yds` : ''} · SI {hole?.strokeIndex}
            </div>
          </div>

          <button
            type="button"
            aria-label="Next hole"
            disabled={index >= holes.length - 1}
            onClick={() => setCurrentHole(holes[index + 1] ?? currentHole)}
            className="tap text-title text-text-secondary disabled:opacity-25"
          >
            ›
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
        {wolfPending && (
          <WolfPrompt session={session} hole={currentHole} pending={wolfPending} />
        )}

        {activePlayers.map((player) => {
          const strokes = session.strokesFor(player.id, currentHole);
          const money = balanceOf(session.projectedBalances, player.id);
          return (
            <Card key={player.id} className="px-3 py-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-title">{session.emojiFor(player.id)}</span>
                  <span className="text-body truncate">{player.name}</span>
                  {player.playingHandicap !== 0 && (
                    <span className="text-caption text-text-secondary shrink-0">
                      {player.playingHandicap > 0 ? '+' : ''}
                      {player.playingHandicap}
                    </span>
                  )}
                </div>
                <MoneyText cents={money} signed />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label={`Decrease ${player.name}'s score`}
                  onClick={() => session.adjustStrokes(player.id, currentHole, -1)}
                  className="tap flex-1 rounded-button bg-raised border border-stroke text-title active:scale-[0.97] transition-transform"
                >
                  −
                </button>

                <div className="w-24 text-center">
                  <div className={`text-score-xl tnum leading-none ${scoreColor(strokes, par)}`}>
                    {strokes ?? '–'}
                  </div>
                  <div className="text-caption text-text-secondary h-4">
                    {toParLabel(strokes, par) ?? 'Tap to score'}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={`Increase ${player.name}'s score`}
                  onClick={() => session.adjustStrokes(player.id, currentHole, 1)}
                  className="tap flex-1 rounded-button bg-violet-tile text-text-onAccent text-title shadow-glow active:scale-[0.97] active:shadow-none transition-transform"
                >
                  +
                </button>
              </div>

              {strokes !== null && (
                <button
                  type="button"
                  onClick={() => session.setStrokes(player.id, currentHole, null)}
                  className="mt-2 w-full text-caption text-text-secondary py-1"
                >
                  Clear
                </button>
              )}
            </Card>
          );
        })}

        <PuttsRow session={session} hole={currentHole} />
        <JunkRow session={session} hole={currentHole} />
        <BetHeadlines session={session} />
      </main>

      <footer className="safe-bottom px-4 pt-3 border-t border-stroke shrink-0 flex gap-2">
        <Button variant="secondary" onClick={onOpenScorecard} className="flex-1 px-2">
          Card
        </Button>
        <Button variant="secondary" onClick={onOpenStandings} className="flex-1 px-2">
          Money
        </Button>
        <Button variant="secondary" onClick={onOpenRecap} className="flex-1 px-2">
          Recap
        </Button>
        <Button variant="secondary" onClick={onOpenSettle} className="flex-1 px-2">
          Settle
        </Button>
      </footer>
    </div>
  );
}

/** Wolf needs a declaration before the hole can score — prompt for it inline. */
function WolfPrompt({
  session,
  hole,
  pending,
}: {
  session: RoundSession;
  hole: number;
  pending: { bet: { id: string }; wolf: { id: PlayerID; name: string } };
}) {
  const { bet, wolf } = pending;
  const others = session.snapshot.players.filter((p) => p.id !== wolf.id);

  return (
    <Card raised className="p-4 border-money/40">
      <div className="text-headline mb-1">
        🐺 {wolf.name} is the wolf on {hole}
      </div>
      <div className="text-caption text-text-secondary mb-3">
        Pick a partner after the tee shots, or go it alone for the multiplier.
      </div>
      <div className="flex flex-wrap gap-2">
        {others.map((partner) => (
          <button
            key={partner.id}
            type="button"
            onClick={() =>
              session.declareWolf(bet.id, hole, wolf.id, {
                type: 'partner',
                partner: partner.id,
              })
            }
            className="tap px-3 py-2 rounded-chip bg-raised border border-stroke text-body"
          >
            {session.emojiFor(partner.id)} {partner.name.split(' ')[0]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => session.declareWolf(bet.id, hole, wolf.id, { type: 'lone' })}
          className="tap px-3 py-2 rounded-chip bg-primary text-text-onAccent text-body font-semibold"
        >
          Lone wolf
        </button>
        <button
          type="button"
          onClick={() => session.declareWolf(bet.id, hole, wolf.id, { type: 'blindLone' })}
          className="tap px-3 py-2 rounded-chip bg-gold text-text-onBright text-body font-semibold"
        >
          Blind
        </button>
      </div>
    </Card>
  );
}

/** One line per bet, so the state of the money is always visible. */
function BetHeadlines({ session }: { session: RoundSession }) {
  if (session.evaluations.length === 0) return null;
  return (
    <Card className="divide-y divide-stroke">
      {session.evaluations.map((evaluation) => (
        <div key={evaluation.betID} className="px-4 py-3">
          <div className="text-caption text-text-secondary uppercase tracking-wider">
            {evaluation.kindName}
          </div>
          <div className="text-body text-text-primary">{evaluation.headline}</div>
        </div>
      ))}
    </Card>
  );
}
