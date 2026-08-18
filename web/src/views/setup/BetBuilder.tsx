import { useState } from 'react';
import { Button, Card, Chip, SectionTitle, Toggle } from '../../components/ui';
import type { RoundPlayerRecord } from '../../data/model';
import {
  dollars,
  type Bet,
  type BetType,
  type HandicapMode,
  type PlayerID,
} from '../../scoring';

/**
 * Bet configuration, ported from `BetBuilderView.swift`.
 *
 * Defaults are the conventions most groups actually play, so the common case is
 * "pick a format, pick a stake, add" — every other control is there for the
 * group that argues about it.
 */

const FORMATS: { type: BetType; label: string; blurb: string }[] = [
  { type: 'nassau', label: 'Nassau', blurb: 'Front, back, overall — plus presses' },
  { type: 'skins', label: 'Skins', blurb: 'Low score on a hole takes the pot' },
  { type: 'matchPlay', label: 'Match play', blurb: 'Holes up and down, closes early' },
  { type: 'wolf', label: 'Wolf', blurb: 'Rotating captain picks a partner or goes alone' },
  { type: 'strokePlay', label: 'Stroke play', blurb: 'Everyone antes, low round wins' },
];

const STAKES = [1, 2, 5, 10, 20];

export function BetBuilder({
  players,
  onAdd,
}: {
  players: RoundPlayerRecord[];
  onAdd: (bet: Bet) => void;
}) {
  const [format, setFormat] = useState<BetType>('nassau');
  const [stake, setStake] = useState(5);
  const [mode, setMode] = useState<HandicapMode>('net');
  const [autoPress, setAutoPress] = useState(true);
  const [carryover, setCarryover] = useState(true);
  const [validation, setValidation] = useState(false);
  const [carryTies, setCarryTies] = useState(false);
  const [sideA, setSideA] = useState<PlayerID[]>([]);

  const allIDs = players.map((p) => p.id);
  const needsSides = format === 'nassau' || format === 'matchPlay';
  const sideB = allIDs.filter((id) => !sideA.includes(id));
  const sidesValid = !needsSides || (sideA.length > 0 && sideB.length > 0);

  const toggleSide = (id: PlayerID) => {
    setSideA(sideA.includes(id) ? sideA.filter((s) => s !== id) : [...sideA, id]);
  };

  const build = (): Bet | null => {
    const id = crypto.randomUUID();
    const stakeCents = dollars(stake);

    switch (format) {
      case 'nassau':
        if (!sidesValid) return null;
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
        if (!sidesValid) return null;
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
    }
  };

  const add = () => {
    const bet = build();
    if (!bet) return;
    onAdd(bet);
    setSideA([]);
  };

  return (
    <div className="space-y-4">
      <SectionTitle>Add a bet</SectionTitle>

      <Card className="divide-y divide-stroke">
        {FORMATS.map((option) => (
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
              <span className="block text-body">{option.label}</span>
              <span className="block text-caption text-text-secondary">
                {option.blurb}
              </span>
            </span>
          </button>
        ))}
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <div className="text-caption text-text-secondary mb-2">
            {format === 'strokePlay'
              ? 'Ante per player'
              : format === 'skins' || format === 'wolf'
                ? 'Stake per hole'
                : 'Stake per player'}
          </div>
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

        <Button onClick={add} disabled={!sidesValid || players.length < 2}>
          Add bet
        </Button>
      </Card>
    </div>
  );
}
