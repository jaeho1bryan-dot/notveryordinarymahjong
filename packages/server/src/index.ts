import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WebSocketTransport } from "@colyseus/ws-transport";
import { Server } from "@colyseus/core";
import express from "express";

import { MahjongRoom } from "./MahjongRoom.js";

const here = dirname(fileURLToPath(import.meta.url));
const clientDist = resolve(here, "../../client/dist");
const port = Number(process.env.PORT ?? 2567);

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.use(express.static(clientDist));
app.get(/^\/(?!colyseus|matchmake|health).*/, (_req, res) => {
  res.sendFile(resolve(clientDist, "index.html"), (error) => {
    if (error) res.status(404).send("client build not found - run `npm run build` first");
  });
});

const httpServer = createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("mahjong", MahjongRoom);

gameServer
  .listen(port)
  .then(() => {
    console.log(`[mahjong] listening on http://localhost:${port}`);
  })
  .catch((error: unknown) => {
    console.error("[mahjong] failed to start", error);
    process.exitCode = 1;
  });
