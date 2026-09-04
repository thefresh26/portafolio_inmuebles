/**
 * Resuelve la URL del WebSocket del servidor de juego.
 *
 * En desarrollo local, cliente y servidor corren en la misma máquina, así
 * que basta con apuntar al puerto 8787 del mismo host.
 *
 * En producción (Render u otra plataforma), la web (sitio estático) y el
 * servidor quedan en dominios distintos, así que la URL completa del
 * servidor se inyecta en tiempo de build vía la variable de entorno
 * VITE_WS_URL (ej: wss://subasta-server.onrender.com).
 */
export function wsUrl(path: string): string {
  const base = import.meta.env.VITE_WS_URL as string | undefined;
  if (base) return `${base}${path}`;
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:8787${path}`;
}
