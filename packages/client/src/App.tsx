import { useMemo, useState, type ReactNode } from "react";

import {
  HIDDEN_TILE,
  localizeDrawReason,
  localizeLimit,
  localizeYaku,
  SEATS,
  type Action,
  type ChiOption,
  type Discard,
  type Meld,
  type PlayerView,
  type PonOption,
  type PublicPlayer,
  type Seat,
} from "@mahjong/shared";

import { Tile } from "./components/Tile";
import { useOnlineGame } from "./game/useOnlineGame";
import { useSoloGame, type Controller } from "./game/useSoloGame";

const WIND_KO = ["동", "남", "서", "북"];
const SEAT_SLOTS = ["bottom", "right", "top", "left"] as const;

type Mode = "solo" | "online" | null;

function MeldView({ meld }: { meld: Meld }): ReactNode {
  return (
    <div className="meld">
      {meld.tiles.map((tile, index) => (
        <Tile
          key={`${tile}-${index}`}
          tile={meld.type === "ankan" && (index === 0 || index === 3) ? HIDDEN_TILE : tile}
          size="xs"
          sideways={meld.calledTile !== null && meld.calledTile === tile}
        />
      ))}
    </div>
  );
}

function Pond({ discards }: { discards: Discard[] }): ReactNode {
  return (
    <div className="pond">
      {discards.map((discard, index) => (
        <Tile
          key={`${discard.tile}-${index}`}
          tile={discard.tile}
          size="xs"
          sideways={discard.riichi}
          dim={discard.calledBy !== null}
        />
      ))}
    </div>
  );
}

function SeatPanel({
  player,
  view,
  slot,
}: {
  player: PublicPlayer;
  view: PlayerView;
  slot: (typeof SEAT_SLOTS)[number];
}): ReactNode {
  const isYou = player.seat === view.you;
  const concealed = player.revealedHand;
  const classes = ["seat", `seat-${slot}`];
  if (player.active) classes.push("seat-active");
  if (player.seat === view.dealer) classes.push("seat-dealer");

  return (
    <div className={classes.join(" ")}>
      <div className="seat-header">
        <span className="seat-wind">{WIND_KO[player.wind]}</span>
        <span className="seat-name">{player.name}</span>
        {player.isBot ? <span className="seat-tag">CPU</span> : null}
        {!player.connected && !player.isBot ? (
          <span className="seat-tag warn">접속 끊김</span>
        ) : null}
        <span className="seat-score">{player.score.toLocaleString()}</span>
        {player.riichi.declared ? <span className="seat-riichi">리치</span> : null}
      </div>
      {!isYou ? (
        <div className="seat-hand">
          {concealed
            ? concealed.map((tile, index) => <Tile key={`${tile}-${index}`} tile={tile} size="xs" />)
            : Array.from({ length: player.handCount }, (_, index) => (
                <Tile key={index} tile={HIDDEN_TILE} size="xs" />
              ))}
          {player.hasDrawn && !concealed ? <Tile tile={HIDDEN_TILE} size="xs" /> : null}
        </div>
      ) : null}
      <div className="seat-melds">
        {player.melds.map((meld, index) => (
          <MeldView key={index} meld={meld} />
        ))}
      </div>
      <Pond discards={player.discards} />
    </div>
  );
}

