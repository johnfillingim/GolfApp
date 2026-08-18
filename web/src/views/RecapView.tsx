import { useMemo } from 'react';
import { Card, EmptyState, Screen } from '../components/ui';
import { buildNarrative, narrativeAmount, narrativeByHole } from '../scoring';
import type { RoundSession } from '../state/useRoundSession';

/**
 * The round in plain language, hole by hole.
 *
 * This is the answer to "what actually happened out there" — the question a
 * settlement table can't answer. Every line is derived from the same evaluation
 * data as the money, so the story and the numbers can never disagree.
 */
export function RecapView({
  session,
  onBack,
}: {
  session: RoundSession;
  onBack: () => void;
}) {
  const groups = useMemo(
    () => narrativeByHole(buildNarrative(session.snapshot, session.evaluations)),
    [session.snapshot, session.evaluations],
  );

  return (
    <Screen title="Recap" subtitle={session.round.course.name} onBack={onBack}>
      {groups.length === 0 ? (
        <EmptyState
          emoji="📖"
          title="Nothing to tell yet"
          message="Once scores go in, the story of the round shows up here."
        />
      ) : (
        <div className="p-4 space-y-4">
          {groups.map((group) => (
            <div key={group.hole ?? 'round'}>
              <div className="text-caption uppercase tracking-wider text-text-secondary mb-2 px-1">
                {group.hole === null ? 'End of round' : `Hole ${group.hole}`}
              </div>
              <Card className="divide-y divide-stroke">
                {group.entries.map((entry) => {
                  const amount = narrativeAmount(entry);
                  return (
                    <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                      <span
                        className={`flex-1 min-w-0 ${
                          entry.weight === 'major'
                            ? 'text-body text-text-primary'
                            : entry.weight === 'minor'
                              ? 'text-caption text-text-secondary'
                              : 'text-body text-text-secondary'
                        }`}
                      >
                        {entry.text}
                      </span>
                      {amount && (
                        <span className="tnum text-caption text-money shrink-0 pt-1">
                          {amount}
                        </span>
                      )}
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
