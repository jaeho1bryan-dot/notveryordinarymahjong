import { describe, expect, it } from "vitest";
import Riichi from "riichi";
import {
  countsFromKinds,
  kindToNotation,
  parseKinds,
  TILE_KINDS,
} from "../src/tiles.js";
import { chiitoiShanten, kokushiShanten, shanten, standardShanten, ukeire } from "../src/shanten.js";
import { isAgari, waitingKinds } from "../src/agari.js";
import { Rng } from "../src/rng.js";

/** Reference shanten from the `riichi` library (standard + chiitoi/kokushi forms). */
function referenceShanten(notation: string): { shanten: number; waits: string[] } {
  const result = new Riichi(notation).calc();
  if (result.isAgari) return { shanten: -1, waits: [] };
  const standard = result.hairi?.now ?? 99;
  const special = result.hairi7and13?.now ?? 99;
  const best = Math.min(standard, special);
  const waits = new Set<string>();
  if (best === 0) {
    if (standard === 0) for (const key of Object.keys(result.hairi?.wait ?? {})) waits.add(key);
    if (special === 0) for (const key of Object.keys(result.hairi7and13?.wait ?? {})) waits.add(key);
  }
  return { shanten: best, waits: [...waits].sort() };
}

function ownShanten(notation: string): number {
  return shanten(countsFromKinds(parseKinds(notation)), 0);
}

describe("shanten", () => {
  it("detects complete hands", () => {
    expect(ownShanten("123m456m789m123s11z")).toBe(-1);
    expect(ownShanten("1122334455667z")).toBeGreaterThanOrEqual(0);
    expect(shanten(countsFromKinds(parseKinds("11223344556677z")), 0)).toBe(-1);
    expect(shanten(countsFromKinds(parseKinds("19m19p19s12345677z")), 0)).toBe(-1);
  });

  it("matches the reference implementation on hand shapes", () => {
    const cases = [
      "123m456m789m123s1z",
      "123m456m789m12s11z",
      "19m19p19s1234567z",
      "113355779m1133p",
      "1112345678999m",
      "2233445566778p",
      "123456789m1199s",
      "123456789m1234p",
      "1111m2222p3333s1z",
      "1245789m1358p27s",
    ];
    for (const hand of cases) {
      const kinds = parseKinds(hand);
      expect(kinds.length, hand).toBe(13);
      const reference = referenceShanten(hand);
      expect(ownShanten(hand), hand).toBe(reference.shanten);
    }
  });

  it("matches the reference on random hands", { timeout: 60_000 }, () => {
    const rng = new Rng(20260919);
    for (let iteration = 0; iteration < 150; iteration += 1) {
      const wall: number[] = [];
      for (let kind = 0; kind < TILE_KINDS; kind += 1) {
        for (let copy = 0; copy < 4; copy += 1) wall.push(kind);
      }
      rng.shuffle(wall);
      const kinds = wall.slice(0, 13).sort((a, b) => a - b);
      const notation = kinds.map((kind) => kindToNotation(kind)).join("");
      const counts = countsFromKinds(kinds);
      const reference = referenceShanten(notation);
      const mine = shanten(counts, 0);
      expect(mine, `${notation} (standard ${standardShanten(counts, 0)}, chiitoi ${chiitoiShanten(
        counts,
      )}, kokushi ${kokushiShanten(counts)})`).toBe(reference.shanten);

      if (reference.shanten === 0) {
        const waits = waitingKinds(counts, 0)
          .map((kind) => kindToNotation(kind))
          .sort();
        expect(waits, notation).toEqual(reference.waits);
      }
    }
  });

  it("agari recognises every winning form", () => {
    const winners = [
      "123m456m789m123s11z",
      "11223344556677z",
      "19m19p19s12345677z",
      "111222333444m11p",
      "11m123456789p111s",
    ];
    for (const hand of winners) {
      expect(isAgari(countsFromKinds(parseKinds(hand)), 0), hand).toBe(true);
    }
    const losers = ["123m456m789m123s12z", "1122334455667p7s", "19m19p19s1234567z"];
    for (const hand of losers) {
      expect(isAgari(countsFromKinds(parseKinds(hand)), 0), hand).toBe(false);
    }
  });

  it("handles melded hands", () => {
    // One meld called: ten concealed tiles form the rest of the hand.
    const tenpai = countsFromKinds(parseKinds("123m456m789m11z"));
    expect(shanten(tenpai, 1)).toBe(-1);
    const oneAway = countsFromKinds(parseKinds("123m456m78m9p11z"));
    expect(shanten(oneAway, 1)).toBe(0);
    const chiitoiIgnoredWhenOpen = countsFromKinds(parseKinds("1133557799m"));
    expect(shanten(chiitoiIgnoredWhenOpen, 1)).toBeGreaterThan(0);
  });

  it("ukeire lists improving discards", () => {
    const counts = countsFromKinds(parseKinds("123m456m789m11s23s9p"));
    const unseen = new Array<number>(TILE_KINDS).fill(4);
    const entries = ukeire(counts, 0, unseen);
    expect(entries.length).toBeGreaterThan(0);
    // Dropping the floating 9p is the only discard that keeps tenpai.
    expect(entries[0].discard).toBe(parseKinds("9p")[0]);
    expect(entries[0].shanten).toBe(0);
    expect(entries[0].accepts.sort()).toEqual([parseKinds("1s")[0], parseKinds("4s")[0]].sort());
    expect(entries[0].count).toBe(8);
  });
});
