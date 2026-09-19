import Riichi from "riichi";

import type { RuleConfig } from "./rules.js";
import {
  doraFromIndicator,
  isAka,
  kindOf,
  kindToNotation,
  sortTiles,
  tileToNotation,
  tilesToNotation,
  type Tile,
} from "./tiles.js";
import type { Meld, Wind, YakuLine } from "./types.js";

export interface ScoreContext {
  /** Concealed tiles without the winning tile. */
  hand: Tile[];
  melds: Meld[];
  winTile: Tile;
  tsumo: boolean;
  seatWind: Wind;
  roundWind: Wind;
  doraIndicators: Tile[];
  /** Only pass ura indicators when the winner declared riichi. */
  uraIndicators: Tile[];
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  /** Last tile of the live wall (tsumo) / last discard (ron). */
  haitei: boolean;
  rinshan: boolean;
  chankan: boolean;
  /** Dealer winning on the first draw (tenhou) or non dealer winning on their first draw (chiihou). */
  blessing: boolean;
  rules: RuleConfig;
}

export interface ScoreResult {
  valid: boolean;
  han: number;
  fu: number;
  /** Total points paid to the winner (before honba and riichi sticks). */
  points: number;
  yakuman: number;
  yaku: YakuLine[];
  limitName: string;
  text: string;
  doraCount: number;
  uraCount: number;
  akaCount: number;
  /** Payment split when winning by tsumo. */
  tsumo: { fromDealer: number; fromNonDealer: number } | null;
  /** Payment by the discarder when winning by ron. */
  ron: number | null;
}

function meldNotation(meld: Meld): string {
  const tiles = sortTiles(meld.tiles);
  if (meld.type === "ankan") {
    // The library encodes a concealed kan with two tiles.
    const aka = tiles.find((tile) => isAka(tile));
    const plain = tiles.find((tile) => !isAka(tile)) ?? tiles[0];
    return tilesToNotation(aka ? [aka, plain] : [tiles[0], tiles[1]]);
  }
  return tilesToNotation(tiles);
}

const YAKUMAN_PATTERN = /^(?:(\d+)倍)?役満$/;

function parseYaku(raw: Record<string, string>): YakuLine[] {
  const lines: YakuLine[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (value === "ダブル役満") {
      lines.push({ name, value, han: 0, yakuman: 2 });
      continue;
    }
    const yakumanMatch = YAKUMAN_PATTERN.exec(value);
    if (yakumanMatch) {
      lines.push({ name, value, han: 0, yakuman: Number(yakumanMatch[1] ?? 1) });
      continue;
    }
    const han = Number.parseInt(value, 10);
    lines.push({ name, value, han: Number.isNaN(han) ? 0 : han, yakuman: 0 });
  }
  return lines;
}

function countMatching(tiles: readonly Tile[], indicators: readonly Tile[]): number {
  if (indicators.length === 0) return 0;
  const doraKinds = indicators.map((tile) => doraFromIndicator(kindOf(tile)));
  let count = 0;
  for (const tile of tiles) {
    for (const kind of doraKinds) if (kindOf(tile) === kind) count += 1;
  }
  return count;
}

/** Build the hand string understood by the `riichi` scoring library. */
export function buildRiichiString(context: ScoreContext): string {
  const concealed = sortTiles(context.hand);
  const winNotation = tileToNotation(context.winTile);
  const sections: string[] = [];

  sections.push(
    context.tsumo
      ? `${tilesToNotation(concealed)}${winNotation}`
      : `${tilesToNotation(concealed)}+${winNotation}`,
  );

  if (context.melds.length > 0) {
    sections.push(context.melds.map(meldNotation).join(""));
  }

  const doraKinds = [
    ...context.doraIndicators.map((tile) => doraFromIndicator(kindOf(tile))),
    ...(context.riichi || context.doubleRiichi
      ? context.uraIndicators.map((tile) => doraFromIndicator(kindOf(tile)))
      : []),
  ];
  if (doraKinds.length > 0) {
    sections.push(`d${doraKinds.map(kindToNotation).join("")}`);
  }

  let flags = "";
  if (context.blessing) flags += "t";
  if (context.doubleRiichi) flags += "w";
  else if (context.riichi) flags += "r";
  if (context.ippatsu) flags += "i";
  if (context.haitei) flags += "h";
  if (context.rinshan || context.chankan) flags += "k";
  flags += `${context.roundWind + 1}${context.seatWind + 1}`;
  sections.push(flags);

  return sections.join("+");
}

export function calculateScore(context: ScoreContext): ScoreResult {
  const notation = buildRiichiString(context);
  const calculator = new Riichi(notation);
  calculator.disableHairi();
  if (context.rules.akaCount === 0) calculator.disableAka();
  if (!context.rules.kuitan) calculator.disableKuitan();
  if (!context.rules.doubleYakuman) calculator.disableWyakuman();

  const result = calculator.calc();
  const allTiles = [...context.hand, context.winTile, ...context.melds.flatMap((m) => m.tiles)];
  const yaku = parseYaku(result.yaku ?? {});
  const yakuman = yaku.reduce((sum, line) => sum + line.yakuman, 0);
  const isDealer = context.seatWind === 0;

  const base: ScoreResult = {
    valid: !result.error && result.isAgari && result.ten > 0,
    han: result.han ?? 0,
    fu: result.fu ?? 0,
    points: result.ten ?? 0,
    yakuman,
    yaku,
    limitName: result.name ?? "",
    text: result.text ?? "",
    doraCount: countMatching(allTiles, context.doraIndicators),
    uraCount:
      context.riichi || context.doubleRiichi
        ? countMatching(allTiles, context.uraIndicators)
        : 0,
    akaCount: allTiles.filter((tile) => isAka(tile)).length,
    tsumo: null,
    ron: null,
  };

  if (!base.valid) return base;

  if (context.tsumo) {
    const payments = isDealer ? result.oya : result.ko;
    base.tsumo = isDealer
      ? { fromDealer: 0, fromNonDealer: payments[0] }
      : { fromDealer: payments[0], fromNonDealer: payments[1] };
  } else {
    const payments = isDealer ? result.oya : result.ko;
    base.ron = payments[0];
  }
  return base;
}

export type LimitLevel = "mangan" | "haneman" | "baiman" | "sanbaiman" | "yakuman";

const LIMIT_BASE: Record<LimitLevel, number> = {
  mangan: 2000,
  haneman: 3000,
  baiman: 4000,
  sanbaiman: 6000,
  yakuman: 8000,
};

/** Points for limit hands, used for rules the scoring library does not cover (nagashi mangan). */
export function limitPayments(
  level: LimitLevel,
  isDealer: boolean,
  tsumo: boolean,
): { total: number; fromDealer: number; fromNonDealer: number } {
  const base = LIMIT_BASE[level];
  if (tsumo) {
    if (isDealer) {
      const each = base * 2;
      return { total: each * 3, fromDealer: 0, fromNonDealer: each };
    }
    return { total: base * 4, fromDealer: base * 2, fromNonDealer: base };
  }
  const total = isDealer ? base * 6 : base * 4;
  return { total, fromDealer: total, fromNonDealer: total };
}
