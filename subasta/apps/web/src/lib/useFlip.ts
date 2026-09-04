import { useLayoutEffect, useRef } from "react";

/**
 * Anima el reacomodo de una lista (técnica FLIP) cuando el orden de sus
 * filas cambia, en vez de que salten de golpe a la nueva posición.
 * Cada fila debe tener `data-flip-key` con un id estable (ej. playerId).
 */
export function useFlip(order: string[]) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevRectsRef = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const prevRects = prevRectsRef.current;
    const nextRects = new Map<string, DOMRect>();

    container.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((row) => {
      const key = row.dataset.flipKey;
      if (!key) return;
      const rect = row.getBoundingClientRect();
      nextRects.set(key, rect);

      const prevRect = prevRects.get(key);
      if (!prevRect) return;
      const dy = prevRect.top - rect.top;
      if (Math.abs(dy) < 1) return;

      row.style.transition = "none";
      row.style.transform = `translateY(${dy}px)`;
      row.getBoundingClientRect(); // fuerza reflow antes de animar a la posición final
      requestAnimationFrame(() => {
        row.style.transition = "transform 320ms ease-out";
        row.style.transform = "";
      });
    });

    prevRectsRef.current = nextRects;
  }, [order.join("|")]);

  return containerRef;
}
