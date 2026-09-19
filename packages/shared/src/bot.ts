import type { MahjongGame } from "./engine.js";
import { shanten, ukeire } from "./shanten.js";
import {
  countKinds,
  isHonor,
  isTerminalOrHonor,
  kindOf,
  TILE_KINDS,
  type Tile,
  type TileKind,
} from "./tiles.js";
import type { Action, Seat } from "./types.js";
import { SEATS } from "./types.js";

/**
 * A compact rule based opponent: tile efficiency (ukeire) for offence, genbutsu / suji
 * based danger estimation for defence and simple yaku heuristics for calls.
 */

export interface BotConfig {
  /** 0 = always folds against threats, 1 = never folds. */
  aggression: number;
  /** Weight applied to the danger of a tile when pushing. */
  safety: number;
}

export const DEFAULT_BOT: BotConfig = { aggression: 0.55, safety: 1.0 };

function unseenCounts(game: MahjongGame, seat: Seat): number[] {
  const counts = new Array<number>(TILE_KINDS).fill(4);
  const me = game.players[seat];
  for (const tile of me.hand) counts[kindOf(tile)] -= 1;
  if (me.drawn !== null) counts[kindOf(me.drawn)] -= 1;
  for (const player of game.players) {
    for (const meld of player.melds) {
      for (const tile of meld.tiles) {
        if (player.seat === seat && meld.type === "ankan") continue;
        counts[kindOf(tile)] -= 1;
      }
    }
    for (const discard of player.discards) counts[kindOf(discard.tile)] -= 1;
  }
  for (const indicator of game.doraIndicators) counts[kindOf(indicator)] -= 1;
  return counts.map((value) => Math.max(0, value));
}

function threatSeats(game: MahjongGame, seat: Seat): Seat[] {
  return SEATS.filter((other) => {
    if (other === seat) return false;
    const player = game.players[other];
    if (player.riichi.declared) return true;
    const openMelds = player.melds.filter((meld) => meld.type !== "ankan").length;
    return openMelds >= 2 && player.discards.length >= 6;
  });
}

function isGenbutsu(game: MahjongGame, threat: Seat, kind: TileKind): boolean {
  return game.players[threat].discards.some((discard) => kindOf(discard.tile) === kind);
}

/** Rough danger value of discarding `kind` against one opponent. */
function dangerAgainst(game: MahjongGame, threat: Seat, kind: TileKind, unseen: number[]): number {
  if (isGenbutsu(game, threat, kind)) return 0;
  const discards = game.players[threat].discards.map((discard) => kindOf(discard.tile));
  if (isHonor(kind)) {
    const left = unseen[kind];
    if (left <= 1) return 0.6;
    if (left === 2) return 1.6;
    return 2.6;
  }
  const rank = kind % 9;
  const suitStart = kind - rank;
  const sujiLow = rank >= 3 && discards.includes(suitStart + rank - 3);
  const sujiHigh = rank <= 5 && discards.includes(suitStart + rank + 3);
  const edge = rank === 0 || rank === 8;
  const nearEdge = rank === 1 || rank === 7;

  let danger = edge ? 2.6 : nearEdge ? 3.6 : 5.2;
  if (rank >= 3 && rank <= 5) danger += 0.6;
  if (edge || nearEdge) {
    if (sujiLow || sujiHigh) danger *= 0.45;
  } else if (sujiLow && sujiHigh) {
    danger *= 0.4;
  } else if (sujiLow || sujiHigh) {
    danger *= 0.8;
  }
  // A kind that is almost gone can only be hit by a shanpon/tanki wait.
  if (unseen[kind] <= 1) danger *= 0.55;
  return danger;
}

function dangerOf(
  game: MahjongGame,
  seat: Seat,
  kind: TileKind,
  threats: Seat[],
  unseen: number[],
): number {
  let total = 0;
  for (const threat of threats) total += dangerAgainst(game, threat, kind, unseen);
  return total;
}

