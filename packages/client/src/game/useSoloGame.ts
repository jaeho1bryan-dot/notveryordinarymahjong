import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  botCallAction,
  botTurnAction,
  buildPlayerView,
  localizeDrawReason,
  localizeLimit,
  localizeYaku,
  MahjongGame,
  SEATS,
  type Action,
  type GameEvent,
  type PlayerView,
  type Seat,
} from "@mahjong/shared";

export type Mode = "solo" | "online";

export interface Controller {
  view: PlayerView | null;
  log: string[];
  error: string | null;
  connected: boolean;
  send: (action: Action) => void;
}

const WIND_KO = ["동", "남", "서", "북"];
const SUIT_KO = ["만", "통", "삭"];
const HONOR_KO = ["동", "남", "서", "북", "백", "발", "중"];

export function tileText(tile: number): string {
  const kind = tile >> 2;
  if (kind >= 27) return HONOR_KO[kind - 27] ?? "?";
  const rank = (kind % 9) + 1;
  const suit = Math.floor(kind / 9);
  const aka = rank === 5 && tile % 4 === 0;
  return `${aka ? "적" : ""}${rank}${SUIT_KO[suit]}`;
}

/** One human readable line per event, used for the side log. */
export function eventText(event: GameEvent, names: string[]): string | null {
  const who = (seat: Seat) => names[seat] ?? `P${seat + 1}`;
  switch (event.type) {
    case "handStart":
      return `${WIND_KO[event.roundWind]}${event.roundNumber}국 ${event.honba}본장 시작 (친: ${who(event.dealer)})`;
    case "discard":
      return `${who(event.seat)} 버림: ${event.tile < 0 ? "?" : tileText(event.tile)}`;
    case "meld": {
      const label =
        event.meld.type === "chi"
          ? "치"
          : event.meld.type === "pon"
            ? "퐁"
            : event.meld.type === "ankan"
              ? "안깡"
              : "깡";
      return `${who(event.seat)} ${label}`;
    }
    case "riichi":
      return `${who(event.seat)} 리치!`;
    case "dora":
      return `새 도라 표시패: ${tileText(event.indicator)}`;
    case "handEnd": {
      if (event.result.kind === "draw") {
        return `유국 · ${localizeDrawReason(event.result.drawReason ?? "exhaustive")}`;
      }
      return event.result.wins
        .map((win) => {
          const yaku = win.yaku.map((line) => localizeYaku(line.name)).join(", ");
          const limit = localizeLimit(win.limitName);
          const head = `${who(win.seat)} ${win.from === null ? "쯔모" : "론"} ${win.han}판 ${win.fu}부`;
          return `${head}${limit ? ` ${limit}` : ""} ${win.points}점 · ${yaku}`;
        })
        .join(" / ");
    }
    case "gameEnd":
      return `대국 종료 · 1위 ${who(event.result.standings[0].seat)}`;
    default:
      return null;
  }
}

const HUMAN_SEAT: Seat = 0;
const TICK = 120;
const BOT_TURN_DELAY = 520;
const BOT_CALL_DELAY = 300;
const HAND_END_DELAY = 8_000;

/** Runs the whole engine locally, with bots for the other three seats. */
export function useSoloGame(active: boolean, playerName: string): Controller {
  const [view, setView] = useState<PlayerView | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const gameRef = useRef<MahjongGame | null>(null);
  const namesRef = useRef<string[]>([]);

  const publish = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    const events = game.drainEvents();
    if (events.length > 0) {
      const lines = events
        .map((event) => eventText(event, namesRef.current))
        .filter((line): line is string => line !== null);
      if (lines.length > 0) setLog((previous) => [...previous, ...lines].slice(-80));
    }
    setView(buildPlayerView(game, HUMAN_SEAT, null));
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const names = [playerName || "나", "CPU 하지메", "CPU 니세이", "CPU 산타"];
    namesRef.current = names;
    const game = new MahjongGame({
      players: SEATS.map((seat) => ({ name: names[seat], isBot: seat !== HUMAN_SEAT })),
    });
    game.startHand();
    gameRef.current = game;
    setLog([]);
    setError(null);
    publish();

    const actAt: (number | null)[] = [null, null, null, null];
    let handEndAt: number | null = null;

    const timer = window.setInterval(() => {
      const now = Date.now();
      if (game.phase === "gameEnd") return;
      if (game.phase === "handEnd") {
        if (handEndAt === null) handEndAt = now + HAND_END_DELAY;
        if (now >= handEndAt) {
          handEndAt = null;
          game.nextHand();
          publish();
        }
        return;
      }
      handEndAt = null;
      const pending = game.pendingSeats();
      for (const seat of SEATS) {
        if (!pending.includes(seat)) actAt[seat] = null;
      }
      for (const seat of pending) {
        if (seat === HUMAN_SEAT) continue;
        if (actAt[seat] === null) {
          actAt[seat] = now + (game.phase === "calls" ? BOT_CALL_DELAY : BOT_TURN_DELAY);
          continue;
        }
        if (now < (actAt[seat] as number)) continue;
        actAt[seat] = null;
        try {
          const action =
            game.phase === "calls" ? botCallAction(game, seat) : botTurnAction(game, seat);
          game.apply(seat, action);
        } catch {
          try {
            game.apply(seat, { type: "pass" });
          } catch {
            /* the next tick retries */
          }
        }
        publish();
        return;
      }
    }, TICK);

    return () => {
      window.clearInterval(timer);
      gameRef.current = null;
    };
  }, [active, playerName, publish]);

  const send = useCallback(
    (action: Action) => {
      const game = gameRef.current;
      if (!game) return;
      try {
        game.apply(HUMAN_SEAT, action);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "처리할 수 없는 행동입니다.");
      }
      publish();
    },
    [publish],
  );

  return useMemo(
    () => ({ view, log, error, connected: active, send }),
    [view, log, error, active, send],
  );
}
