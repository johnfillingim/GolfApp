import { useState } from 'react';
import { Button, Card, Chip, Screen, SectionTitle } from '../../components/ui';
import {
  COURSES,
  courseInfoFrom,
  totalPar,
  totalYards,
  type CatalogCourse,
} from '../../data/courses';
import { saveProfile } from '../../data/db';
import {
  playingHandicap,
  type PlayerProfile,
  type RoundPlayerRecord,
  type StoredRound,
} from '../../data/model';
import { describeBet, emptyEvents, type Bet, type ScoringPlayer } from '../../scoring';
import { BetBuilder } from './BetBuilder';

/**
 * Round setup, ported from `NewRoundFlow.swift`.
 *
 * Three steps — course, players, bets — because the group is standing on the
 * first tee and every extra screen is a minute nobody wants to spend. Bets are
 * summarized in plain English before the round starts, which is the whole point:
 * the argument about the rules should happen now, not on 17.
 */

type Step = 'course' | 'players' | 'bets';

const EMOJI_CHOICES = ['⛳️', '🏌️', '🦅', '🐦', '🐺', '🎯', '🍺', '🔥', '💰', '🧢'];

export function NewRoundFlow({
  profiles,
  onCancel,
  onStart,
  onProfilesChanged,
}: {
  profiles: PlayerProfile[];
  onCancel: () => void;
  onStart: (round: StoredRound) => void;
  onProfilesChanged: () => void;
}) {
  const [step, setStep] = useState<Step>('course');
  const [course, setCourse] = useState<CatalogCourse>(COURSES[0]!);
  const [nine, setNine] = useState<'all' | 'front' | 'back'>('all');
  const [selectedIDs, setSelectedIDs] = useState<string[]>(
    profiles.filter((p) => p.isMe).map((p) => p.id),
  );
  const [bets, setBets] = useState<Bet[]>([]);

  const holeNumbers = (() => {
    const all = course.holes.map((h) => h.number);
    if (nine === 'front') return all.filter((n) => n <= 9);
    if (nine === 'back') return all.filter((n) => n > 9);
    return all;
  })();

  // A just-added player is selected before the reloaded profile list arrives,
  // so a selected ID can briefly have no profile behind it. Drop those rather
  // than indexing into thin air.
  const roundPlayers: RoundPlayerRecord[] = selectedIDs
    .map((id) => profiles.find((p) => p.id === id))
    .filter((profile): profile is PlayerProfile => profile !== undefined)
    .map((profile, index) => ({
      id: crypto.randomUUID(),
      profileID: profile.id,
      name: profile.name,
      emoji: profile.emoji,
      playingHandicap: playingHandicap(profile, holeNumbers.length),
      teeOrder: index,
    }));

  // Player identities have to be stable across the bets step, or every bet
  // would reference IDs that get regenerated on the next render.
  const [lockedPlayers, setLockedPlayers] = useState<RoundPlayerRecord[] | null>(null);
  const players = lockedPlayers ?? roundPlayers;

  const scoringPlayers: ScoringPlayer[] = players.map((p) => ({
    id: p.id,
    name: p.name,
    playingHandicap: p.playingHandicap,
  }));

  const start = () => {
    const round: StoredRound = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'live',
      courseID: course.id,
      course,
      holeNumbers,
      players,
      scores: {},
      bets,
      events: emptyEvents(),
      withdrawals: {},
      settlementMarks: [],
      firedCelebrations: [],
    };
    onStart(round);
  };

  if (step === 'course') {
    return (
      <Screen
        title="New round"
        subtitle="Step 1 of 3 · Course"
        onBack={onCancel}
        footer={
          <Button size="lg" onClick={() => setStep('players')}>
            Next — players
          </Button>
        }
      >
        <div className="p-4 space-y-4">
          <SectionTitle>Course</SectionTitle>
          <Card className="divide-y divide-stroke">
            {COURSES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setCourse(option);
                  if (option.holes.length <= 9) setNine('all');
                }}
                className="tap w-full flex items-center gap-3 px-4 py-3 text-left active:bg-raised"
              >
                <span
                  className={`shrink-0 w-5 h-5 rounded-full border-2 ${
                    course.id === option.id
                      ? 'bg-fairway border-fairway'
                      : 'border-stroke'
                  }`}
                  aria-hidden="true"
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-body truncate">{option.name}</span>
                  <span className="block text-caption text-text-secondary">
                    {option.location} · par {totalPar(option)} ·{' '}
                    {totalYards(option).toLocaleString()} yds
                  </span>
                </span>
              </button>
            ))}
          </Card>

          {course.holes.length > 9 && (
            <>
              <SectionTitle>Holes</SectionTitle>
              <div className="flex gap-2">
                <Chip selected={nine === 'all'} onClick={() => setNine('all')}>
                  All 18
                </Chip>
                <Chip selected={nine === 'front'} onClick={() => setNine('front')}>
                  Front 9
                </Chip>
                <Chip selected={nine === 'back'} onClick={() => setNine('back')}>
                  Back 9
                </Chip>
              </div>
            </>
          )}
        </div>
      </Screen>
    );
  }

  if (step === 'players') {
    return (
      <PlayersStep
        profiles={profiles}
        selectedIDs={selectedIDs}
        setSelectedIDs={setSelectedIDs}
        readyCount={roundPlayers.length}
        onProfilesChanged={onProfilesChanged}
        onBack={() => setStep('course')}
        onNext={() => {
          setLockedPlayers(roundPlayers);
          setStep('bets');
        }}
      />
    );
  }

  return (
    <Screen
      title="Bets"
      subtitle="Step 3 of 3 · Agree before you tee off"
      onBack={() => {
        setLockedPlayers(null);
        setStep('players');
      }}
      footer={
        <Button size="lg" onClick={start}>
          {bets.length === 0 ? 'Start round (no bets)' : `Start round · ${bets.length} bet${bets.length === 1 ? '' : 's'}`}
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {bets.length > 0 && (
          <>
            <SectionTitle>On the card</SectionTitle>
            <Card className="divide-y divide-stroke">
              {bets.map((bet) => (
                <div key={bet.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-body">{bet.name}</span>
                    <button
                      type="button"
                      onClick={() => setBets(bets.filter((b) => b.id !== bet.id))}
                      className="text-caption text-down shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                  <p className="text-caption text-text-secondary mt-1">
                    {describeBet(bet, scoringPlayers)}
                  </p>
                </div>
              ))}
            </Card>
          </>
        )}

        <BetBuilder players={players} onAdd={(bet) => setBets([...bets, bet])} />
      </div>
    </Screen>
  );
}

function PlayersStep({
  profiles,
  selectedIDs,
  setSelectedIDs,
  readyCount,
  onProfilesChanged,
  onBack,
  onNext,
}: {
  profiles: PlayerProfile[];
  selectedIDs: string[];
  setSelectedIDs: (ids: string[]) => void;
  /** Selected players whose profiles have actually loaded. */
  readyCount: number;
  onProfilesChanged: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI_CHOICES[0]!);
  const [handicap, setHandicap] = useState('');

  const toggle = (id: string) => {
    setSelectedIDs(
      selectedIDs.includes(id)
        ? selectedIDs.filter((s) => s !== id)
        : [...selectedIDs, id],
    );
  };

  const addProfile = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    const parsed = Number.parseFloat(handicap);
    const profile: PlayerProfile = {
      id: crypto.randomUUID(),
      name: trimmed,
      emoji,
      handicapIndex: Number.isFinite(parsed) ? parsed : null,
      isMe: profiles.length === 0,
      createdAt: Date.now(),
    };
    await saveProfile(profile);
    setSelectedIDs([...selectedIDs, profile.id]);
    setName('');
    setHandicap('');
    onProfilesChanged();
  };

  return (
    <Screen
      title="Players"
      subtitle="Step 2 of 3 · Tap in tee order"
      onBack={onBack}
      footer={
        <Button size="lg" onClick={onNext} disabled={readyCount < 2}>
          {readyCount < 2 ? 'Pick at least two players' : 'Next — bets'}
        </Button>
      }
    >
      <div className="p-4 space-y-4">
        {profiles.length > 0 && (
          <>
            <SectionTitle>Who's playing</SectionTitle>
            <Card className="divide-y divide-stroke">
              {profiles.map((profile) => {
                const position = selectedIDs.indexOf(profile.id);
                return (
                  <button
                    key={profile.id}
                    type="button"
                    onClick={() => toggle(profile.id)}
                    className="tap w-full flex items-center gap-3 px-4 py-3 text-left active:bg-raised"
                  >
                    <span
                      className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center text-caption tnum ${
                        position >= 0
                          ? 'bg-fairway border-fairway text-text-onAccent'
                          : 'border-stroke text-transparent'
                      }`}
                    >
                      {position >= 0 ? position + 1 : '0'}
                    </span>
                    <span className="text-title">{profile.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-body truncate">{profile.name}</span>
                      <span className="block text-caption text-text-secondary">
                        {profile.handicapIndex === null
                          ? 'No handicap — plays gross'
                          : `Index ${profile.handicapIndex.toFixed(1)}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </Card>
          </>
        )}

        <SectionTitle>Add someone</SectionTitle>
        <Card className="p-4 space-y-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name"
              className="tap flex-1 min-w-0 bg-raised border border-stroke rounded-button px-3 text-body text-text-primary placeholder:text-text-secondary"
            />
            <input
              value={handicap}
              onChange={(event) => setHandicap(event.target.value)}
              placeholder="Idx"
              inputMode="decimal"
              className="tap w-20 bg-raised border border-stroke rounded-button px-3 text-body text-text-primary placeholder:text-text-secondary text-center"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {EMOJI_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setEmoji(choice)}
                className={`w-11 h-11 rounded-chip border text-title ${
                  emoji === choice ? 'border-fairway bg-fairway/20' : 'border-stroke'
                }`}
              >
                {choice}
              </button>
            ))}
          </div>
          <Button onClick={() => void addProfile()} disabled={name.trim().length === 0}>
            Add player
          </Button>
        </Card>
      </div>
    </Screen>
  );
}

export { courseInfoFrom };
