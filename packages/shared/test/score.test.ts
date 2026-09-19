import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, makeRules } from "../src/rules.js";
import { buildRiichiString, calculateScore, limitPayments, type ScoreContext } from "../src/score.js";
import { AKA_TILES, isAka, KIND_5M, KIND_5P, KIND_5S, parseKinds, type Tile } from "../src/tiles.js";
import type { Meld, Wind } from "../src/types.js";

const FIVES = new Set([KIND_5M, KIND_5P, KIND_5S]);

/**
 * Turn notation into concrete tiles. Copy 0 of every five is the red five, so plain
 * fives start at copy 1 unless the caller explicitly asks for `AKA_TILES`.
 */
function makeTiles(notation: string): Tile[] {
  const used = new Map<number, number>();
  return parseKinds(notation).map((kind) => {
    const start = FIVES.has(kind) ? 1 : 0;
    const copy = used.get(kind) ?? start;
    used.set(kind, copy + 1);
    return kind * 4 + copy;
  });
}

function single(notation: string): Tile {
  return makeTiles(notation)[0];
}

function context(
  overrides: Partial<ScoreContext> & Pick<ScoreContext, "hand" | "winTile">,
): ScoreContext {
  return {
    melds: [],
    tsumo: false,
    seatWind: 1 as Wind,
    roundWind: 0 as Wind,
    doraIndicators: [],
    uraIndicators: [],
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    haitei: false,
    rinshan: false,
    chankan: false,
    blessing: false,
    rules: DEFAULT_RULES,
    ...overrides,
  };
}

/** Split a 14 tile notation into the 13 tile hand plus the winning tile. */
function split(notation: string): { hand: Tile[]; winTile: Tile } {
  const all = makeTiles(notation);
  expect(all.length).toBe(14);
  const winTile = all[all.length - 1];
  return { hand: all.slice(0, -1), winTile };
}

