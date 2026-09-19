import { isAgari, isKokushi, waitingKinds } from "./agari.js";
import { Rng } from "./rng.js";
import { DEFAULT_RULES, type RuleConfig, roundsInGame } from "./rules.js";
import { calculateScore, limitPayments, type ScoreResult } from "./score.js";
import { isTenpai } from "./shanten.js";
import {
  compareTiles,
  countKinds,
  isTerminalOrHonor,
  kindOf,
  sortTiles,
  type Tile,
  type TileKind,
} from "./tiles.js";
import type {
  Action,
  CallOptions,
  ChiOption,
  Discard,
  DrawReason,
  FinalStanding,
  GameEvent,
  GameResult,
  HandResult,
  Meld,
  PendingCall,
  PendingResponse,
  Phase,
  PlayerState,
  Seat,
  TurnOptions,
  Wind,
  WinResult,
} from "./types.js";
import { SEATS } from "./types.js";

export interface PlayerSetup {
  name: string;
  isBot: boolean;
}

export interface GameOptions {
  rules?: Partial<RuleConfig>;
  seed?: number;
  players?: PlayerSetup[];
}

const DEAD_WALL_SIZE = 14;
const LIVE_WALL_END = 136 - DEAD_WALL_SIZE;
const HAND_SIZE = 13;
/** Last hand number of the extension rounds (West 4). */
const MAX_HAND_NUMBER = 12;

export const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;
/** Seats between `from` and `to` counter clockwise (1 = shimocha of `from`). */
export const seatDistance = (from: Seat, to: Seat): number => (to - from + 4) % 4;

export class GameError extends Error {}

interface PendingKan {
  seat: Seat;
  tile: Tile;
  kind: "ankan" | "kakan";
}

interface WinClaim {
  seat: Seat;
  tile: Tile;
  from: Seat | null;
  chankan: boolean;
}

export class MahjongGame {
  readonly rules: RuleConfig;
  readonly seed: number;

  players: PlayerState[];
  phase: Phase = "idle";
  roundWind: Wind = 0;
  roundNumber = 1;
  honba = 0;
  riichiSticks = 0;
  dealer: Seat = 0;
  turn: Seat = 0;

  lastDiscard: { seat: Seat; tile: Tile; index: number } | null = null;
  pendingCalls: PendingCall[] | null = null;
  handResult: HandResult | null = null;
  gameResult: GameResult | null = null;
  events: GameEvent[] = [];

  private rng: Rng;
  private wall: Tile[] = [];
  private drawIndex = 0;
  private liveEnd = LIVE_WALL_END;
  private deadWall: Tile[] = [];
  private doraRevealed = 0;
  private pendingDora = 0;
  private pendingKan: PendingKan | null = null;
  private chankanOpen = false;
  private riichiPending: Seat | null = null;
  private lastDrawRinshan = false;
  private kanCount = 0;
  private kanSeats: Seat[] = [];
  private suukaikanPending = false;
  private firstGoAround = true;
  private turnCount = 0;
  /** Tile kinds a player may not discard right after calling (kuikae). */
  private forbidden: TileKind[][] = [[], [], [], []];

  constructor(options: GameOptions = {}) {
    this.rules = { ...DEFAULT_RULES, ...options.rules };
    this.seed = options.seed ?? Rng.randomSeed();
    this.rng = new Rng(this.seed);
    const setups: PlayerSetup[] =
      options.players ??
      SEATS.map((seat) => ({ name: seat === 0 ? "You" : `CPU ${seat}`, isBot: seat !== 0 }));
    this.players = SEATS.map((seat) => this.createPlayer(seat, setups[seat]));
  }

  private createPlayer(seat: Seat, setup: PlayerSetup | undefined): PlayerState {
    return {
      seat,
      name: setup?.name ?? `Player ${seat + 1}`,
      isBot: setup?.isBot ?? true,
      connected: true,
      score: this.rules.startingPoints,
      hand: [],
      drawn: null,
      melds: [],
      discards: [],
      riichi: { declared: false, double: false, ippatsu: false, turn: -1, discardIndex: -1 },
      furiten: { permanent: false, temporary: false, riichi: false },
      nagashi: true,
      firstDraw: true,
      wind: seat,
    };
  }

  // ---------------------------------------------------------------- lifecycle

