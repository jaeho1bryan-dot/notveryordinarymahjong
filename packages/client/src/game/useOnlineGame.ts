import { Client, type Room, type SeatReservation } from "colyseus.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  C2S,
  S2C,
  type Action,
  type ErrorMessage,
  type GameEvent,
  type LobbyState,
  type PlayerView,
} from "@mahjong/shared";

import { eventText, type Controller } from "./useSoloGame";

const httpEndpoint = (): string => {
  const override = import.meta.env.VITE_SERVER_URL;
  if (typeof override === "string" && override.length > 0) return override.replace(/\/$/, "");
  return window.location.origin;
};

/** Shape the matchmaker replies with (flat in 0.18, nested in older builds). */
interface MatchmakePayload {
  error?: string;
  room?: ReservedRoom;
  name?: string;
  roomId?: string;
  processId?: string;
  publicAddress?: string;
  sessionId?: string;
  reconnectionToken?: string;
  protocol?: string;
  devMode?: boolean;
}

/**
 * What `consumeSeatReservation` actually reads. The published typings model
 * `room` as `RoomAvailable` (with `clients`/`maxClients`), which the
 * matchmaker never sends, so the reservation is described separately and
 * narrowed once at the call site.
 */
interface ReservedRoom {
  name?: string;
  roomId?: string;
  processId?: string;
  publicAddress?: string;
}

interface Reservation {
  room: ReservedRoom;
  sessionId: string;
  reconnectionToken?: string;
  protocol?: string;
  devMode?: boolean;
}

/**
 * The 0.18 server answers matchmaking with a flat payload while the published
 * JS client still expects `{ room: { ... } }`, so the reservation is reshaped
 * before it is consumed.
 */
async function joinRoom(name: string, solo: boolean): Promise<Room> {
  const endpoint = httpEndpoint();
  const response = await fetch(`${endpoint}/matchmake/joinOrCreate/mahjong`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, solo }),
  });
  if (!response.ok) throw new Error(`매칭 실패 (${response.status})`);
  const payload = (await response.json()) as MatchmakePayload;
  if (payload.error) throw new Error(String(payload.error));
  if (!payload.sessionId) throw new Error("매칭 응답에 세션 정보가 없습니다.");
  const reservation: Reservation = {
    room: payload.room ?? {
      name: payload.name,
      roomId: payload.roomId,
      processId: payload.processId,
      publicAddress: payload.publicAddress,
    },
    sessionId: payload.sessionId,
    reconnectionToken: payload.reconnectionToken,
    protocol: payload.protocol,
    devMode: payload.devMode,
  };
  const client = new Client(endpoint.replace(/^http/, "ws"));
  return client.consumeSeatReservation(reservation as unknown as SeatReservation);
}

export function useOnlineGame(active: boolean, playerName: string, solo: boolean): Controller {
  const [view, setView] = useState<PlayerView | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const namesRef = useRef<string[]>(["P1", "P2", "P3", "P4"]);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    setLog([]);
    setError(null);

    joinRoom(playerName || "플레이어", solo)
      .then((room) => {
        if (cancelled) {
          void room.leave();
          return;
        }
        roomRef.current = room;
        setConnected(true);
        room.onMessage(S2C.view, (next: PlayerView) => {
          namesRef.current = next.players.map((player) => player.name);
          setView(next);
        });
        room.onMessage(S2C.events, (events: GameEvent[]) => {
          const lines = events
            .map((event) => eventText(event, namesRef.current))
            .filter((line): line is string => line !== null);
          if (lines.length > 0) setLog((previous) => [...previous, ...lines].slice(-80));
        });
        room.onMessage(S2C.lobby, (lobby: LobbyState) => {
          namesRef.current = lobby.seats.map((seat) => seat.name);
        });
        room.onMessage(S2C.error, (payload: ErrorMessage) => setError(payload.message));
        room.onLeave(() => {
          setConnected(false);
        });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "서버에 연결할 수 없습니다.");
      });

    return () => {
      cancelled = true;
      const room = roomRef.current;
      roomRef.current = null;
      setConnected(false);
      if (room) void room.leave();
    };
  }, [active, playerName, solo]);

  const send = useCallback((action: Action) => {
    roomRef.current?.send(C2S.action, { action });
  }, []);

  return useMemo(
    () => ({ view, log, error, connected, send }),
    [view, log, error, connected, send],
  );
}
