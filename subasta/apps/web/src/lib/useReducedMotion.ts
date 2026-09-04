import { useEffect, useState } from "react";

/** true si el usuario activó "reducir movimiento" en su sistema operativo. */
export function usePrefersReducedMotion(): boolean {
  const [reducido, setReducido] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducido(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reducido;
}