  startHand(): void {
    if (this.phase === "gameEnd") throw new GameError("game is over");
    this.handResult = null;
    this.pendingCalls = null;
    this.pendingKan = null;
    this.chankanOpen = false;
    this.lastDiscard = null;
    this.riichiPending = null;
    this.lastDrawRinshan = false;
    this.kanCount = 0;
    this.kanSeats = [];
    this.suukaikanPending = false;
    this.firstGoAround = true;
    this.turnCount = 0;
    this.pendingDora = 0;
    this.forbidden = [[], [], [], []];

    for (const player of this.players) {
      player.hand = [];
      player.drawn = null;
      player.melds = [];
      player.discards = [];
      player.riichi = { declared: false, double: false, ippatsu: false, turn: -1, discardIndex: -1 };
      player.furiten = { permanent: false, temporary: false, riichi: false };
      player.nagashi = true;
      player.firstDraw = true;
      player.wind = seatDistance(this.dealer, player.seat) as Wind;
    }

    this.wall = this.rng.shuffle(Array.from({ length: 136 }, (_, index) => index));
    this.deadWall = this.wall.slice(LIVE_WALL_END);
    this.drawIndex = 0;
    this.liveEnd = LIVE_WALL_END;
    this.doraRevealed = 1;

    for (let round = 0; round < HAND_SIZE; round += 1) {
      for (let offset = 0; offset < 4; offset += 1) {
        const seat = ((this.dealer + offset) % 4) as Seat;
        this.players[seat].hand.push(this.wall[this.drawIndex]);
        this.drawIndex += 1;
      }
    }
    for (const player of this.players) player.hand.sort(compareTiles);

    this.phase = "turn";
    this.turn = this.dealer;
    this.events.push({
      type: "handStart",
      roundWind: this.roundWind,
      roundNumber: this.roundNumber,
      honba: this.honba,
      dealer: this.dealer,
    });
    this.events.push({ type: "dora", indicator: this.doraIndicators[0] });
    this.drawTile(this.dealer, false);
  }

  /** Begin the next hand (dealer rotation was decided when the previous hand ended). */
  nextHand(): void {
    if (this.gameResult) throw new GameError("game is over");
    this.startHand();
  }

  get doraIndicators(): Tile[] {
    const indicators: Tile[] = [];
    for (let i = 0; i < this.doraRevealed; i += 1) indicators.push(this.deadWall[4 + i * 2]);
    return indicators;
  }

  get uraIndicators(): Tile[] {
    const indicators: Tile[] = [];
    for (let i = 0; i < this.doraRevealed; i += 1) indicators.push(this.deadWall[5 + i * 2]);
    return indicators;
  }

  get wallRemaining(): number {
    return Math.max(0, this.liveEnd - this.drawIndex);
  }

  get handNumber(): number {
    return this.roundWind * 4 + this.roundNumber;
  }

  drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Seats that have to make a decision right now. */
  pendingSeats(): Seat[] {
    if (this.phase === "turn") return [this.turn];
    if (this.phase === "calls" && this.pendingCalls) {
      return this.pendingCalls.filter((call) => call.response === null).map((call) => call.seat);
    }
    return [];
  }

  // -------------------------------------------------------------------- draws

  private drawTile(seat: Seat, rinshan: boolean): void {
    const player = this.players[seat];
    let tile: Tile;
    if (rinshan) {
      tile = this.deadWall[this.kanCount - 1];
      this.liveEnd -= 1;
    } else {
      tile = this.wall[this.drawIndex];
      this.drawIndex += 1;
    }
    player.drawn = tile;
    player.furiten.temporary = false;
    this.lastDrawRinshan = rinshan;
    this.turn = seat;
    this.phase = "turn";
    this.refreshFuriten(seat);
    this.events.push({ type: "draw", seat, tile, rinshan });
  }

  private revealDora(): void {
    if (this.doraRevealed >= 5) return;
    this.doraRevealed += 1;
    this.events.push({ type: "dora", indicator: this.doraIndicators[this.doraRevealed - 1] });
  }

  private flushPendingDora(): void {
    while (this.pendingDora > 0) {
      this.pendingDora -= 1;
      this.revealDora();
    }
  }

  // ------------------------------------------------------------------ helpers

  private concealedTiles(seat: Seat): Tile[] {
    const player = this.players[seat];
    return player.drawn === null ? [...player.hand] : [...player.hand, player.drawn];
  }

  private mergeDrawn(seat: Seat): void {
    const player = this.players[seat];
    if (player.drawn === null) return;
    player.hand.push(player.drawn);
    player.drawn = null;
    player.hand.sort(compareTiles);
  }

  isMenzen(seat: Seat): boolean {
    return this.players[seat].melds.every((meld) => meld.type === "ankan");
  }

  /** Winning tiles of the player's 13 tile hand. */
  waits(seat: Seat): TileKind[] {
    const player = this.players[seat];
    return waitingKinds(countKinds(player.hand), player.melds.length);
  }

  private refreshFuriten(seat: Seat): void {
    const player = this.players[seat];
    const waits = new Set(this.waits(seat));
    player.furiten.permanent =
      waits.size > 0 && player.discards.some((discard) => waits.has(kindOf(discard.tile)));
  }

  isFuriten(seat: Seat): boolean {
    const player = this.players[seat];
    if (player.furiten.temporary || player.furiten.riichi) return true;
    const waits = new Set(this.waits(seat));
    return player.discards.some((discard) => waits.has(kindOf(discard.tile)));
  }

  // ------------------------------------------------------------------ options

  turnOptions(seat: Seat): TurnOptions | null {
    if (this.phase !== "turn" || this.turn !== seat) return null;
    const player = this.players[seat];
    const tiles = this.concealedTiles(seat);
    const forbidden = new Set(this.forbidden[seat]);

    const discard = player.riichi.declared
      ? player.drawn === null
        ? []
        : [player.drawn]
      : tiles.filter((tile) => !forbidden.has(kindOf(tile)));

    return {
      discard,
      riichi: this.riichiDiscards(seat),
      tsumo: this.canTsumo(seat),
      ankan: this.ankanKinds(seat),
      kakan: this.kakanTiles(seat),
      kyuushu: this.canKyuushu(seat),
    };
  }

