import { useState } from 'react';
import { Button, Card, Chip, SectionTitle, Toggle } from '../../components/ui';
import type { RoundPlayerRecord } from '../../data/model';
import {
  dollars,
  junkLabel,
  JUNK_KINDS,
  type Bet,
  type BetType,
  type HandicapMode,
  type JunkKind,
  type PlayerID,
} from '../../scoring';

/**
 * Bet configuration.
 *
 * Defaults are the conventions most groups actually play, so the common case is
 * "pick a format, pick a stake, add" — every other control is there for the
 * group that argues about it.
 *
 * Formats that only work at a specific table size say so and disable themselves
 * rather than silently producing nonsense: Sixes needs exactly four, the
 * three-ball points games need exactly three, and the team games need two sides.
 */

interface FormatSpec {
  type: BetType;
  label: string;
  blurb: string;
  /** Player counts this format can be played with; empty means any. */
  requires?: (count: number) => boolean;
  requirement?: string;
}

const FORMATS: FormatSpec[] = [
  { type: 'nassau', label: 'Nassau', blurb: 'Front, back, overall — plus presses' },
  { type: 'skins', label: 'Skins', blurb: 'Low score on a hole takes the pot' },
  { type: 'matchPlay', label: 'Match play', blurb: 'Holes up and down, closes early' },
  { type: 'wolf', label: 'Wolf', blurb: 'Rotating captain picks a partner or goes alone' },
  { type: 'strokePlay', label: 'Stroke play', blurb: 'Everyone antes, low round wins' },
  { type: 'snake', label: 'Snake', blurb: 'Three-putt penalty; last one holding pays' },
  {
    type: 'vegas',
    label: 'Vegas',
    blurb: 'Two-on-two, scores paired into one number',
    requires: (n) => n === 4,
    requirement: 'four players',
  },
  {
    type: 'ninePoint',
    label: 'Nine Point',
    blurb: '5/3/1 a hole among three players',
    requires: (n) => n === 3,
    requirement: 'three players',
  },
  {
    type: 'sixes',
    label: 'Sixes',
    blurb: 'Partners rotate every six holes',
    requires: (n) => n === 4,
    requirement: 'four players',
  },
  {
    type: 'splitSixes',
    label: 'Split Sixes',
    blurb: '4/2/0 a hole among three players',
    requires: (n) => n === 3,
    requirement: 'three players',
  },
  {
    type: 'scotch',
    label: 'Scotch',
    blurb: 'Team points: low ball, low total, birdie',
    requires: (n) => n === 4,
    requirement: 'four players',
  },
  { type: 'junk', label: 'Junk', blurb: 'Greenies, sandies, barkies — claimed as you go' },
  { type: 'quota', label: 'Quota', blurb: 'Points against a handicap target' },
];

const STAKES = [1, 2, 5, 10, 20];

