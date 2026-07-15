import Foundation

/// Renders every bet as one plain-English sentence, shown in round setup so
/// the whole group agrees on the rules *before* anyone tees off.
public enum BetSummary {

    public static func describe(_ bet: Bet, players: [ScoringPlayer]) -> String {
        let names = Dictionary(uniqueKeysWithValues: players.map { ($0.id, $0.name) })

        func name(_ id: PlayerID) -> String {
            names[id] ?? "?"
        }

        func list(_ ids: [PlayerID]) -> String {
            switch ids.count {
            case 0: return "nobody"
            case 1: return name(ids[0])
            case 2: return "\(name(ids[0])) & \(name(ids[1]))"
            default:
                let head = ids.dropLast().map(name).joined(separator: ", ")
                return "\(head) & \(name(ids.last!))"
            }
        }

        func scoringText(_ mode: HandicapMode, allowance: HandicapAllowance? = nil) -> String {
            switch mode {
            case .gross: return "gross"
            case .net: return allowance == .offLow ? "net (strokes off the low ball)" : "net"
            }
        }

        switch bet.kind {
        case .nassau(let config):
            var text = "\(config.stakePerPlayer) Nassau (front, back, and overall), "
            text += "\(scoringText(config.handicapMode, allowance: config.allowance)) — "
            text += "\(list(config.sideA)) vs \(list(config.sideB))."
            if let trigger = config.autoPressTrigger {
                text += " Auto-press when a side goes \(trigger) down."
            } else {
                text += " Presses by agreement."
            }
            return text

        case .skins(let config):
            var text = "\(config.stakePerHole) skins per hole from each player, \(scoringText(config.handicapMode)) — \(list(config.players))."
            text += config.carryover ? " Ties carry over." : " Ties are no skin."
            if config.requireValidation {
                text += " Skins must be par or better."
            }
            return text

        case .matchPlay(let config):
            return "\(config.stakePerPlayer) match play, "
                + "\(scoringText(config.handicapMode, allowance: config.allowance)) — "
                + "\(list(config.sideA)) vs \(list(config.sideB)). "
                + "Match closes when mathematically decided."

        case .wolf(let config):
            var text = "Wolf at \(config.stakePerHole) a point, \(scoringText(config.handicapMode)) — order: \(list(config.rotation)). "
            text += "Lone wolf \(config.loneMultiplier)×, blind wolf \(config.blindMultiplier)×."
            text += config.carryTies ? " Halved holes carry." : " Halved holes push."
            return text

        case .strokePlay(let config):
            let pot = config.ante * config.players.count
            return "\(scoringText(config.handicapMode).capitalized) stroke play, \(config.ante) each — "
                + "\(list(config.players)). Low round takes the \(pot) pot; ties split."
        }
    }
}
