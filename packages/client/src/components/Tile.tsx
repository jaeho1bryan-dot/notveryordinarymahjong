import type { CSSProperties, ReactNode } from "react";

import { HIDDEN_TILE } from "@mahjong/shared";

const SUIT_CHARS = ["萬", "筒", "索"];
const HONOR_CHARS = ["東", "南", "西", "北", "白", "發", "中"];
const RANK_CHARS = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

export type TileSize = "xs" | "sm" | "md" | "lg";

export interface TileProps {
  tile: number;
  size?: TileSize;
  /** Lay the tile on its side (called / riichi discards). */
  sideways?: boolean;
  selected?: boolean;
  dim?: boolean;
  highlight?: boolean;
  onClick?: () => void;
  title?: string;
}

function face(tile: number): { body: ReactNode; suit: string; aka: boolean } {
  const kind = tile >> 2;
  const aka = kind === 4 || kind === 13 || kind === 22 ? tile % 4 === 0 : false;
  if (kind >= 27) {
    const char = HONOR_CHARS[kind - 27] ?? "?";
    return {
      body: <span className="tile-honor">{char}</span>,
      suit: kind >= 31 ? `dragon-${kind - 31}` : "wind",
      aka: false,
    };
  }
  const rank = (kind % 9) + 1;
  const suit = Math.floor(kind / 9);
  return {
    body: (
      <>
        <span className="tile-rank">{RANK_CHARS[rank - 1]}</span>
        <span className="tile-suit">{SUIT_CHARS[suit]}</span>
      </>
    ),
    suit: ["man", "pin", "sou"][suit],
    aka,
  };
}

export function Tile({
  tile,
  size = "md",
  sideways = false,
  selected = false,
  dim = false,
  highlight = false,
  onClick,
  title,
}: TileProps): ReactNode {
  const hidden = tile === HIDDEN_TILE || tile < 0;
  const classes = ["tile", `tile-${size}`];
  if (sideways) classes.push("tile-sideways");
  if (selected) classes.push("tile-selected");
  if (dim) classes.push("tile-dim");
  if (highlight) classes.push("tile-highlight");
  if (hidden) classes.push("tile-hidden");
  if (onClick) classes.push("tile-clickable");

  if (hidden) {
    return (
      <div className={classes.join(" ")} title={title}>
        <div className="tile-body tile-back" />
      </div>
    );
  }

  const { body, suit, aka } = face(tile);
  const style: CSSProperties | undefined = undefined;
  return (
    <div
      className={`${classes.join(" ")} tile-${suit}${aka ? " tile-aka" : ""}`}
      style={style}
      title={title}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="tile-body">{body}</div>
    </div>
  );
}

export function TileRow({
  tiles,
  size = "sm",
  onTile,
}: {
  tiles: number[];
  size?: TileSize;
  onTile?: (tile: number, index: number) => void;
}): ReactNode {
  return (
    <div className="tile-row">
      {tiles.map((tile, index) => (
        <Tile
          key={`${tile}-${index}`}
          tile={tile}
          size={size}
          onClick={onTile ? () => onTile(tile, index) : undefined}
        />
      ))}
    </div>
  );
}
