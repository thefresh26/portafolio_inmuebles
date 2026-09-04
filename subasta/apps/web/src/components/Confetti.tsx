import { useMemo } from "react";
import { usePrefersReducedMotion } from "../lib/useReducedMotion.js";

type Props = { activo: boolean; cantidad?: number };

const COLOR_CLASES = ["bg-oro", "bg-azul", "bg-esmeralda"];

/**
 * Confeti simple con divs + CSS (sin librerías externas) para celebrar al
 * ganador de una ronda. No se renderiza si el usuario tiene activado
 * "reducir movimiento": el resultado se ve igual, solo sin la animación.
 */
export default function Confetti({ activo, cantidad = 28 }: Props) {
  const reducido = usePrefersReducedMotion();

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
    [cantidad]
  );

  if (!activo || reducido) return null;

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {piezas.map((p) => (
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
  );
}
