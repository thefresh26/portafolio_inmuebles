import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, WebSocket } from "ws";
import {
  PlayerToServerMsg,
  HostToServerMsg,
} from "@subasta/shared";
import { GameRoom } from "./gameRoom.js";
import { verifyAdminToken, supabaseEnabled, createAdminUser } from "./supabase.js";

const PORT = Number(process.env.PORT ?? 8787);

const room = new GameRoom();
await room.initProperties();

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get("/health", async () => ({ ok: true, estado: room.state.estado, supabase: supabaseEnabled }));

const server = app.server;

const wssPlayer = new WebSocketServer({ noServer: true });
const wssScreen = new WebSocketServer({ noServer: true });
const wssHost = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/ws/player") {
    wssPlayer.handleUpgrade(req, socket, head, (ws) => wssPlayer.emit("connection", ws, req));
  } else if (url.pathname === "/ws/screen") {
    wssScreen.handleUpgrade(req, socket, head, (ws) => wssScreen.emit("connection", ws, req));
  } else if (url.pathname === "/ws/host") {
    wssHost.handleUpgrade(req, socket, head, (ws) => wssHost.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

// ---------- /ws/player ----------

wssPlayer.on("connection", (socket: WebSocket) => {
  let playerId: string | null = null;

  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const result = PlayerToServerMsg.safeParse(parsed);
    if (!result.success) {
      socket.send(JSON.stringify({ t: "error", code: "bad_message", mensaje: "Mensaje inválido" }));
      return;
    }
    const msg = result.data;

    if (msg.t === "join") {
      if (msg.pin !== room.state.pin) {
        socket.send(JSON.stringify({ t: "error", code: "bad_pin", mensaje: "PIN incorrecto" }));
        return;
      }
      const player = room.joinPlayer(msg.nickname, msg.telefono, msg.correo, msg.resumeToken, socket);
      playerId = player.playerId;
      socket.send(
        JSON.stringify({
          t: "joined",
          playerId: player.playerId,
          resumeToken: player.resumeToken,
          estado: room.state.estado,
          valorPorTap: room.state.valorPorTap,
        })
      );
      return;
    }

    if (msg.t === "ping") {
      if (playerId) room.handlePing(playerId, msg.t0);
      return;
    }

    if (msg.t === "tap_batch") {
      if (playerId) room.handleTapBatch(playerId, msg);
      return;
    }
  });

  socket.on("close", () => {
    if (playerId) room.disconnectPlayer(playerId);
  });
});

// ---------- /ws/screen ----------

wssScreen.on("connection", (socket: WebSocket) => {
  room.addScreen(socket);
  socket.on("close", () => room.removeScreen(socket));
});

// ---------- /ws/host ----------
// El admin se autentica con el access_token de una sesión de Supabase Auth
// (o, en desarrollo sin Supabase configurado, con el HOST_TOKEN fijo).

wssHost.on("connection", (socket: WebSocket) => {
  let authed = false;
  let adminEmail: string | undefined;

  socket.on("message", async (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const result = HostToServerMsg.safeParse(parsed);
    if (!result.success) return;
    const msg = result.data;

    if (msg.t === "host:join") {
      const verified = await verifyAdminToken(msg.token);
      authed = verified.ok;
      adminEmail = verified.email;
      if (authed) {
        room.addHost(socket);
      } else {
        socket.send(JSON.stringify({ t: "error", code: "bad_token", mensaje: "Sesión inválida o vencida" }));
        socket.close();
      }
      return;
    }

    if (!authed) return;

    try {
      switch (msg.t) {
        case "host:arm":
          await room.armRound(msg.propertyId);
          break;
        case "host:abort":
          room.abortRound();
          break;
        case "host:repeat":
          await room.repeatRound(msg.roundId);
          break;
        case "host:podium":
          room.buildPodium();
          break;
        case "host:create_property":
          await room.createPropertyEntry(msg.data);
          break;
        case "host:update_property":
          await room.updatePropertyEntry(msg.propertyId, msg.data);
          break;
        case "host:delete_property":
          await room.deletePropertyEntry(msg.propertyId);
          break;
        case "host:relist_property":
          await room.relistProperty(msg.propertyId);
          break;
        case "host:reset_players":
          room.resetPlayers();
          break;
        case "host:close_round":
          room.closeRound();
          break;
        case "host:create_admin": {
          const result = await createAdminUser(msg.email, msg.password);
          if (result.ok) {
            socket.send(JSON.stringify({ t: "host:admin_created", email: msg.email }));
          } else {
            socket.send(JSON.stringify({ t: "error", code: "admin_create_failed", mensaje: result.error }));
          }
          break;
        }
        case "host:start":
        case "host:next":
        case "host:kick":
          // host:start no hace falta: armRound ya programa el inicio automático.
          // host:next / host:kick quedan para una fase posterior.
          break;
      }
    } catch (err) {
      socket.send(JSON.stringify({ t: "error", code: "action_failed", mensaje: (err as Error).message }));
    }
  });

  socket.on("close", () => room.removeHost(socket));
});

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(
  `Servidor de Subasta Activa escuchando en :${PORT} (Supabase: ${supabaseEnabled ? "conectado" : "desconectado, modo local"})`
);
