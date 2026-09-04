type Props = { remainingMs: number; duracionMs: number; className?: string };

/**
 * Barra de progreso del tiempo restante de la ronda. El color pasa de
 * esmeralda a oro a sello según cuánto queda; el ancho se anima con
 * transition-all a partir del estado que llega en cada "tick" del
 * servidor (10/s), sin recalcular nada por frame en el cliente.
 */
export default function BarraTiempo({ remainingMs, duracionMs, className = "" }: Props) {
  const pct = duracionMs > 0 ? Math.max(0, Math.min(100, (remainingMs / duracionMs) * 100)) : 0;
  const segundos = remainingMs / 1000;
  const colorClase = segundos <= 5 ? "bg-sello" : segundos <= 10 ? "bg-oro" : "bg-esmeralda";

  return (
    <div className={`h-2 rounded-full bg-manila/15 overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-150 ease-linear ${colorClase}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
