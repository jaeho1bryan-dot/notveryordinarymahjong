import { Room, type Client } from "@colyseus/core";
import {
  botCallAction,
  botTurnAction,
  buildPlayerView,
  C2S,
  DEFAULT_RULES,
  GameError,
  makeRules,
  MahjongGame,
  maskEvent,
  S2C,
  SEATS,
  type Action,
  type ActionMessage,
  type ChatMessage,
  type GameEvent,
  type JoinOptions,
  type LobbyState,
  type RuleConfig,
  type Seat,
} from "@mahjong/shared";

interface SeatInfo {
  name: string;
  isBot: boolean;
  sessionId: string | null;
  ready: boolean;
  connected: boolean;
}

/** Milliseconds a human player gets for a decision. */
const TURN_TIME = 18_000;
const CALL_TIME = 10_000;
/** Bot "thinking" time so the table does not fast forward. */
const BOT_TURN_DELAY = 550;
const BOT_CALL_DELAY = 320;
/** Time the result screen stays up before the next hand starts. */
const HAND_END_TIME = 9_000;
const GAME_END_TIME = 120_000;
const RECONNECT_TIME = 120;
const TICK_INTERVAL = 200;

export class MahjongRoom extends Room {
  override maxClients = 4;

  private game: MahjongGame | null = null;
  private rules: RuleConfig = DEFAULT_RULES;
  private seats: SeatInfo[] = SEATS.map((seat) => ({
    name: `CPU ${seat + 1}`,
    isBot: true,
    sessionId: null,
    ready: false,
    connected: false,
  }));
  private actAt: (number | null)[] = [null, null, null, null];
  private handEndAt: number | null = null;
  private disposeAt: number | null = null;
  private started = false;

  override onCreate(options: JoinOptions = {}): void {
    this.rules = makeRules(options.rules);
    this.autoDispose = true;

    this.onMessage(C2S.ready, (client) => {
      const seat = this.seatOf(client);
      if (seat === null || this.started) return;
      this.seats[seat].ready = !this.seats[seat].ready;
      this.maybeStart();
      this.broadcastLobby();
    });

    this.onMessage(C2S.addBots, (client) => {
      const seat = this.seatOf(client);
      if (seat === null || this.started) return;
      this.startGame();
    });

    this.onMessage(C2S.action, (client, message: ActionMessage) => {
      const seat = this.seatOf(client);
      if (seat === null || !this.game) return;
      const action = message?.action;
      if (!action || typeof action.type !== "string") {
        client.send(S2C.error, { message: "잘못된 요청입니다." });
        return;
      }
      if (!this.game.pendingSeats().includes(seat)) {
        client.send(S2C.error, { message: "지금은 행동할 수 없습니다." });
        return;
      }
      try {
        this.game.apply(seat, action);
      } catch (error) {
        const message = error instanceof GameError ? error.message : "처리할 수 없는 행동입니다.";
        client.send(S2C.error, { message });
        this.sendViews();
        return;
      }
      this.afterChange();
    });

    this.onMessage(C2S.chat, (client, message: { text?: string }) => {
      const seat = this.seatOf(client);
      if (seat === null) return;
      const text = String(message?.text ?? "").slice(0, 140).trim();
      if (!text) return;
      const payload: ChatMessage = {
        seat,
        name: this.seats[seat].name,
        text,
        at: Date.now(),
      };
      this.broadcast(S2C.chat, payload);
    });

    this.clock.setInterval(() => this.tick(), TICK_INTERVAL);
  }

  override onJoin(client: Client, options: JoinOptions = {}): void {
    const seat = this.freeSeat();
    if (seat === null) {
      client.send(S2C.error, { message: "자리가 없습니다." });
      client.leave(4000);
      return;
    }
    const name = String(options.name ?? "").trim().slice(0, 16);
    this.seats[seat] = {
      name: name || `플레이어 ${seat + 1}`,
      isBot: false,
      sessionId: client.sessionId,
      ready: false,
      connected: true,
    };
    if (this.game) {
      const player = this.game.players[seat];
      player.name = this.seats[seat].name;
      player.isBot = false;
      player.connected = true;
    }
    this.broadcastLobby();
    if (options.solo === true && !this.started) {
      this.startGame();
      return;
    }
    if (this.started) this.sendViews();
  }

  override async onDrop(client: Client): Promise<void> {
    const seat = this.seatOf(client);
    if (seat === null) return;
    this.seats[seat].connected = false;
    if (this.game) this.game.players[seat].connected = false;
    this.broadcastLobby();
    if (this.started) this.sendViews();
    try {
      await this.allowReconnection(client, RECONNECT_TIME);
      this.seats[seat].connected = true;
      if (this.game) this.game.players[seat].connected = true;
      this.broadcastLobby();
      if (this.started) this.sendViews();
    } catch {
      // The client did not come back in time; onLeave finishes the cleanup.
    }
  }

  override onLeave(client: Client): void {
    const seat = this.seatOf(client);
    if (seat === null) return;
    this.seats[seat] = {
      name: this.started ? `CPU ${seat + 1}` : `CPU ${seat + 1}`,
      isBot: true,
      sessionId: null,
      ready: false,
      connected: false,
    };
    if (this.game) {
      this.game.players[seat].isBot = true;
      this.game.players[seat].connected = false;
      this.game.players[seat].name = this.seats[seat].name;
    }
    this.broadcastLobby();
    if (this.started) this.sendViews();
  }

  // --------------------------------------------------------------- lobby

  private seatOf(client: Client): Seat | null {
    const index = this.seats.findIndex((seat) => seat.sessionId === client.sessionId);
    return index >= 0 ? (index as Seat) : null;
  }

