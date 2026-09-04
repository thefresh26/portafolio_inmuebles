import WebSocket from "ws";

const HOST_URL = "ws://localhost:8787/ws/host";
const PLAYER_URL = "ws://localhost:8787/ws/player";

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function onceType(ws, type) {
  return new Promise((resolve) => {
    function handler(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.t === type) {
        ws.off("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}

async function main() {
  const host = await connect(HOST_URL);
  host.send(JSON.stringify({ t: "host:join", token: "dev-host-token" }));
  const initialState = await onceType(host, "host:state");
  const propertyId = initialState.properties[0].id;
  console.log("[host] conectado, inmueble elegido:", initialState.properties[0].nombre);

  const players = [];
  const nombres = ["Ana", "Beto", "Carla"];
  for (const nombre of nombres) {
    const ws = await connect(PLAYER_URL);
    ws.send(JSON.stringify({ t: "join", pin: "1234", nickname: nombre }));
    const joined = await onceType(ws, "joined");
    players.push({ ws, nombre, playerId: joined.playerId, taps: 0 });
    console.log(`[jugador] ${nombre} conectado como ${joined.playerId}`);
  }

  // Cada jugador tapea a una tasa distinta y fija, para verificar que el
  // ranking del servidor sea coherente con quién tapeó más.
  const tasas = [9, 6, 3]; // taps/seg objetivo por jugador (Ana > Beto > Carla)

  const armedPromises = players.map((p) => onceType(p.ws, "round_armed"));
  host.send(JSON.stringify({ t: "host:arm", propertyId }));
  const armedMsgs = await Promise.all(armedPromises);
  const { roundId, startAt, duracionMs } = armedMsgs[0];
  console.log(`[ronda] armada, arranca en ${startAt - Date.now()}ms, dura ${duracionMs}ms`);

  // Simular batching real: cada jugador acumula taps y envía cada 150ms
  // mientras la ronda esté activa, respetando la ventana [startAt, startAt+duracion].
  const windowEnd = startAt + duracionMs;
  await new Promise((r) => setTimeout(r, Math.max(0, startAt - Date.now())));
  console.log("[ronda] arrancó");

  const startedAt = Date.now();
  const intervals = players.map((p, i) => {
    const tps = tasas[i];
    let seq = 0;
    let pending = 0;
    const tapTimer = setInterval(() => {
      if (Date.now() > windowEnd) return;
      pending += 1;
      p.taps += 1;
    }, 1000 / tps);
    const batchTimer = setInterval(() => {
      if (pending === 0) return;
      const count = pending;
      pending = 0;
      seq += 1;
      p.ws.send(
        JSON.stringify({
          t: "tap_batch",
          roundId,
          seq,
          count,
          firstTs: Date.now() - 150,
          lastTs: Date.now(),
          jitter: 12,
        })
      );
    }, 150);
    return { tapTimer, batchTimer };
  });

  const endPromises = players.map((p) => onceType(p.ws, "round_end"));
  await new Promise((r) => setTimeout(r, duracionMs + 800));
  intervals.forEach(({ tapTimer, batchTimer }) => {
    clearInterval(tapTimer);
    clearInterval(batchTimer);
  });

  const endMsgs = await Promise.all(endPromises);
  console.log("\n--- Resultado de la ronda ---");
  players.forEach((p, i) => {
    console.log(
      `${p.nombre}: taps enviados=${p.taps}, taps confirmados por servidor=${endMsgs[i].misTaps}, posición=${endMsgs[i].miPosicion}`
    );
  });
  console.log("Ganador anunciado:", endMsgs[0].ganador);

  const expectedWinner = "Ana"; // tapeó a la tasa más alta
  const ok =
    endMsgs[0].ganador?.nickname === expectedWinner &&
    players.every((p, i) => Math.abs(p.taps - endMsgs[i].misTaps) <= 1); // tolerancia de 1 por redondeo de timers

  console.log(ok ? "\n✅ SMOKE TEST OK" : "\n❌ SMOKE TEST FALLÓ");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
