import type { WebSocket } from "ws";
import type { Property } from "@subasta/shared";

export type Estado = "lobby" | "armed" | "running" | "ended";

export interface PlayerConn {
  playerId: string;
  nickname: string;
  telefono: string;
  correo: string;
  resumeToken: string;
  socket: WebSocket | null; // null mientras está desconectado
  lastSeq: number; // último seq de tap_batch aceptado, por ronda (ver roundSeqSeen)
}

export interface RoundState {
  roundId: string;
  propiedad: Property;
  startAt: number; // epoch ms, reloj del servidor
  duracionMs: number;
  estado: "armed" | "running" | "ended";
  counts: Map<string, number>; // playerId -> taps válidos
  seqSeen: Map<string, Set<number>>; // playerId -> seqs ya aceptados (dedup)
  recortados: Map<string, number>; // playerId -> taps descartados
  firstReachedAt: Map<string, number>; // playerId -> ts en que alcanzó su conteo actual (para desempate)
  ganador: { playerId: string; nickname: string; valorFinal: number } | null;
  abortada?: boolean;
}

/** Fila resumida y ya persistida (Supabase, tabla rounds_log) para el panel de historial del host. */
export interface HistorialEntry {
  roundId: string;
  propiedad: { nombre: string; matriculaInmobiliaria: string; ciudad?: string };
  ganador: { playerId: string; nickname: string; valorFinal: number } | null;
  abortada: boolean;
  finalizadaEn: number;
}

export interface RoomState {
  pin: string;
  valorPorTap: number;
  estado: Estado;
  players: Map<string, PlayerConn>;
  properties: Property[];
  currentRound: RoundState | null;
  roundHistory: RoundState[];
  /** Historial persistido (Supabase) para mostrar en el host; sobrevive reinicios del servidor. */
  historial: HistorialEntry[];
  screens: Set<WebSocket>;
  hosts: Set<WebSocket>;
}
