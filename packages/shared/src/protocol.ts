import type { Action, Seat } from "./types.js";
import type { GameEvent } from "./types.js";
import type { PlayerView } from "./view.js";
import type { RuleConfig } from "./rules.js";

/** Message names used on the Colyseus channel. */
export const C2S = {
  ready: "ready",
  action: "action",
  chat: "chat",
  addBots: "addBots",
} as const;

export const S2C = {
  view: "view",
  events: "events",
  lobby: "lobby",
  error: "error",
  chat: "chat",
} as const;

export interface LobbySeat {
  seat: Seat;
  name: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
}

export interface LobbyState {
  started: boolean;
  seats: LobbySeat[];
  rules: RuleConfig;
  countdown: number | null;
}

export interface ChatMessage {
  seat: Seat;
  name: string;
  text: string;
  at: number;
}

export interface ErrorMessage {
  message: string;
}

export interface JoinOptions {
  name?: string;
  /** Fill empty seats with bots and start immediately. */
  solo?: boolean;
  rules?: Partial<RuleConfig>;
}

export interface ActionMessage {
  action: Action;
}

export type ServerMessages = {
  [S2C.view]: PlayerView;
  [S2C.events]: GameEvent[];
  [S2C.lobby]: LobbyState;
  [S2C.error]: ErrorMessage;
  [S2C.chat]: ChatMessage;
};

export type ClientMessages = {
  [C2S.ready]: Record<string, never>;
  [C2S.action]: ActionMessage;
  [C2S.chat]: { text: string };
  [C2S.addBots]: Record<string, never>;
};
