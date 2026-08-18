import { useState } from 'react';
import { CelebrationOverlay } from '../components/CelebrationOverlay';
import { useWakeLock } from '../hooks/useWakeLock';
import type { StoredRound } from '../data/model';
import { useRoundSession } from '../state/useRoundSession';
import { LiveRoundView } from './LiveRoundView';
import { RecapView } from './RecapView';
import { ScorecardView } from './ScorecardView';
import { SettlementView } from './SettlementView';
import { StandingsView } from './StandingsView';

/**
 * Owns one round's session and switches between its four screens.
 *
 * The session hook lives here rather than in each view so that navigating
 * between the card, standings, and settle-up never tears down the round state
 * or replays celebrations.
 */

type Tab = 'play' | 'card' | 'standings' | 'settle' | 'recap';

export function RoundContainer({
  round,
  myProfileID,
  onExit,
}: {
  round: StoredRound;
  myProfileID: string | null;
  onExit: () => void;
}) {
  const session = useRoundSession(round, myProfileID);
  const [tab, setTab] = useState<Tab>(
    round.status === 'finished' ? 'settle' : 'play',
  );

  // Only hold the screen awake while scores are actually being entered.
  useWakeLock(session.round.status !== 'finished');

  return (
    <>
      {tab === 'play' && (
        <LiveRoundView
          session={session}
          onExit={onExit}
          onOpenScorecard={() => setTab('card')}
          onOpenStandings={() => setTab('standings')}
          onOpenSettle={() => setTab('settle')}
          onOpenRecap={() => setTab('recap')}
        />
      )}
      {tab === 'card' && (
        <ScorecardView session={session} onBack={() => setTab('play')} />
      )}
      {tab === 'recap' && <RecapView session={session} onBack={() => setTab('play')} />}
      {tab === 'standings' && (
        <StandingsView session={session} onBack={() => setTab('play')} />
      )}
      {tab === 'settle' && (
        <SettlementView
          session={session}
          onBack={() => setTab('play')}
          onExit={onExit}
          onFinish={() => {
            session.finishRound();
            onExit();
          }}
        />
      )}

      <CelebrationOverlay
        celebration={session.celebration}
        onSkip={session.skipCelebration}
      />
    </>
  );
}