  callOptions(seat: Seat): CallOptions | null {
    const call = this.pendingCalls?.find((entry) => entry.seat === seat && entry.response === null);
    return call ? call.options : null;
  }

  private riichiDiscards(seat: Seat): Tile[] {
    const player = this.players[seat];
    if (player.riichi.declared || player.drawn === null) return [];
    if (!this.isMenzen(seat)) return [];
    if (this.wallRemaining < 4) return [];
    if (this.rules.riichiRequiresPoints && player.score < 1000) return [];

    const tiles = this.concealedTiles(seat);
    const meldCount = player.melds.length;
    const result: Tile[] = [];
    const checked = new Set<TileKind>();
    for (const tile of tiles) {
      const kind = kindOf(tile);
      if (checked.has(kind)) continue;
      checked.add(kind);
      const rest = tiles.filter((candidate) => candidate !== tile);
      if (isTenpai(countKinds(rest), meldCount)) {
        for (const candidate of tiles) if (kindOf(candidate) === kind) result.push(candidate);
      }
    }
    return sortTiles(result);
  }

  private canTsumo(seat: Seat): boolean {
    const player = this.players[seat];
    if (player.drawn === null) return false;
    if (!isAgari(countKinds(this.concealedTiles(seat)), player.melds.length)) return false;
    return this.scoreWin(seat, player.drawn, null).valid;
  }

  private ankanKinds(seat: Seat): TileKind[] {
    const player = this.players[seat];
    if (this.wallRemaining <= 0 || this.kanCount >= 4) return [];
    const counts = countKinds(this.concealedTiles(seat));
    const kinds: TileKind[] = [];
    for (let kind = 0; kind < 34; kind += 1) {
      if (counts[kind] < 4) continue;
      if (player.riichi.declared && !this.riichiAnkanAllowed(seat, kind)) continue;
      kinds.push(kind);
    }
    return kinds;
  }

  /** In riichi a concealed kan is only allowed when it does not change the wait. */
  private riichiAnkanAllowed(seat: Seat, kind: TileKind): boolean {
    const player = this.players[seat];
    if (player.drawn === null) return false;
    if (!this.rules.strictRiichiAnkan) return true;
    if (kindOf(player.drawn) !== kind) return false;
    const before = new Set(waitingKinds(countKinds(player.hand), player.melds.length));
    const rest = countKinds(this.concealedTiles(seat));
    rest[kind] -= 4;
    const after = waitingKinds(rest, player.melds.length + 1);
    return after.length === before.size && after.every((wait) => before.has(wait));
  }

  private kakanTiles(seat: Seat): Tile[] {
    const player = this.players[seat];
    if (player.riichi.declared) return [];
    if (this.wallRemaining <= 0 || this.kanCount >= 4) return [];
    const ponKinds = new Set(
      player.melds.filter((meld) => meld.type === "pon").map((meld) => kindOf(meld.tiles[0])),
    );
    if (ponKinds.size === 0) return [];
    return this.concealedTiles(seat).filter((tile) => ponKinds.has(kindOf(tile)));
  }

  private canKyuushu(seat: Seat): boolean {
    if (!this.rules.kyuushuKyuuhai) return false;
    const player = this.players[seat];
    if (!this.firstGoAround || player.discards.length > 0 || player.drawn === null) return false;
    if (this.players.some((other) => other.melds.length > 0)) return false;
    const kinds = new Set(
      this.concealedTiles(seat)
        .map(kindOf)
        .filter((kind) => isTerminalOrHonor(kind)),
    );
    return kinds.size >= 9;
  }

  // ------------------------------------------------------------------ actions

  apply(seat: Seat, action: Action): void {
    if (this.phase === "handEnd" || this.phase === "gameEnd" || this.phase === "idle") {
      throw new GameError("no hand in progress");
    }
    if (this.phase === "calls") {
      this.applyCallResponse(seat, action);
      return;
    }
    if (this.turn !== seat) throw new GameError(`seat ${seat} cannot act now`);
    switch (action.type) {
      case "discard":
        this.doDiscard(seat, action.tile, action.riichi === true);
        return;
      case "tsumo":
        this.doTsumo(seat);
        return;
      case "ankan":
        this.doAnkan(seat, action.kind);
        return;
      case "kakan":
        this.doKakan(seat, action.tile);
        return;
      case "kyuushu":
        this.doKyuushu(seat);
        return;
      default:
        throw new GameError(`illegal turn action: ${action.type}`);
    }
  }

  private applyCallResponse(seat: Seat, action: Action): void {
    const call = this.pendingCalls?.find((entry) => entry.seat === seat);
    if (!call) throw new GameError(`seat ${seat} has no pending call`);
    if (call.response) throw new GameError(`seat ${seat} already responded`);

    let response: PendingResponse;
    switch (action.type) {
      case "pass":
        response = { type: "pass" };
        break;
      case "ron":
        if (!call.options.ron) throw new GameError("ron is not available");
        response = { type: "ron" };
        break;
      case "pon": {
        const option = call.options.pon.find((entry) => sameTiles(entry.tiles, action.tiles));
        if (!option) throw new GameError("pon is not available");
        response = { type: "pon", tiles: option.tiles };
        break;
      }
      case "chi": {
        const option = call.options.chi.find((entry) => sameTiles(entry.tiles, action.tiles));
        if (!option) throw new GameError("chi is not available");
        response = { type: "chi", tiles: option.tiles };
        break;
      }
      case "daiminkan":
        if (!call.options.daiminkan) throw new GameError("kan is not available");
        response = { type: "daiminkan" };
        break;
      default:
        throw new GameError(`illegal call response: ${action.type}`);
    }
    call.response = response;
    if (this.pendingCalls?.every((entry) => entry.response !== null)) this.resolveCalls();
  }

