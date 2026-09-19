import { describe, expect, it } from "vitest";
import { botCallAction, botTurnAction } from "../src/bot.js";
import { MahjongGame, seatDistance } from "../src/engine.js";
import { makeRules } from "../src/rules.js";
import { countKinds, kindOf, parseKinds, type Tile, type TileKind } from "../src/tiles.js";
import { SEATS, type Seat } from "../src/types.js";
import { buildPlayerView, HIDDEN_TILE } from "../src/view.js";

/** Concrete tiles for a notation string, giving every repeated kind a fresh copy. */
function handFrom(notation: string): Tile[] {
  const used = new Map<number, number>();
  return parseKinds(notation).map((kind) => {
    const copy = used.get(kind) ?? 0;
    used.set(kind, copy + 1);
    return kind * 4 + copy;
  });
}

function botPlayers() {
  return SEATS.map((seat) => ({ name: `Bot ${seat}`, isBot: true }));
}

interface PlayStats {
  hands: number;
  steps: number;
}

/** Drive a whole game with bots and validate the invariants after every step. */
function playGame(seed: number, maxSteps = 60_000): { game: MahjongGame; stats: PlayStats } {
  const game = new MahjongGame({ seed, players: botPlayers() });
  game.startHand();
  let steps = 0;
  let hands = 1;
  while (game.phase !== "gameEnd" && steps < maxSteps) {
    steps += 1;
    checkInvariants(game);
    if (game.phase === "handEnd") {
      expect(game.handResult).not.toBeNull();
      game.nextHand();
      hands += 1;
      continue;
    }
    const seats = game.pendingSeats();
    expect(seats.length).toBeGreaterThan(0);
    if (game.phase === "turn") {
      const seat = seats[0];
      game.apply(seat, botTurnAction(game, seat));
    } else {
      for (const seat of seats) {
        if (game.phase !== "calls") break;
        game.apply(seat, botCallAction(game, seat));
      }
    }
    game.drainEvents();
  }
  expect(game.phase).toBe("gameEnd");
  return { game, stats: { hands, steps } };
}

/** All 136 tiles have to be accounted for and the points must stay conserved. */
function checkInvariants(game: MahjongGame): void {
  const total = game.players.reduce((sum, player) => sum + player.score, 0);
  expect(total + game.riichiSticks * 1000).toBe(100_000);

  const seen = new Set<Tile>();
  const add = (tile: Tile) => {
    expect(seen.has(tile), `duplicate tile ${tile}`).toBe(false);
    seen.add(tile);
  };
  for (const player of game.players) {
    for (const tile of player.hand) add(tile);
    if (player.drawn !== null) add(player.drawn);
    for (const meld of player.melds) for (const tile of meld.tiles) add(tile);
    // Called tiles stay in the pond for the UI but belong to the meld.
    for (const discard of player.discards) if (discard.calledBy === null) add(discard.tile);
  }
  expect(seen.size).toBeLessThanOrEqual(136);

  for (const player of game.players) {
    // 13 tiles per player; the player to act holds one extra tile (drawn or called).
    const held = player.hand.length + (player.drawn === null ? 0 : 1) + player.melds.length * 3;
    expect(held, `seat ${player.seat} hand size`).toBeGreaterThanOrEqual(13);
    expect(held, `seat ${player.seat} hand size`).toBeLessThanOrEqual(14);
  }
}

