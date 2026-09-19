import type { Tile, TileKind } from "./tiles.js";

export type Seat = 0 | 1 | 2 | 3;
/** 0 = East, 1 = South, 2 = West, 3 = North. */
export type Wind = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3];
export const WIND_NAMES_JA = ["東", "南", "西", "北"] as const;

export type MeldType = "chi" | "pon" | "daiminkan" | "kakan" | "ankan";

export interface Meld {
  type: MeldType;
  /** All tiles of the meld (3 or 4), sorted for display. */
  tiles: Tile[];
  /** The tile that was called from another player (null for ankan). */
  calledTile: Tile | null;
  /** Seat the called tile came from (null for ankan). */
  from: Seat | null;
}

export interface Discard {
  tile: Tile;
  /** Discarded straight from the draw (tsumogiri). */
  tsumogiri: boolean;
  /** This discard was the riichi declaration tile (rotated sideways). */
  riichi: boolean;
  /** Set when another player called this tile (it then leaves the pond visually). */
  calledBy: Seat | null;
}

export interface RiichiState {
  declared: boolean;
  double: boolean;
  ippatsu: boolean;
  /** Global turn counter when riichi was declared. */
  turn: number;
  /** Index in the player's own discard pile. */
  discardIndex: number;
}

export interface FuritenState {
  /** A winning tile sits in the player's own pond. */
  permanent: boolean;
  /** Passed on a winning tile this go-around (cleared on next draw). */
  temporary: boolean;
  /** Passed on a winning tile after declaring riichi (locked for the hand). */
  riichi: boolean;
}

export interface PlayerState {
  seat: Seat;
  name: string;
  isBot: boolean;
  connected: boolean;
  score: number;
  /** Concealed tiles excluding the freshly drawn tile. */
  hand: Tile[];
  /** Freshly drawn tile (tsumohai), kept separate so the UI can show it apart. */
  drawn: Tile | null;
  melds: Meld[];
  discards: Discard[];
  riichi: RiichiState;
  furiten: FuritenState;
  /** Still eligible for nagashi mangan (all discards are terminals/honors and never called). */
  nagashi: boolean;
  /** Player has not drawn/called yet in the hand (used for tenhou/chiihou/kyuushu). */
  firstDraw: boolean;
  /** Seat wind for the current hand. */
  wind: Wind;
}

export type Phase =
  /** Nothing dealt yet. */
  | "idle"
  /** `turn` player has to act (discard / tsumo / kan / kyuushu). */
  | "turn"
  /** Waiting for responses to a discard, a kakan (chankan) or an ankan (kokushi chankan). */
  | "calls"
  /** Hand finished, showing results. */
  | "handEnd"
  /** Whole game finished. */
  | "gameEnd";

export type CallKind = "ron" | "pon" | "chi" | "daiminkan";

export interface ChiOption {
  /** The two tiles from the caller's hand. */
  tiles: [Tile, Tile];
  /** Tiles that may not be discarded afterwards (kuikae). */
  forbidden: TileKind[];
}

export interface PonOption {
  tiles: [Tile, Tile];
}

export interface CallOptions {
  ron: boolean;
  pon: PonOption[];
  chi: ChiOption[];
  daiminkan: boolean;
}

export interface TurnOptions {
  /** Tiles the player is allowed to discard. */
  discard: Tile[];
  /** Tiles that can be discarded while declaring riichi (empty if riichi is impossible). */
  riichi: Tile[];
  tsumo: boolean;
  ankan: TileKind[];
  /** Tiles from the hand that may be added to an existing pon. */
  kakan: Tile[];
  kyuushu: boolean;
}

export type PendingResponse =
  | { type: "pass" }
  | { type: "ron" }
  | { type: "pon"; tiles: [Tile, Tile] }
  | { type: "chi"; tiles: [Tile, Tile] }
  | { type: "daiminkan" };

export interface PendingCall {
  seat: Seat;
  options: CallOptions;
  response: PendingResponse | null;
}

export type Action =
  | { type: "discard"; tile: Tile; riichi?: boolean }
  | { type: "tsumo" }
  | { type: "ron" }
  | { type: "pon"; tiles: [Tile, Tile] }
  | { type: "chi"; tiles: [Tile, Tile] }
  | { type: "daiminkan" }
  | { type: "ankan"; kind: TileKind }
  | { type: "kakan"; tile: Tile }
  | { type: "kyuushu" }
  | { type: "pass" };

export type DrawReason =
  | "exhaustive"
  | "kyuushuKyuuhai"
  | "suufonRenda"
  | "suuchaRiichi"
  | "suukaikan"
  | "sanchahou";

export interface YakuLine {
  /** Japanese name as reported by the scoring library. */
  name: string;
  /** e.g. `2飜`, `役満`. */
  value: string;
  han: number;
  yakuman: number;
}

export interface WinResult {
  seat: Seat;
  /** Discarder seat, or null when the win was a tsumo. */
  from: Seat | null;
  hand: Tile[];
  melds: Meld[];
  winTile: Tile;
  han: number;
  fu: number;
  /** Base points before honba/riichi sticks. */
  points: number;
  yakuman: number;
  yaku: YakuLine[];
  /** e.g. `満貫`, `跳満`, `役満`; empty for ordinary hands. */
  limitName: string;
  text: string;
  doraCount: number;
  uraCount: number;
  akaCount: number;
  /** Extra points from honba counters. */
  honbaPoints: number;
  /** Riichi sticks collected by this winner. */
  riichiStickPoints: number;
}

export interface HandResult {
  kind: "win" | "draw";
  wins: WinResult[];
  drawReason: DrawReason | null;
  /** Tenpai flags at an exhaustive draw. */
  tenpai: boolean[];
  /** Hands revealed at the end of the hand (winners, tenpai players at a draw). */
  reveals: { seat: Seat; hand: Tile[]; melds: Meld[] }[];
  scoreChanges: number[];
  scoresAfter: number[];
  doraIndicators: Tile[];
  uraIndicators: Tile[];
  /** Dealer keeps the dealership. */
  renchan: boolean;
  honba: number;
  riichiSticks: number;
  /** The game ended with this hand. */
  gameOver: boolean;
}

export interface FinalStanding {
  seat: Seat;
  name: string;
  rank: number;
  score: number;
  /** Final score in 1000 point units including uma/oka. */
  points: number;
}

export interface GameResult {
  standings: FinalStanding[];
  reason: "normal" | "tobi" | "abort";
}

export type GameEvent =
  | { type: "handStart"; roundWind: Wind; roundNumber: number; honba: number; dealer: Seat }
  | { type: "draw"; seat: Seat; tile: Tile; rinshan: boolean }
  | { type: "discard"; seat: Seat; tile: Tile; tsumogiri: boolean; riichi: boolean }
  | { type: "meld"; seat: Seat; meld: Meld }
  | { type: "riichi"; seat: Seat }
  | { type: "dora"; indicator: Tile }
  | { type: "handEnd"; result: HandResult }
  | { type: "gameEnd"; result: GameResult };