function ResultOverlay({ view, onRestart }: { view: PlayerView; onRestart: () => void }): ReactNode {
  const result = view.handResult;
  const final = view.gameResult;

  if (final) {
    return (
      <div className="overlay">
        <div className="panel">
          <h2>대국 종료</h2>
          <table className="standings">
            <thead>
              <tr>
                <th>순위</th>
                <th>이름</th>
                <th>점수</th>
                <th>최종</th>
              </tr>
            </thead>
            <tbody>
              {final.standings.map((standing) => (
                <tr key={standing.seat}>
                  <td>{standing.rank}위</td>
                  <td>{standing.name}</td>
                  <td>{standing.score.toLocaleString()}</td>
                  <td>{standing.points > 0 ? `+${standing.points}` : standing.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="primary" onClick={onRestart}>
            처음으로
          </button>
        </div>
      </div>
    );
  }

  if (!result || view.phase !== "handEnd") return null;

  return (
    <div className="overlay">
      <div className="panel">
        <h2>
          {result.kind === "draw"
            ? localizeDrawReason(result.drawReason ?? "exhaustive")
            : "화료"}
        </h2>
        {result.wins.map((win, index) => (
          <div key={index} className="win">
            <div className="win-head">
              {view.players[win.seat].name} · {win.from === null ? "쯔모" : "론"} · {win.han}판{" "}
              {win.fu}부 {localizeLimit(win.limitName)}
            </div>
            <div className="win-tiles">
              {win.hand.map((tile, tileIndex) => (
                <Tile
                  key={`${tile}-${tileIndex}`}
                  tile={tile}
                  size="sm"
                  highlight={tile === win.winTile}
                />
              ))}
              {win.melds.map((meld, meldIndex) => (
                <MeldView key={meldIndex} meld={meld} />
              ))}
            </div>
            <ul className="yaku-list">
              {win.yaku.map((line, yakuIndex) => (
                <li key={yakuIndex}>
                  <span>{localizeYaku(line.name)}</span>
                  <span>{line.value}</span>
                </li>
              ))}
            </ul>
            <div className="win-points">{win.points.toLocaleString()}점</div>
          </div>
        ))}
        <div className="score-changes">
          {SEATS.map((seat) => (
            <div key={seat} className="score-change">
              <span>{view.players[seat].name}</span>
              <span className={result.scoreChanges[seat] >= 0 ? "plus" : "minus"}>
                {result.scoreChanges[seat] > 0 ? "+" : ""}
                {result.scoreChanges[seat].toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <div className="dora-reveal">
          <span>도라</span>
          {result.doraIndicators.map((tile, index) => (
            <Tile key={`d-${index}`} tile={tile} size="xs" />
          ))}
          {result.uraIndicators.length > 0 ? <span>뒷도라</span> : null}
          {result.uraIndicators.map((tile, index) => (
            <Tile key={`u-${index}`} tile={tile} size="xs" />
          ))}
        </div>
      </div>
    </div>
  );
}

function Table({ controller, onRestart }: { controller: Controller; onRestart: () => void }): ReactNode {
  const { view, send, log, error } = controller;
  const [riichiArmed, setRiichiArmed] = useState(false);
  const [chiChoices, setChiChoices] = useState<ChiOption[] | null>(null);
  const [ponChoices, setPonChoices] = useState<PonOption[] | null>(null);

  const myTurn = view !== null && view.phase === "turn" && view.turn === view.you;
  const turnOptions = myTurn ? view.turnOptions : null;
  const callOptions = view && view.phase === "calls" ? view.callOptions : null;

  const discardable = useMemo(() => {
    if (!turnOptions) return new Set<number>();
    return new Set(riichiArmed ? turnOptions.riichi : turnOptions.discard);
  }, [turnOptions, riichiArmed]);

  if (!view) {
    return (
      <div className="loading">
        <p>{error ?? "연결 중..."}</p>
      </div>
    );
  }

  const act = (action: Action) => {
    setRiichiArmed(false);
    setChiChoices(null);
    setPonChoices(null);
    send(action);
  };

  const discard = (tile: number) => {
    if (!discardable.has(tile)) return;
    act({ type: "discard", tile, riichi: riichiArmed });
  };

  const me = view.players[view.you];
  const orderedSeats = SEATS.map((offset) => ((view.you + offset) % 4) as Seat);

  return (
    <div className="table-root">
      <div className="table">
        {orderedSeats.map((seat, index) => (
          <SeatPanel key={seat} player={view.players[seat]} view={view} slot={SEAT_SLOTS[index]} />
        ))}

        <div className="center">
          <div className="center-round">
            {WIND_KO[view.roundWind]}
            {view.roundNumber}국 · {view.honba}본장
          </div>
          <div className="center-meta">
            <span>남은 패 {view.wallRemaining}</span>
            <span>리치봉 {view.riichiSticks}</span>
          </div>
          <div className="center-dora">
            {view.doraIndicators.map((tile, index) => (
              <Tile key={index} tile={tile} size="xs" />
            ))}
            {Array.from({ length: Math.max(0, 5 - view.doraIndicators.length) }, (_, index) => (
              <Tile key={`back-${index}`} tile={HIDDEN_TILE} size="xs" />
            ))}
          </div>
          <div className="center-status">
            {view.shanten <= 0 ? (
              <span className="tenpai">
                텐파이 {view.furiten.permanent || view.furiten.riichi ? "(후리텐)" : ""}
              </span>
            ) : (
              <span>{view.shanten}샹텐</span>
            )}
            {view.waits.length > 0 ? (
              <span className="waits">
                대기:{" "}
                {view.waits.map((kind) => (
                  <Tile key={kind} tile={kind * 4 + 1} size="xs" />
                ))}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="my-hand">
        {me.revealedHand?.map((tile, index) => (
          <Tile
            key={`${tile}-${index}`}
            tile={tile}
            size="lg"
            dim={turnOptions !== null && !discardable.has(tile)}
            onClick={turnOptions ? () => discard(tile) : undefined}
          />
        ))}
        {view.drawn !== null ? (
          <div className="drawn-wrap">
            <Tile
              tile={view.drawn}
              size="lg"
              dim={turnOptions !== null && !discardable.has(view.drawn)}
              onClick={turnOptions ? () => discard(view.drawn as number) : undefined}
            />
          </div>
        ) : null}
      </div>

      <div className="actions">
        {error ? <div className="error">{error}</div> : null}
        {turnOptions?.tsumo ? (
          <button type="button" className="primary" onClick={() => act({ type: "tsumo" })}>
            쯔모
          </button>
        ) : null}
        {turnOptions && turnOptions.riichi.length > 0 ? (
          <button
            type="button"
            className={riichiArmed ? "primary active" : "primary"}
            onClick={() => setRiichiArmed((value) => !value)}
          >
            {riichiArmed ? "리치 취소" : "리치"}
          </button>
        ) : null}
        {turnOptions?.ankan.map((kind) => (
          <button key={`ankan-${kind}`} type="button" onClick={() => act({ type: "ankan", kind })}>
            안깡
          </button>
        ))}
        {turnOptions?.kakan.map((tile) => (
          <button key={`kakan-${tile}`} type="button" onClick={() => act({ type: "kakan", tile })}>
            가깡
          </button>
        ))}
        {turnOptions?.kyuushu ? (
          <button type="button" onClick={() => act({ type: "kyuushu" })}>
            구종구패
          </button>
        ) : null}

        {callOptions?.ron ? (
          <button type="button" className="primary" onClick={() => act({ type: "ron" })}>
            론
          </button>
        ) : null}
        {callOptions && callOptions.pon.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              callOptions.pon.length === 1
                ? act({ type: "pon", tiles: callOptions.pon[0].tiles })
                : setPonChoices(callOptions.pon)
            }
          >
            퐁
          </button>
        ) : null}
        {callOptions && callOptions.chi.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              callOptions.chi.length === 1
                ? act({ type: "chi", tiles: callOptions.chi[0].tiles })
                : setChiChoices(callOptions.chi)
            }
          >
            치
          </button>
        ) : null}
        {callOptions?.daiminkan ? (
          <button type="button" onClick={() => act({ type: "daiminkan" })}>
            깡
          </button>
        ) : null}
        {callOptions ? (
          <button type="button" onClick={() => act({ type: "pass" })}>
            패스
          </button>
        ) : null}
      </div>

      {chiChoices ? (
        <div className="chooser">
          {chiChoices.map((option, index) => (
            <button key={index} type="button" onClick={() => act({ type: "chi", tiles: option.tiles })}>
              {option.tiles.map((tile, tileIndex) => (
                <Tile key={tileIndex} tile={tile} size="xs" />
              ))}
            </button>
          ))}
          <button type="button" onClick={() => setChiChoices(null)}>
            취소
          </button>
        </div>
      ) : null}
      {ponChoices ? (
        <div className="chooser">
          {ponChoices.map((option, index) => (
            <button key={index} type="button" onClick={() => act({ type: "pon", tiles: option.tiles })}>
              {option.tiles.map((tile, tileIndex) => (
                <Tile key={tileIndex} tile={tile} size="xs" />
              ))}
            </button>
          ))}
          <button type="button" onClick={() => setPonChoices(null)}>
            취소
          </button>
        </div>
      ) : null}

      <aside className="log">
        {log.slice(-14).map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </aside>

      <ResultOverlay view={view} onRestart={onRestart} />
    </div>
  );
}

export function App(): ReactNode {
  const [mode, setMode] = useState<Mode>(null);
  const [name, setName] = useState("플레이어");

  const solo = useSoloGame(mode === "solo", name);
  const online = useOnlineGame(mode === "online", name, true);
  const controller = mode === "online" ? online : solo;

  if (mode === null) {
    return (
      <div className="start">
        <h1>리치마작</h1>
        <p>작혼 스타일의 4인 리치마작 · 반장전(동남전)</p>
        <label>
          이름
          <input value={name} maxLength={16} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="start-buttons">
          <button type="button" className="primary" onClick={() => setMode("solo")}>
            혼자 연습 (브라우저에서 진행)
          </button>
          <button type="button" onClick={() => setMode("online")}>
            서버 대전 (Colyseus)
          </button>
        </div>
        <p className="hint">
          서버 대전은 <code>npm run dev:server</code> 로 게임 서버를 먼저 실행해야 합니다.
        </p>
      </div>
    );
  }

  return <Table controller={controller} onRestart={() => setMode(null)} />;
}
