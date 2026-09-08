import { useEffect, useMemo, useState } from "react";
import { usePrefersReducedMotion } from "../lib/useReducedMotion.js";

type Props = { activo: boolean; cantidad?: number };

const COLOR_CLASES = ["bg-oro", "bg-azul", "bg-esmeralda"];

/**
 * Confeti simple con divs + CSS (sin librerías externas) para celebrar al
 * ganador de una ronda. Mientras "activo" siga en true relanza una tanda
 * nueva cada pocos segundos (en vez de una sola rafaga que se apaga y deja
 * la pantalla estatica), para que la celebracion se sienta sostenida todo
 * el tiempo que dure esa pantalla. No se renderiza si el usuario tiene
 * activado "reducir movimiento": el resultado se ve igual, solo sin la
 * animación.
 */
export default function Confetti({ activo, cantidad = 28 }: Props) {
  const reducido = usePrefersReducedMotion();
  const [tanda, setTanda] = useState(0);

  useEffect(() => {
    if (!activo) return;
    const id = window.setInterval(() => setTanda((t) => t + 1), 3200);
    return () => window.clearInterval(id);
  }, [activo]);

  const piezas = useMemo(
    () =>
      Array.from({ length: cantidad }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 400,
        duracion: 1500 + Math.random() * 1000,
        rot: 180 + Math.random() * 360,
        color: COLOR_CLASES[i % COLOR_CLASES.length],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cantidad, tanda]
  );

  if (!activo || reducido) return null;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {piezas.map((p) => (
        <span
          key={`${tanda}-${p.id}`}
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
  );
}