  private freeSeat(): Seat | null {
    const index = this.seats.findIndex((seat) => seat.sessionId === null);
    return index >= 0 ? (index as Seat) : null;
  }

  private humanSeats(): Seat[] {
    return SEATS.filter((seat) => this.seats[seat].sessionId !== null);
  }

  private lobbyState(): LobbyState {
    return {
      started: this.started,
      seats: SEATS.map((seat) => ({
        seat,
        name: this.seats[seat].name,
        isBot: this.seats[seat].isBot,
        connected: this.seats[seat].connected,
        ready: this.seats[seat].ready,
      })),
      rules: this.rules,
      countdown: null,
    };
  }

  private broadcastLobby(): void {
    this.broadcast(S2C.lobby, this.lobbyState());
  }

  private maybeStart(): void {
    if (this.started) return;
    const humans = this.humanSeats();
    if (humans.length === 0) return;
    if (humans.every((seat) => this.seats[seat].ready)) this.startGame();
  }

  private startGame(): void {
    if (this.started) return;
    this.started = true;
    void this.lock();
    this.game = new MahjongGame({
      rules: this.rules,
      players: SEATS.map((seat) => ({
        name: this.seats[seat].name,
        isBot: this.seats[seat].isBot,
      })),
    });
    for (const seat of SEATS) this.game.players[seat].connected = this.seats[seat].connected;
    this.game.startHand();
    this.broadcastLobby();
    this.afterChange();
  }

  // ---------------------------------------------------------------- loop

  private isBotSeat(seat: Seat): boolean {
    const info = this.seats[seat];
    return info.isBot || info.sessionId === null || !info.connected;
  }

  private delayFor(seat: Seat): number {
    const game = this.game;
    if (!game) return TURN_TIME;
    if (this.isBotSeat(seat)) {
      return game.phase === "calls" ? BOT_CALL_DELAY : BOT_TURN_DELAY;
    }
    return game.phase === "calls" ? CALL_TIME : TURN_TIME;
  }

  /** Recompute deadlines, flush events and send every player their own view. */
  private afterChange(): void {
    const game = this.game;
    if (!game) return;

    if (game.phase === "gameEnd") {
      this.actAt = [null, null, null, null];
      this.handEndAt = null;
      this.disposeAt = Date.now() + GAME_END_TIME;
      this.flushEvents();
      this.sendViews();
      return;
    }

    if (game.phase === "handEnd") {
      this.actAt = [null, null, null, null];
      if (this.handEndAt === null) this.handEndAt = Date.now() + HAND_END_TIME;
      this.flushEvents();
      this.sendViews();
      return;
    }

    this.handEndAt = null;
    const pending = new Set(game.pendingSeats());
    const now = Date.now();
    for (const seat of SEATS) {
      if (!pending.has(seat)) {
        this.actAt[seat] = null;
        continue;
      }
      if (this.actAt[seat] === null) this.actAt[seat] = now + this.delayFor(seat);
    }
    this.flushEvents();
    this.sendViews();
  }

  private tick(): void {
    const game = this.game;
    if (!game) return;

    const now = Date.now();
    if (game.phase === "gameEnd") {
      if (this.disposeAt !== null && now >= this.disposeAt) {
        this.disposeAt = null;
        void this.disconnect();
      }
      return;
    }

    if (game.phase === "handEnd") {
      if (this.handEndAt !== null && now >= this.handEndAt) {
        this.handEndAt = null;
        game.nextHand();
        this.afterChange();
      }
      return;
    }

    for (const seat of game.pendingSeats()) {
      const due = this.actAt[seat];
      if (due === null || now < due) continue;
      const action = this.isBotSeat(seat) ? this.botAction(seat) : this.autoAction(seat);
      this.actAt[seat] = null;
      try {
        game.apply(seat, action);
      } catch {
        try {
          game.apply(seat, this.autoAction(seat));
        } catch {
          // Nothing safe left to do for this seat; the next tick retries.
          this.actAt[seat] = Date.now() + 1_000;
          return;
        }
      }
      this.afterChange();
      return;
    }
  }

  private botAction(seat: Seat): Action {
    const game = this.game;
    if (!game) return { type: "pass" };
    try {
      return game.phase === "calls" ? botCallAction(game, seat) : botTurnAction(game, seat);
    } catch {
      return this.autoAction(seat);
    }
  }

  /** Safe fallback: pass on calls, tsumogiri on a turn. */
  private autoAction(seat: Seat): Action {
    const game = this.game;
    if (!game) return { type: "pass" };
    if (game.phase === "calls") return { type: "pass" };
    const options = game.turnOptions(seat);
    if (!options || options.discard.length === 0) return { type: "pass" };
    const player = game.players[seat];
    const drawn = player.drawn;
    const tile =
      drawn !== null && options.discard.includes(drawn) ? drawn : options.discard[0];
    return { type: "discard", tile };
  }

  // --------------------------------------------------------------- output

  private flushEvents(): void {
    const game = this.game;
    if (!game) return;
    const events = game.drainEvents();
    if (events.length === 0) return;
    for (const seat of this.humanSeats()) {
      const client = this.clients.get(this.seats[seat].sessionId ?? "");
      if (!client) continue;
      const masked: GameEvent[] = events.map((event) => maskEvent(event, seat));
      client.send(S2C.events, masked);
    }
  }

  private sendViews(): void {
    const game = this.game;
    if (!game) return;
    for (const seat of this.humanSeats()) {
      const client = this.clients.get(this.seats[seat].sessionId ?? "");
      if (!client) continue;
      client.send(S2C.view, buildPlayerView(game, seat, this.actAt[seat]));
    }
  }
}
