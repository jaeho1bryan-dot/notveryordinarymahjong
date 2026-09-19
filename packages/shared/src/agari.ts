import { TILE_KINDS, type TileKind } from "./tiles.js";

/**
 * Winning-hand checks.
 *
 * `counts` is a 34 length array of concealed tiles only; `meldCount` is the number of
 * melds already on the table (chi/pon/kan), which each replace one of the four sets.
 */

function removeSets(counts: number[], need: number): boolean {
  let k = 0;
  while (k < TILE_KINDS && counts[k] === 0) k += 1;
  if (k >= TILE_KINDS) return need === 0;
  if (need === 0) return false;

  if (counts[k] >= 3) {
    counts[k] -= 3;
    const ok = removeSets(counts, need - 1);
    counts[k] += 3;
    if (ok) return true;
  }
  if (k < 27 && k % 9 <= 6 && counts[k + 1] > 0 && counts[k + 2] > 0) {
    counts[k] -= 1;
    counts[k + 1] -= 1;
    counts[k + 2] -= 1;
    const ok = removeSets(counts, need - 1);
    counts[k] += 1;
    counts[k + 1] += 1;
    counts[k + 2] += 1;
    if (ok) return true;
  }
  return false;
}

/** Four sets + one pair (melds included through `meldCount`). */
export function isStandardAgari(counts: readonly number[], meldCount: number): boolean {
  const need = 4 - meldCount;
  if (need < 0) return false;
  const work = [...counts];
  for (let pair = 0; pair < TILE_KINDS; pair += 1) {
    if (work[pair] < 2) continue;
    work[pair] -= 2;
    const ok = removeSets(work, need);
    work[pair] += 2;
    if (ok) return true;
  }
  return false;
}

/** Seven distinct pairs (closed hands only). */
export function isChiitoitsu(counts: readonly number[]): boolean {
  let pairs = 0;
  for (let k = 0; k < TILE_KINDS; k += 1) {
    if (counts[k] === 0) continue;
    if (counts[k] !== 2) return false;
    pairs += 1;
  }
  return pairs === 7;
}

const KOKUSHI_KINDS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/** Thirteen orphans (closed hands only). */
export function isKokushi(counts: readonly number[]): boolean {
  let total = 0;
  let pairs = 0;
  for (const k of KOKUSHI_KINDS) {
    const c = counts[k];
    if (c === 0) return false;
    if (c === 2) pairs += 1;
    else if (c !== 1) return false;
    total += c;
  }
  return total === 14 && pairs === 1;
}

export function isAgari(counts: readonly number[], meldCount: number): boolean {
  if (meldCount === 0 && (isChiitoitsu(counts) || isKokushi(counts))) return true;
  return isStandardAgari(counts, meldCount);
}

/**
 * Winning tiles for a 13 tile hand (`counts` must contain 13 - 3 * meldCount tiles).
 * Availability of the tiles is not considered - this is the pure shape wait.
 */
export function waitingKinds(counts: readonly number[], meldCount: number): TileKind[] {
  const work = [...counts];
  const result: TileKind[] = [];
  for (let k = 0; k < TILE_KINDS; k += 1) {
    if (work[k] >= 4) continue;
    work[k] += 1;
    if (isAgari(work, meldCount)) result.push(k);
    work[k] -= 1;
  }
  return result;
}
