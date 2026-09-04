import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Hook mínimo de WebSocket con reconexión simple.
 * La lógica de resumeToken / backoff exponencial completa es Fase 2;
 * aquí se reconecta con un retardo fijo para no perder la sesión de la pestaña.
 */
export function useSocket(url: string, onMessage: (data: unknown) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let closedByUs = false;
    let socket: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!closedByUs) retryTimer = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (ev) => {
        try {
          onMessageRef.current(JSON.parse(ev.data));
        } catch {
          // mensaje no-JSON, se ignora
        }
      };
    }
    connect();

    return () => {
      closedByUs = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [url]);

  const send = useCallback((payload: unknown) => {
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }, []);

  return { send, connected };
}
