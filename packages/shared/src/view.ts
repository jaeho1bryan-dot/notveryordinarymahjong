import type { MahjongGame } from "./engine.js";
import { shanten } from "./shanten.js";
import { countKinds, kindOf, type Tile, type TileKind } from "./tiles.js";
import type {
  CallOptions,
  Discard,
  FuritenState,
  GameEvent,
  GameResult,
  HandResult,
  Meld,
  Phase,
  RiichiState,
  Seat,
  TurnOptions,
  Wind,
} from "./types.js";
import { SEATS } from "./types.js";

/** Tile placeholder used for hidden information. */
export const HIDDEN_TILE = -1;

export interface PublicPlayer {
  seat: Seat;
  name: string;
  isBot: boolean;
  connected: boolean;
  score: number;
  wind: Wind;
  handCount: number;
  hasDrawn: boolean;
  melds: Meld[];
  discards: Discard[];
  riichi: RiichiState;
  /** Revealed hand (only at the end of a hand). */
  revealedHand: Tile[] | null;
  /** This seat has to act right now. */
  active: boolean;
}

export interface PlayerView {
  you: Seat;
  phase: Phase;
  roundWind: Wind;
  roundNumber: number;
  honba: number;
  riichiSticks: number;
  dealer: Seat;
  turn: Seat;
  wallRemaining: number;
  doraIndicators: Tile[];
  players: PublicPlayer[];
  hand: Tile[];
  drawn: Tile | null;
  turnOptions: TurnOptions | null;
  callOptions: CallOptions | null;
  lastDiscard: { seat: Seat; tile: Tile; index: number } | null;
  handResult: HandResult | null;
  gameResult: GameResult | null;
  shanten: number;
  waits: TileKind[];
  furiten: FuritenState;
  /** Unix ms deadline for the current decision (set by the server). */
  deadline: number | null;
}

export function buildPlayerView(game: MahjongGame, you: Seat, deadline: number | null = null): PlayerView {
  const reveals = new Map<Seat, Tile[]>();
  for (const reveal of game.handResult?.reveals ?? []) reveals.set(reveal.seat, reveal.hand);
  const pending = new Set(game.pendingSeats());
  const me = game.players[you];

  const players = SEATS.map<PublicPlayer>((seat) => {
    const player = game.players[seat];
    return {
      seat,
      name: player.name,
      isBot: player.isBot,
      connected: player.connected,
      score: player.score,
      wind: player.wind,
      handCount: player.hand.length,
      hasDrawn: player.drawn !== null,
      melds: player.melds.map((meld) => ({ ...meld, tiles: [...meld.tiles] })),
      discards: player.discards.map((discard) => ({ ...discard })),
      riichi: { ...player.riichi },
      revealedHand: seat === you ? [...player.hand] : (reveals.get(seat) ?? null),
      active: pending.has(seat),
    };
  });

  const concealed = me.drawn === null ? me.hand : [...me.hand, me.drawn];

  return {
    you,
    phase: game.phase,
    roundWind: game.roundWind,
    roundNumber: game.roundNumber,
    honba: game.honba,
    riichiSticks: game.riichiSticks,
    dealer: game.dealer,
    turn: game.turn,
    wallRemaining: game.wallRemaining,
    doraIndicators: game.doraIndicators,
    players,
    hand: [...me.hand],
    drawn: me.drawn,
    turnOptions: game.turnOptions(you),
    callOptions: game.callOptions(you),
    lastDiscard: game.lastDiscard ? { ...game.lastDiscard } : null,
    handResult: game.handResult,
    gameResult: game.gameResult,
    shanten: shanten(countKinds(concealed), me.melds.length),
    waits: game.waits(you),
    furiten: { ...me.furiten, permanent: game.isFuriten(you) && !me.furiten.temporary },
    deadline,
  };
}

/** Hide private information in events before broadcasting them to a seat. */
export function maskEvent(event: GameEvent, you: Seat): GameEvent {
  if (event.type === "draw" && event.seat !== you) {
    return { ...event, tile: HIDDEN_TILE };
  }
  return event;
}

export function isHidden(tile: Tile): boolean {
  return tile === HIDDEN_TILE;
}

export function tileKindOrNull(tile: Tile): TileKind | null {
  return tile === HIDDEN_TILE ? null : kindOf(tile);
}
