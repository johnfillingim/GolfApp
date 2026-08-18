import { useCallback, useEffect, useState } from 'react';
import { allProfiles, allRounds, deleteRound, saveRound } from './data/db';
import type { PlayerProfile, StoredRound } from './data/model';
import { HomeView } from './views/HomeView';
import { RoundContainer } from './views/RoundContainer';
import { NewRoundFlow } from './views/setup/NewRoundFlow';

/**
 * App shell. Three destinations — home, setup, a round — held in state rather
 * than a router: there are no URLs worth deep-linking in a single-device app,
 * and skipping the router keeps the install small and the back button
 * predictable.
 */

type Route =
  | { name: 'home' }
  | { name: 'setup' }
  | { name: 'round'; round: StoredRound };

export function App() {
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [rounds, setRounds] = useState<StoredRound[]>([]);
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [loadedRounds, loadedProfiles] = await Promise.all([
      allRounds(),
      allProfiles(),
    ]);
    setRounds(loadedRounds);
    setProfiles(loadedProfiles);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const myProfileID = profiles.find((p) => p.isMe)?.id ?? null;

  const startRound = async (round: StoredRound) => {
    await saveRound(round);
    await refresh();
    setRoute({ name: 'round', round });
  };

  const exitRound = async () => {
    await refresh();
    setRoute({ name: 'home' });
  };

  const removeRound = async (round: StoredRound) => {
    await deleteRound(round.id);
    await refresh();
  };

  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <span className="text-4xl animate-fade-in">⛳️</span>
      </div>
    );
  }

  if (route.name === 'setup') {
    return (
      <NewRoundFlow
        profiles={profiles}
        onCancel={() => setRoute({ name: 'home' })}
        onStart={(round) => void startRound(round)}
        onProfilesChanged={() => void refresh()}
      />
    );
  }

  if (route.name === 'round') {
    return (
      <RoundContainer
        key={route.round.id}
        round={route.round}
        myProfileID={myProfileID}
        onExit={() => void exitRound()}
      />
    );
  }

  return (
    <HomeView
      rounds={rounds}
      onNewRound={() => setRoute({ name: 'setup' })}
      onOpenRound={(round) => setRoute({ name: 'round', round })}
      onDeleteRound={(round) => void removeRound(round)}
    />
  );
}