export function BetBuilder({
  players,
  holeCount,
  onAdd,
}: {
  players: RoundPlayerRecord[];
  holeCount: number;
  onAdd: (bet: Bet) => void;
}) {
  const [format, setFormat] = useState<BetType>('nassau');
  const [stake, setStake] = useState(5);
  const [mode, setMode] = useState<HandicapMode>('net');
  const [autoPress, setAutoPress] = useState(true);
  const [carryover, setCarryover] = useState(true);
  const [validation, setValidation] = useState(false);
  const [carryTies, setCarryTies] = useState(false);
  const [growPerPass, setGrowPerPass] = useState(true);
  const [flipOnBirdie, setFlipOnBirdie] = useState(true);
  const [doubleOnSweep, setDoubleOnSweep] = useState(true);
  const [junkKinds, setJunkKinds] = useState<JunkKind[]>(['greenie', 'sandy', 'barkie']);
  const [sideA, setSideA] = useState<PlayerID[]>([]);

  const allIDs = players.map((p) => p.id);
  const needsSides =
    format === 'nassau' ||
    format === 'matchPlay' ||
    format === 'vegas' ||
    format === 'scotch';
  const sideB = allIDs.filter((id) => !sideA.includes(id));
  const sidesValid = !needsSides || (sideA.length > 0 && sideB.length > 0);

  const spec = FORMATS.find((f) => f.type === format)!;
  const countOK = spec.requires ? spec.requires(players.length) : players.length >= 2;
  const canAdd = sidesValid && countOK;

  const toggleSide = (id: PlayerID) => {
    setSideA(sideA.includes(id) ? sideA.filter((s) => s !== id) : [...sideA, id]);
  };

  const toggleJunk = (kind: JunkKind) => {
    setJunkKinds(
      junkKinds.includes(kind)
        ? junkKinds.filter((k) => k !== kind)
        : [...junkKinds, kind],
    );
  };

  const build = (): Bet | null => {
    const id = crypto.randomUUID();
    const stakeCents = dollars(stake);
    if (!canAdd) return null;

    switch (format) {
      case 'nassau':
        return {
          id,
          name: `$${stake} Nassau`,
          kind: {
            type: 'nassau',
            config: {
              sideA,
              sideB,
              stakePerPlayer: stakeCents,
              handicapMode: mode,
              allowance: 'offLow',
              autoPressTrigger: autoPress ? 2 : null,
            },
          },
        };
      case 'matchPlay':
        return {
          id,
          name: `$${stake} match`,
          kind: {
            type: 'matchPlay',
            config: {
              sideA,
              sideB,
              stakePerPlayer: stakeCents,
              handicapMode: mode,
              allowance: 'offLow',
            },
          },
        };
      case 'skins':
        return {
          id,
          name: `$${stake} skins`,
          kind: {
            type: 'skins',
            config: {
              players: allIDs,
              stakePerHole: stakeCents,
              handicapMode: mode,
              carryover,
              requireValidation: validation,
            },
          },
        };
      case 'wolf':
        return {
          id,
          name: `$${stake} wolf`,
          kind: {
            type: 'wolf',
            config: {
              rotation: allIDs,
              stakePerHole: stakeCents,
              handicapMode: mode,
              loneMultiplier: 2,
              blindMultiplier: 3,
              carryTies,
            },
          },
        };
      case 'strokePlay':
        return {
          id,
          name: `$${stake} pot`,
          kind: {
            type: 'strokePlay',
            config: { players: allIDs, ante: stakeCents, handicapMode: mode },
          },
        };
      case 'snake':
        return {
          id,
          name: `$${stake} snake`,
          kind: {
            type: 'snake',
            config: {
              players: allIDs,
              stakePerPlayer: stakeCents,
              threePuttThreshold: 3,
              growPerPass,
            },
          },
        };
      case 'vegas':
        return {
          id,
          name: `$${stake} Vegas`,
          kind: {
            type: 'vegas',
            config: {
              sideA,
              sideB,
              stakePerPoint: stakeCents,
              handicapMode: mode,
              allowance: 'offLow',
              flipOnBirdie,
            },
          },
        };
      case 'ninePoint':
        return {
          id,
          name: `$${stake} nine point`,
          kind: {
            type: 'ninePoint',
            config: { players: allIDs, pointValue: stakeCents, handicapMode: mode },
          },
        };
      case 'sixes':
        return {
          id,
          name: `$${stake} sixes`,
          kind: {
            type: 'sixes',
            config: {
              players: allIDs,
              stakePerPlayer: stakeCents,
              handicapMode: mode,
              allowance: 'offLow',
            },
          },
        };
      case 'splitSixes':
        return {
          id,
          name: `$${stake} split sixes`,
          kind: {
            type: 'splitSixes',
            config: { players: allIDs, pointValue: stakeCents, handicapMode: mode },
          },
        };
      case 'scotch':
        return {
          id,
          name: `$${stake} scotch`,
          kind: {
            type: 'scotch',
            config: {
              sideA,
              sideB,
              pointValue: stakeCents,
              handicapMode: mode,
              allowance: 'offLow',
              doubleOnSweep,
            },
          },
        };
      case 'junk':
        return {
          id,
          name: `$${stake} junk`,
          kind: {
            type: 'junk',
            config: {
              players: allIDs,
              stakePerItem: stakeCents,
              enabled: junkKinds,
            },
          },
        };
      case 'quota':
        return {
          id,
          name: `$${stake} quota`,
          kind: {
            type: 'quota',
            config: {
              players: allIDs,
              pointValue: stakeCents,
              // 36 points over 18 holes is the standard target; a nine-hole
              // round halves it so the handicap subtraction still makes sense.
              quotaBase: holeCount <= 9 ? 18 : 36,
            },
          },
        };
    }
  };

  const add = () => {
    const bet = build();
    if (!bet) return;
    onAdd(bet);
    setSideA([]);
  };

  const stakeLabel =
    format === 'strokePlay'
      ? 'Ante per player'
      : format === 'skins' || format === 'wolf'
        ? 'Stake per hole'
        : format === 'ninePoint' || format === 'splitSixes' || format === 'scotch' || format === 'quota'
          ? 'Value per point'
          : format === 'vegas'
            ? 'Stake per point'
            : format === 'junk'
              ? 'Stake per claim'
              : 'Stake per player';

  const usesHandicapMode = format !== 'snake' && format !== 'junk' && format !== 'quota';

  return (
    <div className="space-y-4">
      <SectionTitle>Add a bet</SectionTitle>

      <Card className="divide-y divide-stroke">
        {FORMATS.map((option) => {
          const ok = option.requires ? option.requires(players.length) : true;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => setFormat(option.type)}
              className="tap w-full flex items-center gap-3 px-4 py-3 text-left active:bg-raised"
            >
              <span
                className={`shrink-0 w-5 h-5 rounded-full border-2 ${
                  format === option.type ? 'bg-primary border-primary' : 'border-stroke'
                }`}
                aria-hidden="true"
              />
              <span className="flex-1 min-w-0">
                <span className={`block text-body ${ok ? '' : 'text-text-secondary'}`}>
                  {option.label}
                </span>
                <span className="block text-caption text-text-secondary">
                  {ok ? option.blurb : `Needs ${option.requirement}`}
                </span>
              </span>
            </button>
          );
        })}
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <div className="text-caption text-text-secondary mb-2">{stakeLabel}</div>
          <div className="flex flex-wrap gap-2">
            {STAKES.map((amount) => (
              <Chip
                key={amount}
                selected={stake === amount}
                onClick={() => setStake(amount)}
              >
                ${amount}
              </Chip>
            ))}
          </div>
        </div>

        {usesHandicapMode && (
          <div>
            <div className="text-caption text-text-secondary mb-2">Scoring</div>
            <div className="flex gap-2">
              <Chip selected={mode === 'net'} onClick={() => setMode('net')}>
                Net
              </Chip>
              <Chip selected={mode === 'gross'} onClick={() => setMode('gross')}>
                Gross
              </Chip>
            </div>
          </div>
        )}

        {needsSides && (
          <div>
            <div className="text-caption text-text-secondary mb-2">
              Tap the players on one side
            </div>
            <div className="flex flex-wrap gap-2">
              {players.map((player) => (
                <Chip
                  key={player.id}
                  selected={sideA.includes(player.id)}
                  onClick={() => toggleSide(player.id)}
                >
                  {player.emoji} {player.name.split(' ')[0]}
                </Chip>
              ))}
            </div>
            {!sidesValid && (
              <p className="text-caption text-down mt-2">
                Both sides need at least one player.
              </p>
            )}
          </div>
        )}

        {format === 'nassau' && (
          <Toggle
            label="Auto-press at 2 down"
            hint="Opens a new bet on the next hole, the classic cascade"
            checked={autoPress}
            onChange={setAutoPress}
          />
        )}

        {format === 'skins' && (
          <>
            <Toggle
              label="Ties carry over"
              hint="A halved hole adds its skin to the next one"
              checked={carryover}
              onChange={setCarryover}
            />
            <Toggle
              label="Must be par or better"
              hint="A skin won with a bogey doesn't count"
              checked={validation}
              onChange={setValidation}
            />
          </>
        )}

        {format === 'wolf' && (
          <Toggle
            label="Halved holes carry"
            hint="Doubles the next hole instead of pushing"
            checked={carryTies}
            onChange={setCarryTies}
          />
        )}

        {format === 'snake' && (
          <Toggle
            label="Value grows on every pass"
            hint="Picking it up late is what everyone's afraid of"
            checked={growPerPass}
            onChange={setGrowPerPass}
          />
        )}

        {format === 'vegas' && (
          <Toggle
            label="Birdies flip the other number"
            hint="A 56 becomes a 65 — where the big swings come from"
            checked={flipOnBirdie}
            onChange={setFlipOnBirdie}
          />
        )}

        {format === 'scotch' && (
          <Toggle
            label="Sweeping doubles the hole"
            hint="The umbrella: take every category, double the points"
            checked={doubleOnSweep}
            onChange={setDoubleOnSweep}
          />
        )}

        {format === 'junk' && (
          <div>
            <div className="text-caption text-text-secondary mb-2">
              What are you playing for?
            </div>
            <div className="flex flex-wrap gap-2">
              {JUNK_KINDS.map((kind) => (
                <Chip
                  key={kind}
                  selected={junkKinds.includes(kind)}
                  onClick={() => toggleJunk(kind)}
                >
                  {junkLabel(kind)}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {format === 'snake' && (
          <p className="text-caption text-text-secondary">
            Snake reads putts, so tap the putts field on the score screen — a hole
            with no putt count can't move it.
          </p>
        )}

        {!countOK && (
          <p className="text-caption text-down">
            {spec.label} needs {spec.requirement}; this round has {players.length}.
          </p>
        )}

        <Button onClick={add} disabled={!canAdd}>
          Add bet
        </Button>
      </Card>
    </div>
  );
}