  // ------------------------------------------------------------------ discard

  private doDiscard(seat: Seat, tile: Tile, declareRiichi: boolean): void {
    const options = this.turnOptions(seat);
    if (!options) throw new GameError("not your turn");
    if (!options.discard.includes(tile)) throw new GameError("tile cannot be discarded");
    if (declareRiichi && !options.riichi.includes(tile)) {
      throw new GameError("riichi is not possible with this discard");
    }

    const player = this.players[seat];
    const tsumogiri = player.drawn === tile;
    if (tsumogiri) {
      player.drawn = null;
    } else {
      const index = player.hand.indexOf(tile);
      if (index < 0) throw new GameError("tile not in hand");
      player.hand.splice(index, 1);
      this.mergeDrawn(seat);
    }

    const discard: Discard = { tile, tsumogiri, riichi: declareRiichi, calledBy: null };
    player.discards.push(discard);
    player.firstDraw = false;
    player.riichi.ippatsu = false;
    this.forbidden[seat] = [];
    if (!isTerminalOrHonor(kindOf(tile))) player.nagashi = false;
    this.turnCount += 1;
    this.lastDiscard = { seat, tile, index: player.discards.length - 1 };
    if (declareRiichi) this.riichiPending = seat;

    this.flushPendingDora();
    this.refreshFuriten(seat);
    this.events.push({ type: "discard", seat, tile, tsumogiri, riichi: declareRiichi });

    const calls = this.collectDiscardCalls(seat, tile);
    if (calls.length > 0) {
      this.pendingCalls = calls;
      this.phase = "calls";
      return;
    }
    this.markMissedRon(seat, tile);
    this.afterDiscardResolved();
  }

  private collectDiscardCalls(discarder: Seat, tile: Tile): PendingCall[] {
    const calls: PendingCall[] = [];
    const kind = kindOf(tile);
    const lastTile = this.wallRemaining === 0;

    for (const other of SEATS) {
      if (other === discarder) continue;
      const player = this.players[other];
      const options: CallOptions = { ron: false, pon: [], chi: [], daiminkan: false };

      if (this.canRon(other, tile, discarder)) options.ron = true;

      if (!player.riichi.declared && !lastTile) {
        const counts = countKinds(player.hand);
        if (counts[kind] >= 2) {
          for (const pair of pairCombinations(player.hand, kind)) options.pon.push({ tiles: pair });
          if (counts[kind] >= 3 && this.kanCount < 4) options.daiminkan = true;
        }
        if (seatDistance(discarder, other) === 1) options.chi.push(...this.chiOptions(other, tile));
      }

      if (options.ron || options.pon.length > 0 || options.chi.length > 0 || options.daiminkan) {
        calls.push({ seat: other, options, response: null });
      }
    }
    return calls;
  }

  chiOptions(seat: Seat, tile: Tile): ChiOption[] {
    const kind = kindOf(tile);
    if (kind >= 27) return [];
    const player = this.players[seat];
    const rank = kind % 9;
    const suitStart = kind - rank;
    const options: ChiOption[] = [];

    const patterns: [number, number][] = [
      [rank - 2, rank - 1],
      [rank - 1, rank + 1],
      [rank + 1, rank + 2],
    ];

    for (const [a, b] of patterns) {
      if (a < 0 || b > 8 || a > 8 || b < 0) continue;
      const kindA = suitStart + a;
      const kindB = suitStart + b;
      const tilesA = player.hand.filter((candidate) => kindOf(candidate) === kindA);
      const tilesB = player.hand.filter((candidate) => kindOf(candidate) === kindB);
      for (const tileA of tilesA) {
        for (const tileB of tilesB) {
          if (tileA === tileB) continue;
          const combo: [Tile, Tile] = [tileA, tileB];
          if (options.some((entry) => sameTiles(entry.tiles, combo))) continue;
          options.push({ tiles: combo, forbidden: kuikaeKinds(kind, kindA, kindB) });
        }
      }
    }

    // Drop calls that would leave the caller without a legal discard.
    return options.filter((option) => {
      const rest = player.hand.filter((candidate) => !option.tiles.includes(candidate));
      return rest.some((candidate) => !option.forbidden.includes(kindOf(candidate)));
    });
  }

  private canRon(seat: Seat, tile: Tile, from: Seat): boolean {
    const player = this.players[seat];
    if (seat === from) return false;
    if (!isAgari(countKinds([...player.hand, tile]), player.melds.length)) return false;
    if (this.isFuriten(seat)) return false;
    return this.scoreWin(seat, tile, from, this.chankanOpen).valid;
  }