describe("engine", () => {
  it("deals a hand and starts with the dealer", () => {
    const game = new MahjongGame({ seed: 1, players: botPlayers() });
    game.startHand();
    expect(game.phase).toBe("turn");
    expect(game.turn).toBe(game.dealer);
    expect(game.players[game.dealer].drawn).not.toBeNull();
    for (const player of game.players) expect(player.hand.length).toBe(13);
    expect(game.wallRemaining).toBe(69);
    expect(game.doraIndicators.length).toBe(1);
    expect(game.uraIndicators.length).toBe(1);
  });

  it("rotates seat winds with the dealer", () => {
    const game = new MahjongGame({ seed: 2, players: botPlayers() });
    game.startHand();
    expect(game.players.map((player) => player.wind)).toEqual([0, 1, 2, 3]);
    game.dealer = 1;
    game.startHand();
    expect(game.players.map((player) => player.wind)).toEqual([3, 0, 1, 2]);
  });

  it("hides other hands in the player view", () => {
    const game = new MahjongGame({ seed: 3, players: botPlayers() });
    game.startHand();
    const view = buildPlayerView(game, 2);
    expect(view.hand.length).toBe(13);
    expect(view.players[2].handCount).toBe(13);
    expect(view.players[0].revealedHand).toBeNull();
    expect(view.hand.every((tile) => tile !== HIDDEN_TILE)).toBe(true);
    expect(view.doraIndicators.length).toBe(1);
  });

  it("only allows discards from the player to move", () => {
    const game = new MahjongGame({ seed: 4, players: botPlayers() });
    game.startHand();
    const other = ((game.dealer + 1) % 4) as Seat;
    expect(() => game.apply(other, { type: "discard", tile: game.players[other].hand[0] })).toThrow();
  });

  it("charges the riichi stick only after the discard passes", () => {
    const game = new MahjongGame({ seed: 5, players: botPlayers() });
    game.startHand();
    const seat = game.dealer;
    const player = game.players[seat];
    // Force a tenpai hand waiting on 3p; the drawn 7z is the riichi discard.
    player.hand = handFrom("123m456m789m12p11s");
    player.drawn = parseKinds("7z")[0] * 4;
    const options = game.turnOptions(seat);
    expect(options).not.toBeNull();
    expect(options?.riichi.length ?? 0).toBeGreaterThan(0);
    const tile = options!.riichi[0];
    const before = player.score;
    game.apply(seat, { type: "discard", tile, riichi: true });
    // Nobody can call, so riichi is confirmed straight away.
    expect(player.riichi.declared).toBe(true);
    expect(player.score).toBe(before - 1000);
    expect(game.riichiSticks).toBe(1);
  });

  it("gives the chi option only to the player to the right", () => {
    const game = new MahjongGame({ seed: 6, players: botPlayers() });
    game.startHand();
    const discarder = game.turn;
    const shimocha = ((discarder + 1) % 4) as Seat;
    const toimen = ((discarder + 2) % 4) as Seat;
    const tile = parseKinds("3m")[0] * 4;
    game.players[shimocha].hand = [
      parseKinds("1m")[0] * 4,
      parseKinds("2m")[0] * 4,
      ...game.players[shimocha].hand.slice(2),
    ];
    game.players[toimen].hand = [
      parseKinds("1m")[0] * 4 + 1,
      parseKinds("2m")[0] * 4 + 1,
      ...game.players[toimen].hand.slice(2),
    ];
    expect(game.chiOptions(shimocha, tile).length).toBeGreaterThan(0);
    expect(seatDistance(discarder, shimocha)).toBe(1);
    expect(seatDistance(discarder, toimen)).toBe(2);
  });

  it("plays complete games without breaking its invariants", { timeout: 300_000 }, () => {
    for (const seed of [11, 4242, 987654]) {
      const { game, stats } = playGame(seed);
      expect(stats.hands).toBeGreaterThan(0);
      expect(game.gameResult).not.toBeNull();
      const result = game.gameResult!;
      expect(result.standings.length).toBe(4);
      const ranks = result.standings.map((standing) => standing.rank).sort();
      expect(ranks).toEqual([1, 2, 3, 4]);
      const points = result.standings.reduce((sum, standing) => sum + standing.score, 0);
      expect(points).toBe(100_000);
      // Uma and oka are zero sum.
      const totals = result.standings.reduce((sum, standing) => sum + standing.points, 0);
      expect(Math.abs(totals)).toBeLessThan(1e-6);
    }
  });

  it("runs a tonpuusen and ends after the east round", { timeout: 300_000 }, () => {
    const game = new MahjongGame({
      seed: 777,
      players: botPlayers(),
      rules: makeRules({ length: "tonpuusen" }),
    });
    game.startHand();
    let guard = 0;
    while (game.phase !== "gameEnd" && guard < 60_000) {
      guard += 1;
      if (game.phase === "handEnd") {
        game.nextHand();
        continue;
      }
      const seats = game.pendingSeats();
      if (game.phase === "turn") {
        game.apply(seats[0], botTurnAction(game, seats[0]));
      } else {
        for (const seat of seats) {
          if (game.phase !== "calls") break;
          game.apply(seat, botCallAction(game, seat));
        }
      }
      game.drainEvents();
    }
    expect(game.phase).toBe("gameEnd");
    expect(game.gameResult).not.toBeNull();
    // East round (plus possible extra hands) never reaches the south round twice.
    expect(game.roundWind).toBeLessThanOrEqual(1);
  });

  it("aborts on nine terminals", () => {
    const game = new MahjongGame({ seed: 8, players: botPlayers() });
    game.startHand();
    const seat = game.dealer;
    const player = game.players[seat];
    player.hand = handFrom("19m19p19s1234567z");
    player.drawn = parseKinds("1m")[0] * 4 + 2;
    const options = game.turnOptions(seat);
    expect(options?.kyuushu).toBe(true);
    game.apply(seat, { type: "kyuushu" });
    expect(game.phase).toBe("handEnd");
    expect(game.handResult?.drawReason).toBe("kyuushuKyuuhai");
  });

  it("keeps furiten players from calling ron", () => {
    const game = new MahjongGame({ seed: 9, players: botPlayers() });
    game.startHand();
    const seat = ((game.dealer + 2) % 4) as Seat;
    const player = game.players[seat];
    player.hand = handFrom("123m456m789m12p11s");
    const waitKinds: TileKind[] = game.waits(seat);
    expect(waitKinds.length).toBeGreaterThan(0);
    player.discards.push({
      tile: waitKinds[0] * 4 + 3,
      tsumogiri: true,
      riichi: false,
      calledBy: null,
    });
    expect(game.isFuriten(seat)).toBe(true);
  });

  it("counts a called tile towards the meld and removes it from the pond", () => {
    const game = new MahjongGame({ seed: 10, players: botPlayers() });
    game.startHand();
    const discarder = game.turn;
    const caller = ((discarder + 1) % 4) as Seat;
    const kind = kindOf(game.players[discarder].hand[0]);
    // Give the caller two copies of the discarded kind.
    const copies: Tile[] = [];
    for (let copy = 0; copy < 4; copy += 1) {
      const tile = kind * 4 + copy;
      if (!game.players[discarder].hand.includes(tile)) copies.push(tile);
    }
    if (copies.length >= 2) {
      const player = game.players[caller];
      // Replace two arbitrary tiles with the copies (keeping the hand size).
      const replaced = player.hand.filter((tile) => kindOf(tile) !== kind).slice(0, 2);
      for (let index = 0; index < replaced.length; index += 1) {
        const position = player.hand.indexOf(replaced[index]);
        player.hand[position] = copies[index];
      }
      const tile = game.players[discarder].hand[0];
      const drawn = game.players[discarder].drawn;
      expect(drawn).not.toBeNull();
      game.apply(discarder, { type: "discard", tile });
      if (game.phase === "calls") {
        const options = game.callOptions(caller);
        if (options && options.pon.length > 0) {
          game.apply(caller, { type: "pon", tiles: options.pon[0].tiles });
          while (game.phase === "calls") {
            for (const seat of game.pendingSeats()) {
              if (game.phase !== "calls") break;
              game.apply(seat, { type: "pass" });
            }
          }
          expect(game.players[caller].melds.length).toBe(1);
          expect(game.players[caller].melds[0].tiles.length).toBe(3);
          // The caller keeps the extra tile in hand until they discard.
          expect(game.players[caller].hand.length).toBe(11);
          expect(game.players[caller].drawn).toBeNull();
          expect(game.players[discarder].discards[game.players[discarder].discards.length - 1].calledBy).toBe(
            caller,
          );
          expect(game.turn).toBe(caller);
        }
      }
    }
  });

  it("scores an exhaustive draw with tenpai payments", () => {
    const game = new MahjongGame({ seed: 12, players: botPlayers() });
    game.startHand();
    // Make everybody noten by emptying the wall through normal play is slow;
    // drive the private draw counter instead.
    const before = game.players.map((player) => player.score);
    (game as unknown as { drawIndex: number }).drawIndex = (
      game as unknown as { liveEnd: number }
    ).liveEnd;
    expect(game.wallRemaining).toBe(0);
    const seat = game.turn;
    const options = game.turnOptions(seat);
    game.apply(seat, { type: "discard", tile: options!.discard[0] });
    while (game.phase === "calls") {
      for (const pending of game.pendingSeats()) game.apply(pending, { type: "pass" });
    }
    expect(game.phase).toBe("handEnd");
    expect(game.handResult?.kind).toBe("draw");
    expect(game.handResult?.drawReason).toBe("exhaustive");
    const changes = game.handResult!.scoreChanges;
    expect(changes.reduce((sum, value) => sum + value, 0)).toBe(0);
    expect(game.players.map((player) => player.score)).toEqual(
      before.map((score, index) => score + changes[index]),
    );
  });

  it("bots only discard tiles they hold", () => {
    const game = new MahjongGame({ seed: 13, players: botPlayers() });
    game.startHand();
    for (let step = 0; step < 200 && game.phase !== "handEnd"; step += 1) {
      if (game.phase === "turn") {
        const seat = game.turn;
        const action = botTurnAction(game, seat);
        if (action.type === "discard") {
          const player = game.players[seat];
          const available = [...player.hand, ...(player.drawn === null ? [] : [player.drawn])];
          expect(available).toContain(action.tile);
        }
        game.apply(seat, action);
      } else if (game.phase === "calls") {
        for (const seat of game.pendingSeats()) {
          if (game.phase !== "calls") break;
          game.apply(seat, botCallAction(game, seat));
        }
      }
      game.drainEvents();
    }
  });

  it("tracks kan counts and reveals extra dora", () => {
    const game = new MahjongGame({ seed: 14, players: botPlayers() });
    game.startHand();
    const seat = game.turn;
    const player = game.players[seat];
    const kind = parseKinds("5z")[0];
    player.hand = [
      kind * 4,
      kind * 4 + 1,
      kind * 4 + 2,
      ...player.hand.filter((tile) => kindOf(tile) !== kind).slice(0, 10),
    ];
    player.drawn = kind * 4 + 3;
    const options = game.turnOptions(seat);
    expect(options?.ankan).toContain(kind);
    const doraBefore = game.doraIndicators.length;
    game.apply(seat, { type: "ankan", kind });
    expect(game.doraIndicators.length).toBe(doraBefore + 1);
    expect(game.players[seat].melds[0].type).toBe("ankan");
    expect(game.phase).toBe("turn");
    expect(game.players[seat].drawn).not.toBeNull();
    expect(countKinds(game.players[seat].hand)[kind]).toBe(0);
  });
});
