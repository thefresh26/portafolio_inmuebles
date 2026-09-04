import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Property } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";
import { wsUrl } from "../lib/wsUrl.js";
import { useFlip } from "../lib/useFlip.js";
import { usePrefersReducedMotion } from "../lib/useReducedMotion.js";
import BrandMark from "../components/BrandMark.js";
import BarraTiempo from "../components/BarraTiempo.js";

const WS_URL = wsUrl("/ws/screen");

type PlayerSummary = { playerId: string; nickname: string; taps: number; valorPujado: number };
type Portafolio = { playerId: string; nickname: string; inmueblesAdjudicados: number; valorTotal: number; titulo?: string };

type PiezaConfeti = { id: number; left: number; delay: number; duracion: number; rot: number; color: string };

const CONFETTI_COLORES = ["bg-oro", "bg-azul", "bg-esmeralda", "bg-manila"];

function generarConfeti(cantidad: number): PiezaConfeti[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 700,
    duracion: 2200 + Math.random() * 1400,
    rot: Math.random() * 360,
    color: CONFETTI_COLORES[i % CONFETTI_COLORES.length],
  }));
}

export default function Screen() {
  const [pin, setPin] = useState("----");
  const [jugadores, setJugadores] = useState<{ playerId: string; nickname: string }[]>([]);
  const [propiedad, setPropiedad] = useState<Property | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [duracionMs, setDuracionMs] = useState(20_000);
  const [top5, setTop5] = useState<PlayerSummary[]>([]);
  const [tapsTotales, setTapsTotales] = useState(0);
  const [sello, setSello] = useState<{ ganador: string; valorFinal: number } | null>(null);
  const [podio, setPodio] = useState<Portafolio[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [confetti, setConfetti] = useState<PiezaConfeti[]>([]);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    switch (msg.t) {
      case "lobby":
        setPin(msg.pin as string);
        setJugadores(msg.jugadores as { playerId: string; nickname: string }[]);
        setQrUrl(msg.qrUrl as string);
        break;
      case "round_armed":
        setPropiedad(msg.propiedad as Property);
        setDuracionMs(msg.duracionMs as number);
        setSello(null);
        setTop5([]);
        break;
      case "tick":
        setRemainingMs(msg.remainingMs as number);
        setTop5(msg.top5 as PlayerSummary[]);
        setTapsTotales(msg.tapsTotales as number);
        break;
      case "round_end":
        setSello(
          (msg.ganador as { nickname: string; valorFinal: number } | null)
            ? { ganador: (msg.ganador as { nickname: string }).nickname, valorFinal: msg.valorFinal as number }
            : null
        );
        setTop5(msg.top5 as PlayerSummary[]);
        break;
      case "podium":
        setPodio(msg.portafolios as Portafolio[]);
        break;
    }
  }, []);

  useSocket(WS_URL, onMessage);

  const top5FlipRef = useFlip(top5.map((p) => p.playerId));
  const reducedMotion = usePrefersReducedMotion();

  // Genera las posiciones del confeti una sola vez por adjudicación (no en
  // cada render): se regenera cuando `sello` pasa de null a un valor.
  useEffect(() => {
    if (sello) setConfetti(generarConfeti(36));
  }, [sello]);

  // Detecta, comparando contra el valor anterior de cada jugador (guardado
  // en un ref), a quién le subió la puja desde el último tick, para
  // dispararle el pop solo a esos valores (no a todos en cada render).
  const valoresPreviosRef = useRef<Record<string, number>>({});
  const [popGen, setPopGen] = useState<Record<string, number>>({});
  useEffect(() => {
    const anteriores = valoresPreviosRef.current;
    const subieron: Record<string, number> = {};
    for (const p of top5) {
      if (anteriores[p.playerId] !== undefined && p.valorPujado > anteriores[p.playerId]) {
        subieron[p.playerId] = (popGen[p.playerId] ?? 0) + 1;
      }
    }
    valoresPreviosRef.current = Object.fromEntries(top5.map((p) => [p.playerId, p.valorPujado]));
    if (Object.keys(subieron).length > 0) {
      setPopGen((g) => ({ ...g, ...subieron }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top5]);

  if (podio) {
    return (
      <FullScreen>
        <h1 className="font-display text-4xl mb-8">Podio final</h1>
        <div className="flex gap-6">
          {podio.slice(0, 3).map((p, i) => (
            <div key={p.playerId} className="bg-manila text-archivo rounded-xl p-6 w-64 text-center">
              <p className="text-oro font-mono text-sm">#{i + 1}</p>
              <p className="font-display text-xl mt-2">{p.nickname}</p>
              <p className="text-sm opacity-70 mt-1">{p.titulo}</p>
              <p className="font-mono tabular mt-3">
                {p.inmueblesAdjudicados} activos · {p.valorTotal.toLocaleString("es-CO")} COP
              </p>
            </div>
          ))}
        </div>
      </FullScreen>
    );
  }

  if (!propiedad) {
    const joinUrl = qrUrl ? `${window.location.origin}${qrUrl}` : null;
    return (
      <FullScreen>
        <BrandMark className="w-16 h-16 mb-6" />
        {joinUrl ? (
          <div className="bg-manila p-6 rounded-xl mb-6">
            <QRCodeSVG value={joinUrl} size={340} />
          </div>
        ) : null}
        <p className="opacity-70 mb-8">Escanea el código QR para participar</p>
        <p className="opacity-50">{jugadores.length} jugador(es) conectado(s)</p>
      </FullScreen>
    );
  }

  if (sello) {
    return (
      <FullScreen>
        {!reducedMotion && (
          <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
            {confetti.map((p) => (
              <span
                key={p.id}
                className={`confetti-piece absolute top-0 w-2 h-3 rounded-sm ${p.color}`}
                style={
                  {
                    left: `${p.left}%`,
                    "--confetti-duration": `${p.duracion}ms`,
                    "--confetti-delay": `${p.delay}ms`,
                    "--confetti-rot": `${p.rot}deg`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}
        <div className="relative z-10 text-center scale-in-overshoot">
          <p className={`text-7xl ${!reducedMotion ? "trophy-bounce" : ""}`} aria-hidden="true">
            🏆
          </p>
          <p className={`font-display text-5xl text-oro mt-4 ${!reducedMotion ? "winner-glow" : ""}`}>
            ¡Ha ganado {sello.ganador}!
          </p>
          <p className="font-mono tabular text-2xl mt-3">{sello.valorFinal.toLocaleString("es-CO")} COP</p>
        </div>
      </FullScreen>
    );
  }

  // Ronda en vivo: la foto queda fija arriba como "meta" y las barras
  // verticales de puja crecen hacia ella; tiempo y taps van debajo.
  return (
    <div className="min-h-screen bg-gradient-to-br from-archivo via-navy3 to-archivo text-manila font-body flex items-center justify-center p-6 lg:p-10">
      <FullscreenButton />
      <div className="w-full max-w-3xl flex flex-col items-center text-center">
        <p className="font-mono text-sm uppercase opacity-70">{propiedad.matriculaInmobiliaria}</p>
        <h2 className="font-display text-3xl lg:text-5xl mt-1">{propiedad.nombre}</h2>
        <p className="opacity-70 text-base lg:text-lg mt-2">
          {propiedad.ciudad} · {propiedad.areaM2} m² · avalúo {propiedad.avaluo.toLocaleString("es-CO")} COP
        </p>

        <div className="mt-6 flex flex-col items-center">
          {propiedad.imagenUrl ? (
            <img
              src={propiedad.imagenUrl}
              alt={propiedad.nombre}
              className="w-64 h-40 object-cover rounded-xl border-4 border-oro/40 shadow-xl"
            />
          ) : (
            <div className="w-64 h-40 rounded-xl bg-manila/10 border-4 border-oro/40 flex items-center justify-center">
              <BrandMark className="w-14 h-14 opacity-40" />
            </div>
          )}
          <p className="text-sm opacity-70 mt-2">¡Llega hasta aquí!</p>
        </div>

        <div
          ref={top5FlipRef}
          className="mt-6 flex items-end justify-center gap-4 bg-gradient-to-b from-navy3/40 to-archivo/40 backdrop-blur-sm rounded-xl border border-manila/10 shadow-lg shadow-black/20 p-6"
        >
          {(() => {
            const valorMaximo = Math.max(...top5.map((p) => p.valorPujado), 1);
            return top5.map((p, i) => {
              const pct = (p.valorPujado / valorMaximo) * 100;
              const esLider = i === 0;
              const cercaDeLaMeta = pct >= 90;
              return (
                <div key={p.playerId} data-flip-key={p.playerId} className="flex flex-col items-center w-16 shrink-0">
                  <div className="w-16 h-64 flex flex-col items-center justify-end">
                    {esLider && (
                      <span className="text-xl mb-1" aria-hidden="true">
                        🏆
                      </span>
                    )}
                    <div
                      className={`w-16 rounded-t-lg bg-azul/70 transition-all duration-300 ease-out ${
                        esLider ? "border-2 border-oro" : ""
                      } ${cercaDeLaMeta ? "shadow-[0_0_20px_rgba(245,168,0,0.4)]" : ""}`}
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs lg:text-sm mt-2 w-16 truncate text-center" title={p.nickname}>
                    {p.nickname}
                  </span>
                  <span key={popGen[p.playerId] ?? 0} className="valor-pop font-mono tabular text-xs mt-0.5">
                    {p.valorPujado.toLocaleString("es-CO")} COP
                  </span>
                </div>
              );
            });
          })()}
        </div>

        <p className="font-mono tabular text-4xl lg:text-6xl mt-6">{Math.ceil(remainingMs / 1000)}s</p>
        <BarraTiempo remainingMs={remainingMs} duracionMs={duracionMs} className="mt-4 w-80" />
        <p className="opacity-60 mt-2">{tapsTotales} taps totales</p>
      </div>
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-escenario text-manila font-body">
      <FullscreenButton />
      {children}
    </div>
  );
}

/** Botón discreto para entrar/salir de pantalla completa (proyector). */
function FullscreenButton() {
  const [pantallaCompleta, setPantallaCompleta] = useState(
    () => typeof document !== "undefined" && !!document.fullscreenElement
  );

  useEffect(() => {
    const onChange = () => setPantallaCompleta(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const alternar = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  return (
    <button
      type="button"
      aria-label={pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
      className="fixed top-4 right-4 z-50 w-11 h-11 flex items-center justify-center rounded-full bg-manila/10 text-manila opacity-30 hover:opacity-100 transition-opacity duration-150"
      onClick={alternar}
    >
      {pantallaCompleta ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V5a1 1 0 0 0-1-1H4m0 0l5 5M9 15v4a1 1 0 0 1-1 1H4m0 0l5-5m6-10v4a1 1 0 0 0 1 1h4m0 0l-5-5m5 15h-4a1 1 0 0 1-1-1v-4m0 0l5 5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
        </svg>
      )}
    </button>
  );
}