  /** Players who let a winning tile pass become temporarily (or permanently) furiten. */
  private markMissedRon(discarder: Seat, tile: Tile): void {
    const kind = kindOf(tile);
    for (const seat of SEATS) {
      if (seat === discarder) continue;
      const player = this.players[seat];
      if (!this.waits(seat).includes(kind)) continue;
      player.furiten.temporary = true;
      if (player.riichi.declared) player.furiten.riichi = true;
    }
  }

  private afterDiscardResolved(): void {
    this.confirmRiichi();
    this.pendingCalls = null;

    const abort = this.checkAbortiveDraw();
    if (abort) {
      this.endHandDraw(abort);
      return;
    }
    if (this.wallRemaining === 0) {
      this.endHandDraw("exhaustive");
      return;
    }
    const discarder = this.lastDiscard?.seat ?? this.turn;
    this.drawTile(nextSeat(discarder), false);
  }

  private confirmRiichi(): void {
    if (this.riichiPending === null) return;
    const seat = this.riichiPending;
    this.riichiPending = null;
    const player = this.players[seat];
    player.score -= 1000;
    this.riichiSticks += 1;
    player.riichi = {
      declared: true,
      double: this.rules.doubleRiichi && this.firstGoAround && player.discards.length === 1,
      ippatsu: true,
      turn: this.turnCount,
      discardIndex: player.discards.length - 1,
    };
    this.refreshFuriten(seat);
    this.events.push({ type: "riichi", seat });
  }

  private checkAbortiveDraw(): DrawReason | null {
    if (this.suukaikanPending) return "suukaikan";
    if (this.rules.suuchaRiichi && this.players.every((player) => player.riichi.declared)) {
      return "suuchaRiichi";
    }
    if (this.rules.suufonRenda && this.turnCount === 4 && this.firstGoAround) {
      const kinds = this.players.map((player) => kindOf(player.discards[0]?.tile ?? 0));
      const first = kinds[0];
      if (first >= 27 && first <= 30 && kinds.every((kind) => kind === first)) {
        return "suufonRenda";
      }
    }
    return null;
  }

  // -------------------------------------------------------------------- calls

  private resolveCalls(): void {
    const calls = this.pendingCalls ?? [];
    const rons = calls.filter((call) => call.response?.type === "ron");
    const kanInProgress = this.chankanOpen ? this.pendingKan : null;

    if (rons.length >= 3 && this.rules.sanchahou) {
      this.pendingCalls = null;
      this.chankanOpen = false;
      this.pendingKan = null;
      this.endHandDraw("sanchahou");
      return;
    }

    if (rons.length > 0) {
      const source = kanInProgress ? kanInProgress.seat : (this.lastDiscard?.seat as Seat);
      const tile = kanInProgress ? kanInProgress.tile : (this.lastDiscard?.tile as Tile);
      let winners = rons.map((call) => call.seat);
      winners.sort((a, b) => seatDistance(source, a) - seatDistance(source, b));
      if (this.rules.atamahane) winners = winners.slice(0, 1);
      this.pendingCalls = null;
      this.chankanOpen = false;
      this.pendingKan = null;
      this.endHandWin(
        winners.map((seat) => ({ seat, tile, from: source, chankan: kanInProgress !== null })),
      );
      return;
    }

    if (kanInProgress) {
      this.pendingCalls = null;
      this.chankanOpen = false;
      this.markMissedRon(kanInProgress.seat, kanInProgress.tile);
      this.completeKan();
      return;
    }

    const discarder = this.lastDiscard?.seat as Seat;
    const tile = this.lastDiscard?.tile as Tile;
    this.markMissedRon(discarder, tile);

    const winner =
      calls.find((call) => call.response?.type === "daiminkan") ??
      calls.find((call) => call.response?.type === "pon") ??
      calls.find((call) => call.response?.type === "chi");

    if (!winner) {
      this.afterDiscardResolved();
      return;
    }

    this.confirmRiichi();
    this.pendingCalls = null;
    const response = winner.response as PendingResponse;
    if (response.type === "daiminkan") this.executeDaiminkan(winner.seat, discarder, tile);
    else if (response.type === "pon") this.executePon(winner.seat, discarder, tile, response.tiles);
    else if (response.type === "chi") this.executeChi(winner.seat, discarder, tile, response.tiles);
  }

  private consumeDiscardedTile(discarder: Seat, caller: Seat): void {
    const player = this.players[discarder];
    const discard = player.discards[player.discards.length - 1];
    if (discard) discard.calledBy = caller;
    player.nagashi = false;
    this.firstGoAround = false;
    for (const other of this.players) other.riichi.ippatsu = false;
  }

  private removeFromHand(seat: Seat, tiles: readonly Tile[]): void {
    const player = this.players[seat];
    for (const tile of tiles) {
      const index = player.hand.indexOf(tile);
      if (index < 0) throw new GameError("tile not in hand");
      player.hand.splice(index, 1);
    }
  }

  private executePon(caller: Seat, from: Seat, tile: Tile, tiles: [Tile, Tile]): void {
    this.consumeDiscardedTile(from, caller);
    this.removeFromHand(caller, tiles);
    const meld: Meld = { type: "pon", tiles: sortTiles([...tiles, tile]), calledTile: tile, from };
    this.players[caller].melds.push(meld);
    this.players[caller].firstDraw = false;
    this.forbidden[caller] = [kindOf(tile)];
    this.events.push({ type: "meld", seat: caller, meld });
    this.turn = caller;
    this.phase = "turn";
    this.refreshFuriten(caller);
  }

