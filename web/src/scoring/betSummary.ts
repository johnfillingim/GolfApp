import { describeMoney } from './money';
import { junkLabel } from './types';
import type {
  Bet,
  HandicapAllowance,
  HandicapMode,
  PlayerID,
  ScoringPlayer,
} from './types';

/**
 * Renders every bet as one plain-English sentence, shown in round setup so the
 * whole group agrees on the rules *before* anyone tees off.
 */
export function describeBet(bet: Bet, players: ScoringPlayer[]): string {
  const names: Record<PlayerID, string> = {};
  for (const player of players) {
    if (!(player.id in names)) names[player.id] = player.name;
  }

  const name = (id: PlayerID): string => names[id] ?? '?';

  const list = (ids: PlayerID[]): string => {
    switch (ids.length) {
      case 0:
        return 'nobody';
      case 1:
        return name(ids[0]!);
      case 2:
        return `${name(ids[0]!)} & ${name(ids[1]!)}`;
      default: {
        const head = ids.slice(0, -1).map(name).join(', ');
        return `${head} & ${name(ids[ids.length - 1]!)}`;
      }
    }
  };

  const scoringText = (mode: HandicapMode, allowance?: HandicapAllowance): string => {
    if (mode === 'gross') return 'gross';
    return allowance === 'offLow' ? 'net (strokes off the low ball)' : 'net';
  };

  const capitalize = (text: string): string =>
    text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);

  switch (bet.kind.type) {
    case 'nassau': {
      const config = bet.kind.config;
      let text = `${describeMoney(config.stakePerPlayer)} Nassau (front, back, and overall), `;
      text += `${scoringText(config.handicapMode, config.allowance)} — `;
      text += `${list(config.sideA)} vs ${list(config.sideB)}.`;
      if (config.autoPressTrigger != null) {
        text += ` Auto-press when a side goes ${config.autoPressTrigger} down.`;
      } else {
        text += ' Presses by agreement.';
      }
      return text;
    }

    case 'skins': {
      const config = bet.kind.config;
      let text = `${describeMoney(config.stakePerHole)} skins per hole from each player, ${scoringText(config.handicapMode)} — ${list(config.players)}.`;
      text += config.carryover ? ' Ties carry over.' : ' Ties are no skin.';
      if (config.requireValidation) {
        text += ' Skins must be par or better.';
      }
      return text;
    }

    case 'matchPlay': {
      const config = bet.kind.config;
      return (
        `${describeMoney(config.stakePerPlayer)} match play, ` +
        `${scoringText(config.handicapMode, config.allowance)} — ` +
        `${list(config.sideA)} vs ${list(config.sideB)}. ` +
        'Match closes when mathematically decided.'
      );
    }

    case 'wolf': {
      const config = bet.kind.config;
      let text = `Wolf at ${describeMoney(config.stakePerHole)} a point, ${scoringText(config.handicapMode)} — order: ${list(config.rotation)}. `;
      text += `Lone wolf ${config.loneMultiplier}×, blind wolf ${config.blindMultiplier}×.`;
      text += config.carryTies ? ' Halved holes carry.' : ' Halved holes push.';
      return text;
    }

    case 'strokePlay': {
      const config = bet.kind.config;
      const pot = config.ante * config.players.length;
      return (
        `${capitalize(scoringText(config.handicapMode))} stroke play, ${describeMoney(config.ante)} each — ` +
        `${list(config.players)}. Low round takes the ${describeMoney(pot)} pot; ties split.`
      );
    }

    case 'snake': {
      const config = bet.kind.config;
      let text = `Snake at ${describeMoney(config.stakePerPlayer)} — ${list(config.players)}. `;
      text += `A ${config.threePuttThreshold}-putt hands it over; whoever holds it at the end pays everyone.`;
      if (config.growPerPass) text += ' The value grows on every pass.';
      return text;
    }

    case 'vegas': {
      const config = bet.kind.config;
      let text = `Vegas at ${describeMoney(config.stakePerPoint)} a point, ${scoringText(config.handicapMode, config.allowance)} — `;
      text += `${list(config.sideA)} vs ${list(config.sideB)}. Scores pair into one number, low digit first.`;
      if (config.flipOnBirdie) text += ' A birdie flips the other side’s number.';
      return text;
    }

    case 'ninePoint': {
      const config = bet.kind.config;
      return (
        `Nine Point at ${describeMoney(config.pointValue)} a point, ${scoringText(config.handicapMode)} — ` +
        `${list(config.players)}. Five for the best score each hole, three for the middle, one for the worst; ties split.`
      );
    }

    case 'sixes': {
      const config = bet.kind.config;
      return (
        `Sixes at ${describeMoney(config.stakePerPlayer)} a segment, ${scoringText(config.handicapMode, config.allowance)} — ` +
        `${list(config.players)}. Partners rotate every six holes so everyone plays with everyone.`
      );
    }

    case 'splitSixes': {
      const config = bet.kind.config;
      return (
        `Split Sixes at ${describeMoney(config.pointValue)} a point, ${scoringText(config.handicapMode)} — ` +
        `${list(config.players)}. Four for the best score each hole, two for the middle, none for the worst; ties split.`
      );
    }

    case 'scotch': {
      const config = bet.kind.config;
      let text = `Scotch at ${describeMoney(config.pointValue)} a point, ${scoringText(config.handicapMode, config.allowance)} — `;
      text += `${list(config.sideA)} vs ${list(config.sideB)}. A point each for low ball, low total, and a birdie.`;
      if (config.doubleOnSweep) text += ' Sweeping the hole doubles it.';
      return text;
    }

    case 'junk': {
      const config = bet.kind.config;
      const items = config.enabled.map(junkLabel).join(', ');
      return (
        `Junk at ${describeMoney(config.stakePerItem)} from each player — ${list(config.players)}. ` +
        `Playing for: ${items || 'nothing selected yet'}.`
      );
    }

    case 'quota': {
      const config = bet.kind.config;
      return (
        `Quota at ${describeMoney(config.pointValue)} a point — ${list(config.players)}. ` +
        `Everyone starts at ${config.quotaBase} minus their handicap and earns points per hole; how far over or under you finish is what pays.`
      );
    }
  }
}