describe("scoring", () => {
  it("builds the notation expected by the library", () => {
    const { hand, winTile } = split("123m456m789m123s11s");
    const built = buildRiichiString(
      context({ hand, winTile, riichi: true, ippatsu: true, seatWind: 0, roundWind: 0 }),
    );
    expect(built).toBe("123456789m1123s+1s+ri11");
  });

  it("scores a dealer riichi tsumo with dora", () => {
    const { hand, winTile } = split("234m234p234s345s55s");
    const result = calculateScore(
      context({
        hand,
        winTile,
        tsumo: true,
        seatWind: 0,
        roundWind: 0,
        riichi: true,
        ippatsu: true,
        doraIndicators: [single("1m")],
        uraIndicators: [single("9p")],
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.doraCount).toBe(1);
    expect(result.tsumo).not.toBeNull();
    expect(result.tsumo?.fromDealer).toBe(0);
    expect(result.points).toBe((result.tsumo?.fromNonDealer ?? 0) * 3);
    const names = result.yaku.map((line) => line.name);
    expect(names).toContain("立直");
    expect(names).toContain("一発");
    expect(names).toContain("門前清自摸和");
  });

  it("splits tsumo payments for a non dealer", () => {
    const { hand, winTile } = split("123m456m789m345p22s");
    const result = calculateScore(
      context({ hand, winTile, tsumo: true, seatWind: 2, roundWind: 0, riichi: true }),
    );
    expect(result.valid).toBe(true);
    expect(result.tsumo?.fromDealer).toBeGreaterThan(result.tsumo?.fromNonDealer ?? 0);
    expect(result.points).toBe(
      (result.tsumo?.fromDealer ?? 0) + (result.tsumo?.fromNonDealer ?? 0) * 2,
    );
  });

  it("scores seven pairs", () => {
    const { hand, winTile } = split("1188m2299p3377s44z");
    const result = calculateScore(context({ hand, winTile, seatWind: 1, roundWind: 0 }));
    expect(result.valid).toBe(true);
    expect(result.fu).toBe(25);
    expect(result.yaku.map((line) => line.name)).toContain("七対子");
  });

  it("scores thirteen orphans as a yakuman", () => {
    const { hand, winTile } = split("19m19p19s1234567z1z");
    const result = calculateScore(context({ hand, winTile, seatWind: 1, roundWind: 0 }));
    expect(result.valid).toBe(true);
    expect(result.yakuman).toBeGreaterThanOrEqual(1);
    // The thirteen sided wait is a double yakuman with the default rules.
    expect(result.ron).toBe(64000);

    const singleOnly = calculateScore(
      context({
        hand,
        winTile,
        seatWind: 1,
        roundWind: 0,
        rules: makeRules({ doubleYakuman: false }),
      }),
    );
    expect(singleOnly.ron).toBe(32000);
  });

  it("counts red fives as dora", () => {
    const hand = makeTiles("234m234p234s67s55p");
    const winTile = AKA_TILES[2];
    expect(isAka(winTile)).toBe(true);
    const result = calculateScore(context({ hand, winTile, seatWind: 1, roundWind: 0 }));
    expect(result.valid).toBe(true);
    expect(result.akaCount).toBe(1);
    expect(result.yaku.map((line) => line.name)).toContain("断么九");
  });

  it("rejects hands without yaku", () => {
    const meld: Meld = {
      type: "chi",
      tiles: makeTiles("456m"),
      calledTile: single("4m"),
      from: 1,
    };
    // Ten concealed tiles plus one called meld and the winning tile.
    const all = makeTiles("123m789p22s345s");
    const result = calculateScore(
      context({
        hand: all.slice(0, -1),
        winTile: all[all.length - 1],
        melds: [meld],
        seatWind: 1,
        roundWind: 0,
      }),
    );
    expect(result.valid).toBe(false);
  });

  it("scores an open hand with a called kan", () => {
    const meldTiles = makeTiles("1111z");
    const meld: Meld = { type: "daiminkan", tiles: meldTiles, calledTile: meldTiles[0], from: 2 };
    const all = makeTiles("123m456m789m22p");
    const winTile = all[all.length - 1];
    const result = calculateScore(
      context({
        hand: all.slice(0, -1),
        winTile,
        melds: [meld],
        seatWind: 0,
        roundWind: 0,
        tsumo: true,
        rinshan: true,
      }),
    );
    expect(result.valid).toBe(true);
    const names = result.yaku.map((line) => line.name);
    expect(names).toContain("嶺上開花");
    expect(names.some((name) => name.includes("東"))).toBe(true);
  });

  it("scores a concealed kan and keeps the hand closed", () => {
    const meld: Meld = { type: "ankan", tiles: makeTiles("2222p"), calledTile: null, from: null };
    const all = makeTiles("123m456m789m33s");
    const winTile = all[all.length - 1];
    const result = calculateScore(
      context({
        hand: all.slice(0, -1),
        melds: [meld],
        winTile,
        tsumo: true,
        seatWind: 1,
        roundWind: 0,
        riichi: true,
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.yaku.map((line) => line.name)).toContain("門前清自摸和");
  });

  it("limit payments follow the standard table", () => {
    expect(limitPayments("mangan", false, false).total).toBe(8000);
    expect(limitPayments("mangan", true, false).total).toBe(12000);
    expect(limitPayments("mangan", false, true)).toEqual({
      total: 8000,
      fromDealer: 4000,
      fromNonDealer: 2000,
    });
    expect(limitPayments("mangan", true, true)).toEqual({
      total: 12000,
      fromDealer: 0,
      fromNonDealer: 4000,
    });
  });

  it("honours the kuitan rule switch", () => {
    const meld: Meld = {
      type: "pon",
      tiles: makeTiles("222m"),
      calledTile: single("2m"),
      from: 1,
    };
    const all = makeTiles("345m456p567s33s");
    const open = {
      hand: all.slice(0, -1),
      winTile: all[all.length - 1],
      melds: [meld],
      seatWind: 1 as Wind,
      roundWind: 0 as Wind,
    };
    expect(calculateScore(context({ ...open })).valid).toBe(true);
    expect(calculateScore(context({ ...open, rules: makeRules({ kuitan: false }) })).valid).toBe(
      false,
    );
  });
});