  private executeChi(caller: Seat, from: Seat, tile: Tile, tiles: [Tile, Tile]): void {
    const option = this.chiOptions(caller, tile).find((entry) => sameTiles(entry.tiles, tiles));
    this.consumeDiscardedTile(from, caller);
    this.removeFromHand(caller, tiles);
    const meld: Meld = { type: "chi", tiles: sortTiles([...tiles, tile]), calledTile: tile, from };
    this.players[caller].melds.push(meld);
    this.players[caller].firstDraw = false;
    this.forbidden[caller] = option ? option.forbidden : [kindOf(tile)];
    this.events.push({ type: "meld", seat: caller, meld });
    this.turn = caller;
    this.phase = "turn";
    this.refreshFuriten(caller);
  }

  private executeDaiminkan(caller: Seat, from: Seat, tile: Tile): void {
    this.consumeDiscardedTile(from, caller);
    const kind = kindOf(tile);
    const owned = this.players[caller].hand
      .filter((candidate) => kindOf(candidate) === kind)
      .slice(0, 3);
    this.removeFromHand(caller, owned);
    const meld: Meld = {
      type: "daiminkan",
      tiles: sortTiles([...owned, tile]),
      calledTile: tile,
      from,
    };
    this.players[caller].melds.push(meld);
    this.players[caller].firstDraw = false;
    this.events.push({ type: "meld", seat: caller, meld });
    this.registerKan(caller);
    this.pendingDora += 1;
    this.drawTile(caller, true);
  }

  private registerKan(seat: Seat): void {
    this.kanCount += 1;
    this.kanSeats.push(seat);
    if (this.rules.suukaikan && this.kanCount >= 4 && new Set(this.kanSeats).size > 1) {
      this.suukaikanPending = true;
    }
  }

  // ---------------------------------------------------------------------- kan

  private doAnkan(seat: Seat, kind: TileKind): void {
    const options = this.turnOptions(seat);
    if (!options || !options.ankan.includes(kind)) throw new GameError("ankan is not available");
    const tile = this.concealedTiles(seat).find((candidate) => kindOf(candidate) === kind);
    if (tile === undefined) throw new GameError("kan tile not found");
    this.pendingKan = { seat, tile, kind: "ankan" };

    const calls = this.collectKokushiChankan(seat, tile);
    if (calls.length > 0) {
      this.pendingCalls = calls;
      this.chankanOpen = true;
      this.phase = "calls";
      return;
    }
    this.completeKan();
  }

  private doKakan(seat: Seat, tile: Tile): void {
    const options = this.turnOptions(seat);
    if (!options || !options.kakan.includes(tile)) throw new GameError("kakan is not available");
    this.pendingKan = { seat, tile, kind: "kakan" };

    this.chankanOpen = true;
    const calls = this.collectChankanCalls(seat, tile);
    if (calls.length > 0) {
      this.pendingCalls = calls;
      this.phase = "calls";
      return;
    }
    this.chankanOpen = false;
    this.markMissedRon(seat, tile);
    this.completeKan();
  }

  private collectChankanCalls(seat: Seat, tile: Tile): PendingCall[] {
    const calls: PendingCall[] = [];
    for (const other of SEATS) {
      if (other === seat) continue;
      if (!this.canRon(other, tile, seat)) continue;
      calls.push({
        seat: other,
        options: { ron: true, pon: [], chi: [], daiminkan: false },
        response: null,
      });
    }
    return calls;
  }

  /** Thirteen orphans may rob a concealed kan. */
  private collectKokushiChankan(seat: Seat, tile: Tile): PendingCall[] {
    const calls: PendingCall[] = [];
    for (const other of SEATS) {
      if (other === seat) continue;
      const player = this.players[other];
      if (player.melds.length > 0 || this.isFuriten(other)) continue;
      if (!isKokushi(countKinds([...player.hand, tile]))) continue;
      calls.push({
        seat: other,
        options: { ron: true, pon: [], chi: [], daiminkan: false },
        response: null,
      });
    }
    return calls;
  }

  private completeKan(): void {
    const pending = this.pendingKan;
    this.pendingKan = null;
    if (!pending) throw new GameError("no kan in progress");
    const { seat, tile, kind } = pending;
    const player = this.players[seat];
    this.mergeDrawn(seat);

    if (kind === "ankan") {
      const tileKind = kindOf(tile);
      const tiles = player.hand
        .filter((candidate) => kindOf(candidate) === tileKind)
        .slice(0, 4);
      this.removeFromHand(seat, tiles);
      const meld: Meld = { type: "ankan", tiles: sortTiles(tiles), calledTile: null, from: null };
      player.melds.push(meld);
      this.events.push({ type: "meld", seat, meld });
      this.registerKan(seat);
      this.revealDora();
    } else {
      this.removeFromHand(seat, [tile]);
      const meld = player.melds.find(
        (entry) => entry.type === "pon" && kindOf(entry.tiles[0]) === kindOf(tile),
      );
      if (!meld) throw new GameError("no pon to upgrade");
      meld.type = "kakan";
      meld.tiles = sortTiles([...meld.tiles, tile]);
      this.events.push({ type: "meld", seat, meld });
      this.registerKan(seat);
      this.pendingDora += 1;
    }

    for (const other of this.players) other.riichi.ippatsu = false;
    this.firstGoAround = false;
    this.drawTile(seat, true);
  }

