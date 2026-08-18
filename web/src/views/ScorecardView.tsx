import { Screen } from '../components/ui';
import { holeAt, parOver } from '../scoring';
import type { RoundSession } from '../state/useRoundSession';

/**
 * The traditional grid card, ported from `ScoreGridView.swift`.
 *
 * A scorecard is inherently wide, so the grid scrolls horizontally inside its
 * own container while the page itself never does. Player names stay pinned in a
 * sticky first column — the only way the numbers mean anything once you've
 * scrolled to the back nine.
 */

function cellStyle(strokes: number | null, par: number): string {
  if (strokes === null) return 'text-text-secondary';
  const diff = strokes - par;
  if (diff <= -2) return 'text-money font-bold';
  if (diff === -1) return 'text-money';
  if (diff === 0) return 'text-text-primary';
  if (diff === 1) return 'text-text-secondary';
  return 'text-down';
}

export function ScorecardView({
  session,
  onBack,
}: {
  session: RoundSession;
  onBack: () => void;
}) {
  const { round, snapshot } = session;
  const holes = round.holeNumbers;
  const front = holes.filter((h) => h <= 9);
  const back = holes.filter((h) => h > 9);

  const segments = [
    ...(front.length > 0 ? [{ label: 'Out', holes: front }] : []),
    ...(back.length > 0 ? [{ label: 'In', holes: back }] : []),
  ];

  return (
    <Screen
      title="Scorecard"
      subtitle={round.course.name}
      onBack={onBack}
    >
      <div className="p-4 space-y-6">
        {segments.map((segment) => (
          <div key={segment.label}>
            <div className="text-caption uppercase tracking-wider text-text-secondary mb-2 px-1">
              {segment.label} · par {parOver(snapshot.course, segment.holes)}
            </div>

            <div className="card overflow-x-auto">
              <table className="w-full border-collapse text-grid tnum">
                <thead>
                  <tr className="border-b border-stroke">
                    <th className="sticky left-0 z-10 bg-surface text-left px-3 py-2 text-caption font-medium text-text-secondary">
                      Hole
                    </th>
                    {segment.holes.map((hole) => (
                      <th
                        key={hole}
                        className="px-2 py-2 text-center text-caption font-medium text-text-secondary min-w-[2.25rem]"
                      >
                        {hole}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center text-caption font-medium text-text-secondary">
                      Tot
                    </th>
                  </tr>
                  <tr className="border-b border-stroke">
                    <th className="sticky left-0 z-10 bg-surface text-left px-3 py-1.5 text-caption font-normal text-text-secondary">
                      Par
                    </th>
                    {segment.holes.map((hole) => (
                      <th
                        key={hole}
                        className="px-2 py-1.5 text-center text-caption font-normal text-text-secondary"
                      >
                        {holeAt(snapshot.course, hole)?.par ?? '–'}
                      </th>
                    ))}
                    <th className="px-3 py-1.5 text-center text-caption font-normal text-text-secondary">
                      {parOver(snapshot.course, segment.holes)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.players.map((player) => {
                    const total = segment.holes.reduce(
                      (sum, hole) => sum + (session.strokesFor(player.id, hole) ?? 0),
                      0,
                    );
                    return (
                      <tr key={player.id} className="border-b border-stroke last:border-0">
                        <th className="sticky left-0 z-10 bg-surface text-left px-3 py-2 font-normal max-w-[7rem]">
                          <span className="block truncate text-body">
                            {session.emojiFor(player.id)}{' '}
                            {player.name.split(' ')[0]}
                          </span>
                        </th>
                        {segment.holes.map((hole) => {
                          const strokes = session.strokesFor(player.id, hole);
                          const par = holeAt(snapshot.course, hole)?.par ?? 4;
                          return (
                            <td
                              key={hole}
                              className={`px-2 py-2 text-center ${cellStyle(strokes, par)}`}
                            >
                              {strokes ?? '·'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center font-bold">
                          {total > 0 ? total : '–'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <RoundTotals session={session} />
      </div>
    </Screen>
  );
}

function RoundTotals({ session }: { session: RoundSession }) {
  const { round, snapshot } = session;
  const coursePar = parOver(snapshot.course, round.holeNumbers);

  return (
    <div>
      <div className="text-caption uppercase tracking-wider text-text-secondary mb-2 px-1">
        Round · par {coursePar}
      </div>
      <div className="card divide-y divide-stroke">
        {snapshot.players.map((player) => {
          let gross = 0;
          let played = 0;
          let parPlayed = 0;
          for (const hole of round.holeNumbers) {
            const strokes = session.strokesFor(player.id, hole);
            if (strokes === null) continue;
            gross += strokes;
            played += 1;
            parPlayed += holeAt(snapshot.course, hole)?.par ?? 0;
          }
          const toPar = gross - parPlayed;
          const withdrawn = round.withdrawals[player.id] !== undefined;

          return (
            <div key={player.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-title">{session.emojiFor(player.id)}</span>
              <span className="flex-1 min-w-0 truncate text-body">{player.name}</span>
              {withdrawn ? (
                <span className="text-caption text-text-secondary">WD</span>
              ) : (
                <>
                  <span className="text-caption text-text-secondary tnum">
                    thru {played}
                  </span>
                  <span className="tnum text-headline w-10 text-right">
                    {gross > 0 ? gross : '–'}
                  </span>
                  <span
                    className={`tnum text-headline w-10 text-right ${
                      toPar < 0 ? 'text-money' : toPar === 0 ? 'text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    {played === 0 ? '–' : toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : toPar}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
