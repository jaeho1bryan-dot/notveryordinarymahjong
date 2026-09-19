/**
 * Tile model.
 *
 * A physical tile is encoded as an integer in `[0, 136)` (the "136 form"), which is the
 * usual encoding used by tenhou-like engines:
 *
 *   tile >> 2 === kind  (0..33)
 *   tile  & 3 === copy  (0..3)
 *
 * Kinds are ordered `1m..9m`, `1p..9p`, `1s..9s`, `E S W N haku hatsu chun`.
 * The first copy of 5m / 5p / 5s is the red five (aka dora) when the rule is enabled.
 */

export type Tile = number;
export type TileKind = number;

export const TILE_KINDS = 34;
export const TILE_COUNT = 136;

export const KIND_5M = 4;
export const KIND_5P = 13;
export const KIND_5S = 22;

/** Physical tiles that are red fives. */
export const AKA_TILES: readonly Tile[] = [KIND_5M * 4, KIND_5P * 4, KIND_5S * 4];

export const SUIT_CHARS = ["m", "p", "s", "z"] as const;
export type Suit = 0 | 1 | 2 | 3; // man, pin, sou, honor

export const kindOf = (tile: Tile): TileKind => tile >> 2;
export const copyOf = (tile: Tile): number => tile & 3;
export const isAka = (tile: Tile): boolean =>
  (tile & 3) === 0 && (tile >> 2 === KIND_5M || tile >> 2 === KIND_5P || tile >> 2 === KIND_5S);

export const suitOfKind = (kind: TileKind): Suit => (kind < 27 ? ((kind / 9) | 0) as Suit : 3);
/** 1..9 for number tiles, 1..7 for honors (E S W N haku hatsu chun). */
export const rankOfKind = (kind: TileKind): number => (kind < 27 ? (kind % 9) + 1 : kind - 26);

export const isHonor = (kind: TileKind): boolean => kind >= 27;
export const isWindKind = (kind: TileKind): boolean => kind >= 27 && kind <= 30;
export const isDragonKind = (kind: TileKind): boolean => kind >= 31;
export const isTerminal = (kind: TileKind): boolean =>
  kind < 27 && (kind % 9 === 0 || kind % 9 === 8);
export const isTerminalOrHonor = (kind: TileKind): boolean => isHonor(kind) || isTerminal(kind);
export const isSimple = (kind: TileKind): boolean => !isTerminalOrHonor(kind);

export const makeKind = (suit: Suit, rank: number): TileKind =>
  suit === 3 ? 26 + rank : suit * 9 + (rank - 1);

/** Human readable kind notation used by the scoring library, e.g. `3m`, `7z`. */
export const kindToNotation = (kind: TileKind): string =>
  `${rankOfKind(kind)}${SUIT_CHARS[suitOfKind(kind)]}`;

/** Notation of a physical tile: red fives become `0m` / `0p` / `0s`. */
export const tileToNotation = (tile: Tile): string =>
  isAka(tile) ? `0${SUIT_CHARS[suitOfKind(kindOf(tile))]}` : kindToNotation(kindOf(tile));

export function notationToKind(notation: string): TileKind {
  const rank = Number(notation[0]);
  const suitIndex = SUIT_CHARS.indexOf(notation[1] as (typeof SUIT_CHARS)[number]);
  if (Number.isNaN(rank) || suitIndex < 0) throw new Error(`invalid tile notation: ${notation}`);
  if (suitIndex === 3) {
    if (rank < 1 || rank > 7) throw new Error(`invalid honor tile: ${notation}`);
    return 26 + rank;
  }
  // `0` means a red five.
  const effective = rank === 0 ? 5 : rank;
  if (effective < 1 || effective > 9) throw new Error(`invalid tile notation: ${notation}`);
  return suitIndex * 9 + (effective - 1);
}

/** Parse a notation string such as `123m456p789s11z` into tile kinds. */
export function parseKinds(notation: string): TileKind[] {
  const kinds: TileKind[] = [];
  let pending: string[] = [];
  for (const ch of notation.replace(/\s/g, "")) {
    if (ch >= "0" && ch <= "9") {
      pending.push(ch);
    } else {
      const suitIndex = SUIT_CHARS.indexOf(ch as (typeof SUIT_CHARS)[number]);
      if (suitIndex < 0) throw new Error(`invalid suit char: ${ch}`);
      for (const digit of pending) kinds.push(notationToKind(`${digit}${ch}`));
      pending = [];
    }
  }
  if (pending.length) throw new Error(`dangling digits in notation: ${notation}`);
  return kinds;
}

/** Group tile kinds into the compact notation used by the scoring library. */
export function kindsToNotation(kinds: readonly TileKind[]): string {
  return tilesToNotation(kinds.map((kind) => kind * 4 + 1));
}

/**
 * Group physical tiles into compact notation, preserving red fives (`0`).
 * Tiles are emitted suit by suit in the order they were given.
 */
export function tilesToNotation(tiles: readonly Tile[]): string {
  let out = "";
  let currentSuit: Suit | null = null;
  let digits = "";
  for (const tile of tiles) {
    const suit = suitOfKind(kindOf(tile));
    const digit = isAka(tile) ? "0" : String(rankOfKind(kindOf(tile)));
    if (currentSuit !== null && suit !== currentSuit) {
      out += digits + SUIT_CHARS[currentSuit];
      digits = "";
    }
    currentSuit = suit;
    digits += digit;
  }
  if (currentSuit !== null) out += digits + SUIT_CHARS[currentSuit];
  return out;
}

/** The dora kind indicated by a dora indicator kind. */
export function doraFromIndicator(kind: TileKind): TileKind {
  if (kind < 27) {
    const suit = (kind / 9) | 0;
    const rank = kind % 9;
    return suit * 9 + ((rank + 1) % 9);
  }
  if (kind <= 30) return 27 + ((kind - 27 + 1) % 4); // winds cycle E->S->W->N->E
  return 31 + ((kind - 31 + 1) % 3); // dragons cycle haku->hatsu->chun->haku
}

/** Sort tiles for display: by kind, red fives first inside their kind. */
export function sortTiles(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort(compareTiles);
}

export function compareTiles(a: Tile, b: Tile): number {
  const ka = kindOf(a);
  const kb = kindOf(b);
  if (ka !== kb) return ka - kb;
  return a - b;
}

/** Count array indexed by kind. */
export function countKinds(tiles: readonly Tile[]): number[] {
  const counts = new Array<number>(TILE_KINDS).fill(0);
  for (const tile of tiles) counts[kindOf(tile)] += 1;
  return counts;
}

export function countsFromKinds(kinds: readonly TileKind[]): number[] {
  const counts = new Array<number>(TILE_KINDS).fill(0);
  for (const kind of kinds) counts[kind] += 1;
  return counts;
}

/** Remove one tile of the given kind from `tiles`, preferring non-red copies. */
export function removeKind(tiles: Tile[], kind: TileKind): Tile | null {
  let index = -1;
  for (let i = 0; i < tiles.length; i += 1) {
    if (kindOf(tiles[i]) !== kind) continue;
    if (index < 0 || (isAka(tiles[index]) && !isAka(tiles[i]))) index = i;
  }
  if (index < 0) return null;
  return tiles.splice(index, 1)[0];
}

export const WIND_KINDS: readonly TileKind[] = [27, 28, 29, 30];
export const DRAGON_KINDS: readonly TileKind[] = [31, 32, 33];
export const TERMINAL_AND_HONOR_KINDS: readonly TileKind[] = [
  0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33,
];