  // -------------------------------------------------------------- hand ending

  private doKyuushu(seat: Seat): void {
    const options = this.turnOptions(seat);
    if (!options?.kyuushu) throw new GameError("kyuushu kyuuhai is not available");
    this.endHandDraw("kyuushuKyuuhai");
  }

  private doTsumo(seat: Seat): void {
    const options = this.turnOptions(seat);
    if (!options?.tsumo) throw new GameError("tsumo is not available");
    const player = this.players[seat];
    this.endHandWin([{ seat, tile: player.drawn as Tile, from: null, chankan: false }]);
  }

  scoreWin(seat: Seat, tile: Tile, from: Seat | null, chankan = false): ScoreResult {
    const player = this.players[seat];
    const tsumo = from === null;
    const hand = tsumo
      ? this.concealedTiles(seat).filter((candidate) => candidate !== tile)
      : [...player.hand];
    const haitei = tsumo ? this.wallRemaining === 0 && !this.lastDrawRinshan : this.wallRemaining === 0;
    return calculateScore({
      hand,
      melds: player.melds,
      winTile: tile,
      tsumo,
      seatWind: player.wind,
      roundWind: this.roundWind,
      doraIndicators: this.doraIndicators,
      uraIndicators: this.uraIndicators,
      riichi: player.riichi.declared && !player.riichi.double,
      doubleRiichi: player.riichi.double,
      ippatsu: player.riichi.ippatsu,
      haitei,
      rinshan: tsumo && this.lastDrawRinshan,
      chankan,
      blessing:
        this.firstGoAround &&
        player.discards.length === 0 &&
        this.players.every((other) => other.melds.length === 0),
      rules: this.rules,
    });
  }

  private endHandWin(claims: WinClaim[]): void {
    const scoreChanges = [0, 0, 0, 0];
    const results: WinResult[] = [];
    const honbaTotal = this.rules.honbaPoints * this.honba;
    const stickPoints = this.riichiSticks * 1000;

    claims.forEach((claim, index) => {
      const score = this.scoreWin(claim.seat, claim.tile, claim.from, claim.chankan);
      if (!score.valid) throw new GameError("winning hand has no yaku");
      const player = this.players[claim.seat];
      const isDealer = player.wind === 0;
      /** Riichi sticks and honba go to the winner closest to the discarder. */
      const isMainWinner = index === 0;
      const honbaGain = isMainWinner ? honbaTotal : 0;

      if (claim.from === null && score.tsumo) {
        const honbaShare = Math.round(honbaGain / 3);
        for (const other of SEATS) {
          if (other === claim.seat) continue;
          const base =
            !isDealer && this.players[other].wind === 0
              ? score.tsumo.fromDealer
              : score.tsumo.fromNonDealer;
          scoreChanges[other] -= base + honbaShare;
          scoreChanges[claim.seat] += base + honbaShare;
        }
      } else if (claim.from !== null && score.ron !== null) {
        scoreChanges[claim.from] -= score.ron + honbaGain;
        scoreChanges[claim.seat] += score.ron + honbaGain;
      }
      if (isMainWinner) scoreChanges[claim.seat] += stickPoints;

      results.push({
        seat: claim.seat,
        from: claim.from,
        hand: sortTiles(
          claim.from === null
            ? this.concealedTiles(claim.seat).filter((candidate) => candidate !== claim.tile)
            : player.hand,
        ),
        melds: player.melds.map((meld) => ({ ...meld, tiles: [...meld.tiles] })),
        winTile: claim.tile,
        han: score.han,
        fu: score.fu,
        points: score.points,
        yakuman: score.yakuman,
        yaku: score.yaku,
        limitName: score.limitName,
        text: score.text,
        doraCount: score.doraCount,
        uraCount: score.uraCount,
        akaCount: score.akaCount,
        honbaPoints: honbaGain,
        riichiStickPoints: isMainWinner ? stickPoints : 0,
      });
    });

    const anyRiichi = results.some((result) => this.players[result.seat].riichi.declared);
    this.riichiSticks = 0;
    this.finishHand({
      kind: "win",
      wins: results,
      drawReason: null,
      tenpai: [false, false, false, false],
      reveals: results.map((result) => ({
        seat: result.seat,
        hand: result.hand,
        melds: result.melds,
      })),
      scoreChanges,
      scoresAfter: [],
      doraIndicators: this.doraIndicators,
      uraIndicators: anyRiichi ? this.uraIndicators : [],
      renchan: results.some((result) => this.players[result.seat].wind === 0),
      honba: this.honba,
      riichiSticks: 0,
      gameOver: false,
    });
  }

