import { useCallback, useEffect, useRef, useState } from "react";
import type { Property } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";
import { ServerClock } from "../lib/clock.js";
import { wsUrl } from "../lib/wsUrl.js";
import { usePrefersReducedMotion } from "../lib/useReducedMotion.js";
import BrandMark from "../components/BrandMark.js";
import BarraTiempo from "../components/BarraTiempo.js";
import Confetti from "../components/Confetti.js";

type Fase = "join" | "reconectando" | "esperando" | "armado" | "corriendo" | "fin";

type DatosGuardados = { nickname: string; telefono: string; correo: string };

function cargarDatosGuardados(): DatosGuardados | null {
  try {
    const raw = localStorage.getItem("subasta_player");
    return raw ? (JSON.parse(raw) as DatosGuardados) : null;
  } catch {
    return null;
  }
}

const WS_URL = wsUrl("/ws/player");

export default function Play() {
  const clockRef = useRef(new ServerClock());
  const pinFromQr = new URLSearchParams(window.location.search).get("pin");
  const datosGuardados = useRef(cargarDatosGuardados()).current;
  const tieneResumeGuardado = Boolean(localStorage.getItem("subasta_resume") && datosGuardados);
  const [fase, setFase] = useState<Fase>(tieneResumeGuardado ? "reconectando" : "join");
  const [pin, setPin] = useState(pinFromQr ?? "1234");
  const [nickname, setNickname] = useState(datosGuardados?.nickname ?? "");
  const [telefono, setTelefono] = useState(datosGuardados?.telefono ?? "");
  const [correo, setCorreo] = useState(datosGuardados?.correo ?? "");
  const autoJoinIntentadoRef = useRef(false);
  const haJoineadoRef = useRef(false); // ya se recibio "joined" al menos una vez en esta pestana
  const nicknameRef = useRef(nickname);
  const telefonoRef = useRef(telefono);
  const correoRef = useRef(correo);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [valorPorTap, setValorPorTap] = useState(1_000_000);

  const [propiedad, setPropiedad] = useState<Property | null>(null);
  const [startAt, setStartAt] = useState(0);
  const [duracionMs, setDuracionMs] = useState(20_000);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);

  const [misTaps, setMisTaps] = useState(0); // conteo optimista local
  const [servidorTaps, setServidorTaps] = useState(0);
  const [miPosicion, setMiPosicion] = useState(0);
  const [lider, setLider] = useState<{ nickname: string; taps: number } | null>(null);
  const [coins, setCoins] = useState<{ id: number; x: number; rot: number; duracion: number }[]>([]);
  const coinIdRef = useRef(0);
  const [tapRafido, setTapRafido] = useState(false);
  const lastTapAtRef = useRef(0);
  const tapRafidoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [resultado, setResultado] = useState<{
    ganador: { nickname: string; valorFinal: number } | null;
    misTaps: number;
    recortados: number;
  } | null>(null);

  const seqRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const tapTimestampsRef = useRef<number[]>([]);
  const roundActiveRef = useRef(false);
  const resumeTokenRef = useRef<string | undefined>(localStorage.getItem("subasta_resume") ?? undefined);
  const roundIdRef = useRef<string | null>(null);
  const finTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFinTimeout = () => {
    if (finTimeoutRef.current) {
      clearTimeout(finTimeoutRef.current);
      finTimeoutRef.current = null;
    }
  };

  const clearTapRafidoTimeout = () => {
    if (tapRafidoTimeoutRef.current) {
      clearTimeout(tapRafidoTimeoutRef.current);
      tapRafidoTimeoutRef.current = null;
    }
  };

  const salirDelJuego = useCallback(() => {
    clearFinTimeout();
    clearTapRafidoTimeout();
    localStorage.removeItem("subasta_resume");
    localStorage.removeItem("subasta_player");
    haJoineadoRef.current = false;
    resumeTokenRef.current = undefined;
    roundIdRef.current = null;
    seqRef.current = 0;
    pendingTapsRef.current = 0;
    tapTimestampsRef.current = [];
    roundActiveRef.current = false;
    nicknameRef.current = "";
    telefonoRef.current = "";
    correoRef.current = "";
    setPlayerId(null);
    setPropiedad(null);
    setStartAt(0);
    setRoundId(null);
    setCountdown(0);
    setRemainingMs(0);
    setMisTaps(0);
    setServidorTaps(0);
    setMiPosicion(0);
    setLider(null);
    setCoins([]);
    setTapRafido(false);
    setResultado(null);
    setNickname("");
    setTelefono("");
    setCorreo("");
    setJoinError(null);
    setFase("join");
  }, []);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    switch (msg.t) {
      case "joined": {
        haJoineadoRef.current = true;
        setJoinError(null);
        setPlayerId(msg.playerId as string);
        setValorPorTap(msg.valorPorTap as number);
        resumeTokenRef.current = msg.resumeToken as string;
        localStorage.setItem("subasta_resume", msg.resumeToken as string);
        localStorage.setItem(
          "subasta_player",
          JSON.stringify({ nickname: nicknameRef.current, telefono: telefonoRef.current, correo: correoRef.current })
        );
        setFase("esperando");
        break;
      }
      case "round_armed": {
        clearFinTimeout();
        setPropiedad(msg.propiedad as Property);
        setStartAt(msg.startAt as number);
        setDuracionMs(msg.duracionMs as number);
        setRoundId(msg.roundId as string);
        roundIdRef.current = msg.roundId as string;
        seqRef.current = 0;
        pendingTapsRef.current = 0;
        tapTimestampsRef.current = [];
        setMisTaps(0);
        setServidorTaps(0);
        setLider(null);
        setCoins([]);
        setFase("armado");
        break;
      }
      case "tick": {
        setRemainingMs(msg.remainingMs as number);
        setServidorTaps(msg.misTaps as number);
        setMiPosicion(msg.miPosicion as number);
        setLider((msg.lider as { nickname: string; taps: number } | null) ?? null);
        break;
      }
      case "round_end": {
        roundActiveRef.current = false;
        setResultado({
          ganador: msg.ganador as { nickname: string; valorFinal: number } | null,
          misTaps: msg.misTaps as number,
          recortados: msg.recortados as number,
        });
        setFase("fin");
        clearFinTimeout();
        finTimeoutRef.current = setTimeout(() => {
          setFase((f) => (f === "fin" ? "esperando" : f));
        }, 10_000);
        break;
      }
      case "pong": {
        clockRef.current.addSample(msg.t0 as number, msg.t1 as number);
        break;
      }
      case "error": {
        console.warn("[server error]", msg);
        setJoinError(String(msg.mensaje ?? "No se pudo entrar a la subasta. Intenta de nuevo."));
        setFase((f) => (f === "reconectando" ? "join" : f));
        break;
      }
      case "reset": {
        salirDelJuego();
        break;
      }
    }
  }, [salirDelJuego]);

  const { send, connected } = useSocket(WS_URL, onMessage);

  // Limpia el timeout de "fin" -> "esperando" si el componente se desmonta.
  useEffect(() => clearFinTimeout, []);

  // Ping periódico para calibrar el reloj.
  useEffect(() => {
    if (!connected) return;
    const iv = setInterval(() => send({ t: "ping", t0: Date.now() }), 2000);
    send({ t: "ping", t0: Date.now() });
    return () => clearInterval(iv);
  }, [connected, send]);

  // Cuenta regresiva contra el reloj corregido del servidor.
  useEffect(() => {
    if (fase !== "armado") return;
    const iv = setInterval(() => {
      const msLeft = startAt - clockRef.current.now();
      if (msLeft <= 0) {
        clearInterval(iv);
        roundActiveRef.current = true;
        setFase("corriendo");
      } else {
        setCountdown(Math.ceil(msLeft / 1000));
      }
    }, 50);
    return () => clearInterval(iv);
  }, [fase, startAt]);

  // Envío del lote de taps cada 150ms.
  useEffect(() => {
    if (fase !== "corriendo") return;
    const iv = setInterval(() => {
      const count = pendingTapsRef.current;
      if (count === 0) return;
      pendingTapsRef.current = 0;

      const stamps = tapTimestampsRef.current;
      tapTimestampsRef.current = [];
      const firstTs = stamps[0] ?? Date.now();
      const lastTs = stamps[stamps.length - 1] ?? Date.now();
      const jitter = stddev(intervals(stamps));

      seqRef.current += 1;
      send({
        t: "tap_batch",
        roundId: roundIdRef.current,
        seq: seqRef.current,
        count,
        firstTs,
        lastTs,
        jitter,
      });
    }, 150);
    return () => clearInterval(iv);
  }, [fase, send]);

  const onJoin = () => {
    setJoinError(null);
    nicknameRef.current = nickname;
    telefonoRef.current = telefono;
    correoRef.current = correo;
    send({ t: "join", pin, nickname, telefono, correo, resumeToken: resumeTokenRef.current });
  };

  // Si el socket se cae un instante (wifi/señal) y vuelve a conectar a mitad
  // de partida, el servidor abre una conexion nueva que todavia no sabe a que
  // jugador pertenece: sin esto, el jugador se queda tocando "en el aire" sin
  // que el servidor lo cuente, hasta que recarga la pagina a mano. En cuanto
  // "connected" vuelve a true y ya nos habiamos unido antes en esta pestaña,
  // reenviamos "join" con el resumeToken para que el servidor lo reenganche
  // de inmediato, sin pedirle nada de nuevo al jugador.
  useEffect(() => {
    if (!connected || !haJoineadoRef.current) return;
    send({
      t: "join",
      pin,
      nickname: nicknameRef.current,
      telefono: telefonoRef.current,
      correo: correoRef.current,
      resumeToken: resumeTokenRef.current,
    });
  }, [connected, pin, send]);

  // Si ya se había registrado antes en este mismo celular (mismo navegador),
  // se reconecta solo sin pedirle de nuevo el formulario.
  useEffect(() => {
    if (!connected || !tieneResumeGuardado || autoJoinIntentadoRef.current) return;
    autoJoinIntentadoRef.current = true;
    nicknameRef.current = datosGuardados!.nickname;
    telefonoRef.current = datosGuardados!.telefono;
    correoRef.current = datosGuardados!.correo;
    send({
      t: "join",
      pin,
      nickname: datosGuardados!.nickname,
      telefono: datosGuardados!.telefono,
      correo: datosGuardados!.correo,
      resumeToken: resumeTokenRef.current,
    });
  }, [connected, tieneResumeGuardado, datosGuardados, pin, send]);

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
  const puedeEntrar =
    connected && nickname.trim().length > 0 && telefono.trim().length > 0 && emailValido;

  const onTap = (e: React.PointerEvent) => {
    if (!e.isTrusted || !roundActiveRef.current) return;
    pendingTapsRef.current += 1;
    const now = Date.now();
    tapTimestampsRef.current.push(now);
    setMisTaps((n) => n + 1);
    if (navigator.vibrate) navigator.vibrate(8);

    // Racha de taps muy seguidos (<180ms entre sí): sacude el contador un
    // instante para que se sienta más vivo. No toca el batching de arriba.
    if (!reducedMotion && now - lastTapAtRef.current < 180) {
      setTapRafido(true);
      clearTapRafidoTimeout();
      tapRafidoTimeoutRef.current = setTimeout(() => setTapRafido(false), 240);
    }
    lastTapAtRef.current = now;

    // Solo visual: una monedita que sube y se desvanece con cada tap.
    // Ángulo final y duración varían para que no se vean todas idénticas.
    const id = coinIdRef.current++;
    const x = (Math.random() - 0.5) * 160; // desplazamiento horizontal aleatorio
    const rot = (Math.random() - 0.5) * 70; // -35° a 35°, en cualquier sentido
    const duracion = 700 + Math.random() * 400; // 700-1100ms
    setCoins((cs) => [...cs, { id, x, rot, duracion }]);
    setTimeout(() => setCoins((cs) => cs.filter((c) => c.id !== id)), duracion + 50);
  };

  if (fase === "reconectando") {
    return (
      <Centered>
        <p className="font-display text-xl">Reconectando, {nickname}…</p>
        <p className="opacity-70 mt-2">Un momento, ya casi entras de nuevo a la subasta.</p>
      </Centered>
    );
  }

  if (fase === "join") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-escenario sm:px-6 phase-fade-in">
        <div className="w-full max-w-sm min-h-screen sm:min-h-0 sm:rounded-2xl overflow-hidden shadow-2xl shadow-black/30 flex flex-col font-body">
          {/* Banner con el mismo degradado del header de la consola de admin */}
          <div
            className="px-7 pt-14 pb-8 sm:pt-10"
            style={{ background: "linear-gradient(100deg, #7a4a12 0%, #173f70 46%, #0d3a63 100%)" }}
          >
            <BrandMark className="w-11 h-11 mb-3.5" />
            <h1 className="font-display text-2xl text-manila mb-1.5">Subasta Activa</h1>
            <p className="text-sm text-manila/75 leading-relaxed">Completa tus datos para participar en la subasta.</p>
          </div>

          <div className="flex-1 bg-manila text-archivo px-6 pt-7 pb-8 flex flex-col">
            <label className="block text-xs uppercase tracking-wide mb-1">Nombre</label>
            <input
              className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Tu nombre en pantalla"
            />

            <label className="block text-xs uppercase tracking-wide mb-1">Celular</label>
            <input
              className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="300 123 4567"
              inputMode="tel"
            />

            <label className="block text-xs uppercase tracking-wide mb-1">Correo</label>
            <input
              className="w-full mb-6 px-3 py-2 rounded border border-archivo/30"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="correo@empresa.com"
              type="email"
            />

            {joinError && (
              <p role="alert" className="text-sm text-archivo bg-sello/10 border border-sello/40 rounded px-3 py-2 mb-3">
                {joinError}
              </p>
            )}

            <button
              className="w-full bg-gradient-to-r from-azul to-navy3 text-manila py-3 rounded font-display transition-transform duration-150 ease-out hover:scale-105 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 disabled:active:scale-100"
              disabled={!puedeEntrar}
              onClick={onJoin}
            >
              {connected ? "Entrar" : "Conectando..."}
            </button>

            <div className="mt-auto pt-6 flex items-center justify-center gap-1.5 text-archivo/40 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-esmeralda" />
              Activos por Colombia S.A.S.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (fase === "esperando") {
    return (
      <Centered>
        <p className="font-display text-xl">Estás dentro, {nickname}.</p>
        <p className="opacity-70 mt-2">Esperando a que el presentador arme la siguiente ronda…</p>
        <button type="button" className="mt-8 px-4 py-2 rounded-full bg-sello/80 text-manila text-sm font-display hover:bg-sello transition-colors active:scale-95" onClick={salirDelJuego}>
          Salir
        </button>
      </Centered>
    );
  }

  if (fase === "armado") {
    return (
      <Centered>
        {propiedad?.imagenUrl && (
          <img
            src={propiedad.imagenUrl}
            alt={propiedad.nombre}
            className="w-64 h-40 object-cover rounded-xl mb-4 border-2 border-manila/20"
          />
        )}
        <p className="font-mono text-sm uppercase tracking-wide opacity-70">{propiedad?.nombre}</p>
        <p key={countdown} className="font-display text-7xl tabular mt-4 countdown-pop">
          {countdown > 0 ? countdown : "¡YA!"}
        </p>
        <p className="mt-4 opacity-70">Prepara el pulgar.</p>
      </Centered>
    );
  }

  if (fase === "corriendo") {
    const voyGanando = lider && lider.nickname === nickname;
    return (
      <div
        className="min-h-screen bg-gradient-to-b from-azul to-navy3 select-none flex flex-col items-center justify-center gap-8 relative overflow-hidden phase-fade-in"
        style={{ touchAction: "manipulation", overscrollBehavior: "none", WebkitTapHighlightColor: "transparent" }}
      >
        <div className="flex flex-col items-center pointer-events-none">
          {propiedad?.imagenUrl && (
            <img
              src={propiedad.imagenUrl}
              alt={propiedad.nombre}
              className="w-28 h-20 object-cover rounded-lg mb-3 border-2 border-manila/30"
            />
          )}
          <span
            key={misTaps}
            className={`font-mono tabular text-manila text-6xl font-bold tap-pop ${tapRafido ? "tap-shake" : ""}`}
          >
            {misTaps}
          </span>
          <span className="text-manila/90 mt-2">TAPS — {(misTaps * valorPorTap).toLocaleString("es-CO")} COP</span>
          <span className="text-manila/90 mt-6 font-mono tabular">{Math.ceil(remainingMs / 1000)}s</span>
          <div className="w-40 mt-2">
            <BarraTiempo remainingMs={remainingMs} duracionMs={duracionMs} />
          </div>
          <span className="text-manila/85 text-xs mt-1">posición #{miPosicion || "-"} · servidor: {servidorTaps}</span>
          {lider && (
            <span
              key={lider.nickname}
              className={`text-sm mt-3 font-display leader-pop ${voyGanando ? "text-oro" : "text-manila/90"}`}
            >
              {voyGanando ? "🏆 ¡Vas ganando!" : `🏆 Va ganando: ${lider.nickname}`}
            </span>
          )}
        </div>

        <button
          type="button"
          className="puja-glow w-72 h-72 max-w-[80vw] max-h-[80vw] aspect-square rounded-full bg-manila text-archivo font-display text-3xl tracking-wide active:scale-90 hover:scale-105 transition-transform relative"
          onPointerDown={onTap}
        >
          ¡PUJA!
          {coins.map((c) => (
            <span
              key={c.id}
              className="coin-float absolute text-3xl pointer-events-none"
              style={
                {
                  left: `calc(50% + ${c.x}px)`,
                  bottom: "50%",
                  "--coin-rot": `${c.rot}deg`,
                  "--coin-duration": `${c.duracion}ms`,
                } as React.CSSProperties
              }
            >
              🪙
            </span>
          ))}
        </button>
      </div>
    );
  }

  // fase === "fin"
  const soyGanador = resultado?.ganador?.nickname === nickname;
  return (
    <Centered>
      <Confetti activo={soyGanador} />
      <div className="scale-in-overshoot">
        <p className="font-display text-2xl mb-2">
          {resultado?.ganador ? "Ronda cerrada" : "Ronda cerrada, sin adjudicación"}
        </p>
        {resultado?.ganador && (
          <p className="opacity-80 mb-4">
            Ganó{" "}
            <span className={`text-oro font-semibold ${soyGanador ? "winner-glow" : ""}`}>
              {resultado.ganador.nickname}
            </span>{" "}
            con {resultado.ganador.valorFinal.toLocaleString("es-CO")} COP
          </p>
        )}
        <p className="font-mono tabular">Tus taps válidos: {resultado?.misTaps ?? 0}</p>
        {(resultado?.recortados ?? 0) > 0 && (
          <p className="text-sm opacity-60 mt-1">{resultado?.recortados} taps descartados (fuera de ventana)</p>
        )}
      </div>
      <button type="button" className="mt-8 px-4 py-2 rounded-full bg-sello/80 text-manila text-sm font-display hover:bg-sello transition-colors active:scale-95" onClick={salirDelJuego}>
        Salir
      </button>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-escenario text-manila px-6 font-body phase-fade-in">
      {children}
    </div>
  );
}

function intervals(stamps: number[]) {
  const out: number[] = [];
  for (let i = 1; i < stamps.length; i++) out.push(stamps[i] - stamps[i - 1]);
  return out;
}

function stddev(values: number[]) {
  if (values.length === 0) return 999; // sin datos suficientes: no se marca
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
