/** Rule configuration. Defaults follow the common "Tenhou / Mahjong Soul" ruleset. */
export interface RuleConfig {
  /** `east` = tonpuusen (East only), `south` = hanchan (East + South). */
  length: "east" | "south";
  startingPoints: number;
  /** Points returned at the end of the game (oka), usually 30000. */
  returnPoints: number;
  /** Placement bonus in 1000 point units, from 1st to 4th. */
  uma: [number, number, number, number];
  /** Number of red fives (0 = none, 3 = one per suit). */
  akaCount: 0 | 3;
  /** Open tanyao allowed. */
  kuitan: boolean;
  /** Double riichi enabled. */
  doubleRiichi: boolean;
  /** Only the closest player to the discarder may ron (head bump). */
  atamahane: boolean;
  /** Three players calling ron on the same tile aborts the hand. */
  sanchahou: boolean;
  /** Four identical wind discards in the first go-around abort the hand. */
  suufonRenda: boolean;
  /** Four riichi declarations abort the hand. */
  suuchaRiichi: boolean;
  /** Four kans by two or more players abort the hand. */
  suukaikan: boolean;
  /** Nine terminals/honors abort on the very first turn. */
  kyuushuKyuuhai: boolean;
  /** Nagashi mangan is scored at an exhaustive draw. */
  nagashiMangan: boolean;
  /** Game ends as soon as a player goes below zero. */
  tobi: boolean;
  /** Dealer may end the game after winning / staying tenpai in the last hand. */
  agariYame: boolean;
  /** Ankan while in riichi is restricted to draws that do not change the wait. */
  strictRiichiAnkan: boolean;
  /** Riichi requires at least 1000 points. */
  riichiRequiresPoints: boolean;
  /** Noten penalty distributed at an exhaustive draw. */
  notenPenalty: number;
  /** Points paid per honba counter (per player for tsumo). */
  honbaPoints: number;
  /** Multiple yakuman stack (e.g. suuankou tanki = double yakuman). */
  doubleYakuman: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  length: "south",
  startingPoints: 25000,
  returnPoints: 30000,
  uma: [15, 5, -5, -15],
  akaCount: 3,
  kuitan: true,
  doubleRiichi: true,
  atamahane: false,
  sanchahou: true,
  suufonRenda: true,
  suuchaRiichi: true,
  suukaikan: true,
  kyuushuKyuuhai: true,
  nagashiMangan: true,
  tobi: true,
  agariYame: true,
  strictRiichiAnkan: true,
  riichiRequiresPoints: true,
  notenPenalty: 3000,
  honbaPoints: 300,
  doubleYakuman: true,
};

export function makeRules(overrides: Partial<RuleConfig> = {}): RuleConfig {
  return { ...DEFAULT_RULES, ...overrides };
}

/** Number of hands in a full rotation for the configured length (before extra rounds). */
export function roundsInGame(rules: RuleConfig): number {
  return rules.length === "east" ? 4 : 8;
}