function hasYakuPotential(game: MahjongGame, seat: Seat, concealed: Tile[]): boolean {
  const player = game.players[seat];
  const meldTiles = player.melds.flatMap((meld) => meld.tiles);
  const all = [...concealed, ...meldTiles];
  const counts = countKinds(all);

  // Yakuhai: dragons, round wind, seat wind.
  const yakuhaiKinds: TileKind[] = [31, 32, 33, 27 + game.roundWind, 27 + player.wind];
  if (yakuhaiKinds.some((kind) => counts[kind] >= 3)) return true;

  // Tanyao.
  if (game.rules.kuitan && all.every((tile) => !isTerminalOrHonor(kindOf(tile)))) return true;

  // Half / full flush.
  const suits = new Set(all.map((tile) => kindOf(tile)).filter((kind) => kind < 27).map((kind) => (kind / 9) | 0));
  if (suits.size <= 1) return true;

  // Toitoi-ish shape.
  let triplets = 0;
  for (let kind = 0; kind < TILE_KINDS; kind += 1) if (counts[kind] >= 3) triplets += 1;
  return triplets >= 3;
}

function bestRiichiDiscard(game: MahjongGame, seat: Seat, candidates: Tile[], unseen: number[]): {
  tile: Tile;
  waits: number;
} | null {
  const player = game.players[seat];
  const concealed = player.drawn === null ? [...player.hand] : [...player.hand, player.drawn];
  let best: { tile: Tile; waits: number } | null = null;
  const seen = new Set<TileKind>();
  for (const tile of candidates) {
    const kind = kindOf(tile);
    if (seen.has(kind)) continue;
    seen.add(kind);
    const rest = concealed.filter((candidate) => candidate !== tile);
    const counts = countKinds(rest);
    let waits = 0;
    for (let draw = 0; draw < TILE_KINDS; draw += 1) {
      if (counts[draw] >= 4) continue;
      counts[draw] += 1;
      const complete = shanten(counts, player.melds.length) === -1;
      counts[draw] -= 1;
      if (complete) waits += unseen[draw];
    }
    if (!best || waits > best.waits) best = { tile, waits };
  }
  return best;
}

export function botTurnAction(game: MahjongGame, seat: Seat, config: BotConfig = DEFAULT_BOT): Action {
  const options = game.turnOptions(seat);
  if (!options) throw new Error("bot asked to act out of turn");
  const player = game.players[seat];
  const unseen = unseenCounts(game, seat);

  if (options.tsumo) return { type: "tsumo" };
  if (options.kyuushu && game.wallRemaining > 60) return { type: "kyuushu" };

  const concealed = player.drawn === null ? [...player.hand] : [...player.hand, player.drawn];
  const counts = countKinds(concealed);
  const currentShanten = shanten(counts, player.melds.length);
  const threats = threatSeats(game, seat);

  // Concealed kan / added kan when the hand does not get worse.
  if (options.ankan.length > 0) {
    for (const kind of options.ankan) {
      if (player.riichi.declared) return { type: "ankan", kind };
      const after = [...counts];
      after[kind] -= 4;
      if (shanten(after, player.melds.length + 1) <= currentShanten && threats.length === 0) {
        return { type: "ankan", kind };
      }
    }
  }
  if (options.kakan.length > 0 && threats.length === 0) {
    return { type: "kakan", tile: options.kakan[0] };
  }

  if (options.riichi.length > 0) {
    const best = bestRiichiDiscard(game, seat, options.riichi, unseen);
    if (best && best.waits >= 2) return { type: "discard", tile: best.tile, riichi: true };
    if (best && best.waits >= 1 && game.wallRemaining > 20) {
      return { type: "discard", tile: best.tile, riichi: true };
    }
  }

  const allowed = new Set(options.discard);
  const entries = ukeire(counts, player.melds.length, unseen).filter((entry) =>
    options.discard.some((tile) => kindOf(tile) === entry.discard),
  );

  const pickTile = (kind: TileKind): Tile => {
    const matches = options.discard.filter((tile) => kindOf(tile) === kind);
    // Keep red fives when possible.
    return matches.sort((a, b) => a - b)[matches.length - 1] ?? options.discard[0];
  };

  if (player.riichi.declared || entries.length === 0) {
    const tile = options.discard[0];
    if (tile === undefined) throw new Error("no legal discard");
    return { type: "discard", tile };
  }

  const bestShanten = Math.min(...entries.map((entry) => entry.shanten));
  const folding =
    threats.length > 0 &&
    (currentShanten >= 3 ||
      (currentShanten >= 2 && Math.random() > config.aggression) ||
      player.score < 1000);

  if (folding) {
    let safest: { kind: TileKind; danger: number; shanten: number } | null = null;
    for (const entry of entries) {
      const danger = dangerOf(game, seat, entry.discard, threats, unseen);
      if (
        !safest ||
        danger < safest.danger - 0.001 ||
        (Math.abs(danger - safest.danger) < 0.001 && entry.shanten < safest.shanten)
      ) {
        safest = { kind: entry.discard, danger, shanten: entry.shanten };
      }
    }
    if (safest) return { type: "discard", tile: pickTile(safest.kind) };
  }

  let bestScore = -Infinity;
  let bestKind: TileKind = entries[0].discard;
  for (const entry of entries) {
    const shantenPenalty = (entry.shanten - bestShanten) * 45;
    const danger = dangerOf(game, seat, entry.discard, threats, unseen) * config.safety;
    const dangerWeight = currentShanten <= 0 ? 1.2 : currentShanten === 1 ? 2.4 : 4.0;
    const score = entry.count - shantenPenalty - danger * dangerWeight;
    if (score > bestScore) {
      bestScore = score;
      bestKind = entry.discard;
    }
  }
  const tile = pickTile(bestKind);
  if (!allowed.has(tile)) return { type: "discard", tile: options.discard[0] };
  return { type: "discard", tile };
}

