import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useSocket } from "../lib/useSocket.js";
import { wsUrl } from "../lib/wsUrl.js";
import BrandMark from "../components/BrandMark.js";

const WS_URL = wsUrl("/ws/screen");

// Pantalla proyector: SOLO muestra el código QR de entrada y cuántos
// jugadores se han registrado. Todo lo demás de la ronda (puja actual,
// ranking en vivo, ganador) vive ahora en la consola del presentador
// (Host), que es la pantalla principal para seguir la subasta.
export default function Screen() {
  const [jugadores, setJugadores] = useState<{ playerId: string; nickname: string }[]>([]);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.t === "lobby") {
      setJugadores(msg.jugadores as { playerId: string; nickname: string }[]);
      setQrUrl(msg.qrUrl as string);
    }
  }, []);

  useSocket(WS_URL, onMessage);

  const joinUrl = qrUrl ? `${window.location.origin}${qrUrl}` : null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-escenario text-manila font-body">
      <FullscreenButton />
      <BrandMark className="w-16 h-16 mb-6" />
      {joinUrl ? (
        <div className="bg-manila p-6 rounded-xl mb-6">
          <QRCodeSVG value={joinUrl} size={340} />
        </div>
      ) : null}
      <p className="opacity-70 mb-8">Escanea el código QR para participar</p>
      <p className="opacity-50">{jugadores.length} jugador(es) conectado(s)</p>
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