  private endHandDraw(reason: DrawReason): void {
    const scoreChanges = [0, 0, 0, 0];
    const exhaustive = reason === "exhaustive";
    const tenpai = SEATS.map((seat) => {
      if (!exhaustive) return false;
      const player = this.players[seat];
      return isTenpai(countKinds(player.hand), player.melds.length);
    });

    let nagashiPaid = false;
    if (exhaustive && this.rules.nagashiMangan) {
      for (const seat of SEATS) {
        const player = this.players[seat];
        const qualifies =
          player.nagashi &&
          player.discards.length > 0 &&
          player.discards.every(
            (discard) => discard.calledBy === null && isTerminalOrHonor(kindOf(discard.tile)),
          );
        if (!qualifies) continue;
        nagashiPaid = true;
        const payments = limitPayments("mangan", player.wind === 0, true);
        for (const other of SEATS) {
          if (other === seat) continue;
          const amount =
            player.wind === 0
              ? payments.fromNonDealer
              : this.players[other].wind === 0
                ? payments.fromDealer
                : payments.fromNonDealer;
          scoreChanges[other] -= amount;
          scoreChanges[seat] += amount;
        }
      }
    }

    if (exhaustive && !nagashiPaid) {
      const tenpaiCount = tenpai.filter(Boolean).length;
      if (tenpaiCount > 0 && tenpaiCount < 4) {
        const receive = this.rules.notenPenalty / tenpaiCount;
        const pay = this.rules.notenPenalty / (4 - tenpaiCount);
        for (const seat of SEATS) scoreChanges[seat] += tenpai[seat] ? receive : -pay;
      }
    }

    this.finishHand({
      kind: "draw",
      wins: [],
      drawReason: reason,
      tenpai,
      reveals: SEATS.filter((seat) => tenpai[seat]).map((seat) => ({
        seat,
        hand: sortTiles(this.players[seat].hand),
        melds: this.players[seat].melds.map((meld) => ({ ...meld, tiles: [...meld.tiles] })),
      })),
      scoreChanges,
      scoresAfter: [],
      doraIndicators: this.doraIndicators,
      uraIndicators: [],
      renchan: exhaustive ? tenpai[this.dealer] : true,
      honba: this.honba,
      riichiSticks: this.riichiSticks,
      gameOver: false,
    });
  }

  private finishHand(result: HandResult): void {
    for (const seat of SEATS) this.players[seat].score += result.scoreChanges[seat];
    result.scoresAfter = this.players.map((player) => player.score);
    result.riichiSticks = this.riichiSticks;

    const bankrupt = this.rules.tobi && this.players.some((player) => player.score < 0);
    const finalHand = this.handNumber >= roundsInGame(this.rules);
    const targetReached = this.players.some((player) => player.score >= this.rules.returnPoints);
    const leader = [...this.players].sort((a, b) => b.score - a.score)[0];

    let gameOver = bankrupt;
    if (!gameOver && finalHand) {
      if (!result.renchan) gameOver = targetReached;
      else if (this.rules.agariYame && targetReached && leader.seat === this.dealer) gameOver = true;
    }
    if (!gameOver && this.handNumber >= MAX_HAND_NUMBER && !result.renchan) gameOver = true;

    this.honba = result.kind === "win" && !result.renchan ? 0 : this.honba + 1;

    if (!result.renchan && !gameOver) {
      this.dealer = nextSeat(this.dealer);
      this.roundNumber += 1;
      if (this.roundNumber > 4) {
        this.roundNumber = 1;
        this.roundWind = ((this.roundWind + 1) % 4) as Wind;
      }
    }

    result.gameOver = gameOver;
    this.handResult = result;
    this.phase = "handEnd";
    this.events.push({ type: "handEnd", result });

    if (gameOver) {
      this.gameResult = this.buildGameResult(bankrupt ? "tobi" : "normal");
      this.phase = "gameEnd";
      this.events.push({ type: "gameEnd", result: this.gameResult });
    }
  }

  private buildGameResult(reason: GameResult["reason"]): GameResult {
    const ordered = [...this.players].sort((a, b) =>
      b.score !== a.score ? b.score - a.score : a.seat - b.seat,
    );
    if (this.riichiSticks > 0) {
      ordered[0].score += this.riichiSticks * 1000;
      this.riichiSticks = 0;
    }
    const standings: FinalStanding[] = ordered.map((player, index) => ({
      seat: player.seat,
      name: player.name,
      rank: index + 1,
      score: player.score,
      points:
        Math.round(((player.score - this.rules.returnPoints) / 1000 + this.rules.uma[index]) * 10) /
        10,
    }));
    return { standings, reason };
  }
}

function sameTiles(a: readonly Tile[], b: readonly Tile[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((tile, index) => tile === sortedB[index]);
}

function pairCombinations(hand: readonly Tile[], kind: TileKind): [Tile, Tile][] {
  const tiles = hand.filter((tile) => kindOf(tile) === kind);
  const combos: [Tile, Tile][] = [];
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) combos.push([tiles[i], tiles[j]]);
  }
  return combos;
}

/** Tile kinds that may not be discarded right after a chi (swap calling). */
function kuikaeKinds(called: TileKind, kindA: TileKind, kindB: TileKind): TileKind[] {
  const forbidden: TileKind[] = [called];
  const low = Math.min(kindA, kindB);
  const high = Math.max(kindA, kindB);
  if (high - low === 1) {
    if (called === low - 1 && high % 9 < 8) forbidden.push(high + 1);
    if (called === high + 1 && low % 9 > 0) forbidden.push(low - 1);
  }
  return forbidden;
}
