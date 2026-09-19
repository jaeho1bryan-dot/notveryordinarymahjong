import { isAgari } from "./agari.js";
import { TILE_KINDS, type TileKind } from "./tiles.js";

/**
 * Shanten (number of tiles away from tenpai; 0 = tenpai, -1 = winning hand).
 *
 * `counts` holds concealed tiles only, `meldCount` the number of called melds.
 */

function standardSearch(
  counts: number[],
  k: number,
  sets: number,
  partials: number,
  pair: number,
  best: { value: number },
): void {
  if (k >= TILE_KINDS) {
    const value = 8 - 2 * sets - partials - pair;
    if (value < best.value) best.value = value;
    return;
  }
  if (counts[k] === 0) {
    standardSearch(counts, k + 1, sets, partials, pair, best);
    return;
  }

  // Leave the remaining copies of this kind as floaters.
  standardSearch(counts, k + 1, sets, partials, pair, best);

  const blockRoom = sets + partials < 4;

  if (blockRoom && counts[k] >= 3) {
    counts[k] -= 3;
    standardSearch(counts, k, sets + 1, partials, pair, best);
    counts[k] += 3;
  }
  if (blockRoom && k < 27 && k % 9 <= 6 && counts[k + 1] > 0 && counts[k + 2] > 0) {
    counts[k] -= 1;
    counts[k + 1] -= 1;
    counts[k + 2] -= 1;
    standardSearch(counts, k, sets + 1, partials, pair, best);
    counts[k] += 1;
    counts[k + 1] += 1;
    counts[k + 2] += 1;
  }
  if (counts[k] >= 2) {
    if (pair === 0) {
      counts[k] -= 2;
      standardSearch(counts, k, sets, partials, 1, best);
      counts[k] += 2;
    }
    if (blockRoom) {
      counts[k] -= 2;
      standardSearch(counts, k, sets, partials + 1, pair, best);
      counts[k] += 2;
    }
  }
  if (blockRoom && k < 27) {
    if (k % 9 <= 7 && counts[k + 1] > 0) {
      counts[k] -= 1;
      counts[k + 1] -= 1;
      standardSearch(counts, k, sets, partials + 1, pair, best);
      counts[k] += 1;
      counts[k + 1] += 1;
    }
    if (k % 9 <= 6 && counts[k + 2] > 0) {
      counts[k] -= 1;
      counts[k + 2] -= 1;
      standardSearch(counts, k, sets, partials + 1, pair, best);
      counts[k] += 1;
      counts[k + 2] += 1;
    }
  }
}

export function standardShanten(counts: readonly number[], meldCount: number): number {
  const best = { value: 8 };
  standardSearch([...counts], 0, meldCount, 0, 0, best);
  return best.value;
}

export function chiitoiShanten(counts: readonly number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (let k = 0; k < TILE_KINDS; k += 1) {
    if (counts[k] > 0) kinds += 1;
    if (counts[k] >= 2) pairs += 1;
  }
  let value = 6 - pairs;
  if (kinds < 7) value += 7 - kinds;
  return value;
}

const KOKUSHI_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

export function kokushiShanten(counts: readonly number[]): number {
  let kinds = 0;
  let hasPair = false;
  for (const k of KOKUSHI_KINDS) {
    if (counts[k] > 0) kinds += 1;
    if (counts[k] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** Overall shanten, taking the seven pairs and thirteen orphans shapes into account. */
export function shanten(counts: readonly number[], meldCount = 0): number {
  let value = standardShanten(counts, meldCount);
  if (meldCount === 0) {
    value = Math.min(value, chiitoiShanten(counts), kokushiShanten(counts));
  }
  return value;
}

export interface UkeireEntry {
  /** Tile kind to discard. */
  discard: TileKind;
  /** Resulting shanten after the discard. */
  shanten: number;
  /** Tile kinds that improve the hand afterwards. */
  accepts: TileKind[];
  /** Number of such tiles still unseen. */
  count: number;
}

/**
 * Tile efficiency for a 14 tile hand: for each possible discard the resulting shanten and
 * the tiles that bring the hand forward. `unseen` counts how many copies of each kind are
 * still invisible to the player (hand + melds + discards + dora indicators are visible).
 */
export function ukeire(
  counts: readonly number[],
  meldCount: number,
  unseen: readonly number[],
): UkeireEntry[] {
  const work = [...counts];
  const entries: UkeireEntry[] = [];
  for (let discard = 0; discard < TILE_KINDS; discard += 1) {
    if (work[discard] === 0) continue;
    work[discard] -= 1;
    const afterShanten = shanten(work, meldCount);
    const accepts: TileKind[] = [];
    let count = 0;
    for (let draw = 0; draw < TILE_KINDS; draw += 1) {
      if (work[draw] >= 4) continue;
      work[draw] += 1;
      const improved = shanten(work, meldCount) < afterShanten;
      work[draw] -= 1;
      if (improved) {
        accepts.push(draw);
        count += Math.max(0, unseen[draw]);
      }
    }
    entries.push({ discard, shanten: afterShanten, accepts, count });
    work[discard] += 1;
  }
  entries.sort((a, b) => a.shanten - b.shanten || b.count - a.count || a.discard - b.discard);
  return entries;
}

/** True when the 13 tile hand is tenpai. */
export function isTenpai(counts: readonly number[], meldCount = 0): boolean {
  const work = [...counts];
  for (let k = 0; k < TILE_KINDS; k += 1) {
    if (work[k] >= 4) continue;
    work[k] += 1;
    const agari = isAgari(work, meldCount);
    work[k] -= 1;
    if (agari) return true;
  }
  return false;
}