export function botCallAction(game: MahjongGame, seat: Seat, config: BotConfig = DEFAULT_BOT): Action {
  const options = game.callOptions(seat);
  if (!options) return { type: "pass" };
  if (options.ron) return { type: "ron" };

  const player = game.players[seat];
  const tile = game.lastDiscard?.tile;
  if (tile === undefined) return { type: "pass" };

  const meldCount = player.melds.length;
  const before = shanten(countKinds(player.hand), meldCount);
  const threats = threatSeats(game, seat);
  if (threats.length > 0 && before >= 2) return { type: "pass" };

  const evaluate = (used: Tile[]): number => {
    const rest = player.hand.filter((candidate) => !used.includes(candidate));
    const after = shanten(countKinds(rest), meldCount + 1);
    if (after >= before) return Number.POSITIVE_INFINITY;
    if (!hasYakuPotential(game, seat, [...rest, ...used, tile])) return Number.POSITIVE_INFINITY;
    return after;
  };

  let best: { action: Action; value: number } | null = null;

  for (const option of options.pon) {
    const value = evaluate([...option.tiles]);
    if (value === Number.POSITIVE_INFINITY) continue;
    if (!best || value < best.value) best = { action: { type: "pon", tiles: option.tiles }, value };
  }
  for (const option of options.chi) {
    const value = evaluate([...option.tiles]);
    if (value === Number.POSITIVE_INFINITY) continue;
    if (!best || value < best.value) best = { action: { type: "chi", tiles: option.tiles }, value };
  }
  if (options.daiminkan) {
    const kind = kindOf(tile);
    const owned = player.hand.filter((candidate) => kindOf(candidate) === kind);
    const value = evaluate(owned.slice(0, 3));
    const yakuhai: TileKind[] = [31, 32, 33, 27 + game.roundWind, 27 + player.wind];
    if (value !== Number.POSITIVE_INFINITY && yakuhai.includes(kind)) {
      if (!best || value < best.value) best = { action: { type: "daiminkan" }, value };
    }
  }

  if (!best) return { type: "pass" };
  if (best.value > 0 && Math.random() > config.aggression) return { type: "pass" };
  return best.action;
}
