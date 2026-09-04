import { z } from "zod";

/**
 * Contrato de mensajes de "Subasta Activa".
 * Fuente única de verdad, validada en el cliente y en el servidor.
 * Ver /docs del plan técnico para el detalle de cada campo.
 */

// ---------- Primitivas ----------

export const PropertyEstadoSchema = z.enum(["disponible", "en_subasta", "adjudicado"]);
export type PropertyEstado = z.infer<typeof PropertyEstadoSchema>;

export const PropertySchema = z.object({
  id: z.string(),
  nombre: z.string(),
  ciudad: z.string(),
  tipo: z.string(),
  matriculaInmobiliaria: z.string(),
  areaM2: z.number(),
  avaluo: z.number(), // COP
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
  estado: PropertyEstadoSchema,
});
export type Property = z.infer<typeof PropertySchema>;

// Campos que el admin puede enviar al crear/editar un inmueble (sin id/estado,
// esos los controla el servidor).
export const PropertyInputSchema = z.object({
  nombre: z.string().min(1),
  ciudad: z.string().min(1),
  tipo: z.string().min(1),
  matriculaInmobiliaria: z.string().min(1),
  areaM2: z.number().positive(),
  avaluo: z.number().positive(),
  descripcion: z.string().optional(),
  imagenUrl: z.string().optional(),
});
export type PropertyInput = z.infer<typeof PropertyInputSchema>;

export const PlayerSummarySchema = z.object({
  playerId: z.string(),
  nickname: z.string(),
  taps: z.number().int().nonnegative(),
  valorPujado: z.number().nonnegative(),
  flagged: z.boolean(),
});
export type PlayerSummary = z.infer<typeof PlayerSummarySchema>;

export const PortafolioSchema = z.object({
  playerId: z.string(),
  nickname: z.string(),
  inmueblesAdjudicados: z.number().int().nonnegative(),
  valorTotal: z.number().nonnegative(),
  tapsAcumulados: z.number().int().nonnegative(),
  titulo: z.string().optional(),
});
export type Portafolio = z.infer<typeof PortafolioSchema>;

// ---------- Jugador -> Servidor ----------

export const JoinMsg = z.object({
  t: z.literal("join"),
  pin: z.string(),
  nickname: z.string().min(1).max(24),
  telefono: z.string().min(1).max(30),
  correo: z.string().email(),
  resumeToken: z.string().optional(),
});

export const TapBatchMsg = z.object({
  t: z.literal("tap_batch"),
  roundId: z.string(),
  seq: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  firstTs: z.number(),
  lastTs: z.number(),
  jitter: z.number().nonnegative(),
});

export const PingMsg = z.object({
  t: z.literal("ping"),
  t0: z.number(),
});

export const PlayerToServerMsg = z.discriminatedUnion("t", [
  JoinMsg,
  TapBatchMsg,
  PingMsg,
]);
export type PlayerToServerMsg = z.infer<typeof PlayerToServerMsg>;

// ---------- Servidor -> Jugador ----------

export const JoinedMsg = z.object({
  t: z.literal("joined"),
  playerId: z.string(),
  resumeToken: z.string(),
  estado: z.string(),
  valorPorTap: z.number(),
});

export const RoundArmedToPlayerMsg = z.object({
  t: z.literal("round_armed"),
  roundId: z.string(),
  propiedad: PropertySchema,
  startAt: z.number(),
  duracionMs: z.number(),
});

export const TickToPlayerMsg = z.object({
  t: z.literal("tick"),
  roundId: z.string(),
  remainingMs: z.number(),
  misTaps: z.number().int().nonnegative(),
  miPosicion: z.number().int().positive(),
  valorActual: z.number().nonnegative(),
  // Quién va ganando en este momento (solo informativo/visual para el jugador).
  lider: z.object({ nickname: z.string(), taps: z.number().int().nonnegative() }).nullable(),
});

export const RoundEndToPlayerMsg = z.object({
  t: z.literal("round_end"),
  roundId: z.string(),
  ganador: z.object({ playerId: z.string(), nickname: z.string(), valorFinal: z.number() }).nullable(),
  miPosicion: z.number().int().positive(),
  misTaps: z.number().int().nonnegative(),
  recortados: z.number().int().nonnegative(),
});

export const PongMsg = z.object({
  t: z.literal("pong"),
  t0: z.number(),
  t1: z.number(),
});

export const ErrorMsg = z.object({
  t: z.literal("error"),
  code: z.string(),
  mensaje: z.string(),
});

// El admin reinició a todos los jugadores: vuelve a la pantalla de registro.
export const PlayerResetMsg = z.object({ t: z.literal("reset") });

export const ServerToPlayerMsg = z.discriminatedUnion("t", [
  JoinedMsg,
  RoundArmedToPlayerMsg,
  TickToPlayerMsg,
  RoundEndToPlayerMsg,
  PongMsg,
  ErrorMsg,
  PlayerResetMsg,
]);
export type ServerToPlayerMsg = z.infer<typeof ServerToPlayerMsg>;

// ---------- Servidor -> Pantalla principal ----------

export const LobbyMsg = z.object({
  t: z.literal("lobby"),
  pin: z.string(),
  qrUrl: z.string(),
  jugadores: z.array(z.object({ playerId: z.string(), nickname: z.string() })),
});

export const RoundArmedToScreenMsg = z.object({
  t: z.literal("round_armed"),
  roundId: z.string(),
  propiedad: PropertySchema,
  startAt: z.number(),
  duracionMs: z.number(),
});

export const TickToScreenMsg = z.object({
  t: z.literal("tick"),
  roundId: z.string(),
  remainingMs: z.number(),
  top5: z.array(PlayerSummarySchema),
  tapsTotales: z.number().int().nonnegative(),
  valorActual: z.number().nonnegative(),
});

export const RoundEndToScreenMsg = z.object({
  t: z.literal("round_end"),
  roundId: z.string(),
  ganador: z.object({ playerId: z.string(), nickname: z.string(), valorFinal: z.number() }).nullable(),
  valorFinal: z.number().nonnegative(),
  top5: z.array(PlayerSummarySchema),
});

export const PodiumMsg = z.object({
  t: z.literal("podium"),
  top3: z.array(PortafolioSchema),
  portafolios: z.array(PortafolioSchema),
});

export const ServerToScreenMsg = z.discriminatedUnion("t", [
  LobbyMsg,
  RoundArmedToScreenMsg,
  TickToScreenMsg,
  RoundEndToScreenMsg,
  PodiumMsg,
]);
export type ServerToScreenMsg = z.infer<typeof ServerToScreenMsg>;

// ---------- Presentador -> Servidor ----------

export const HostArmMsg = z.object({ t: z.literal("host:arm"), propertyId: z.string() });
export const HostStartMsg = z.object({ t: z.literal("host:start") });
export const HostAbortMsg = z.object({ t: z.literal("host:abort") }); // termina la ronda en curso
export const HostRepeatMsg = z.object({ t: z.literal("host:repeat"), roundId: z.string() }); // reinicia la subasta
export const HostNextMsg = z.object({ t: z.literal("host:next") });
export const HostPodiumMsg = z.object({ t: z.literal("host:podium") });
export const HostKickMsg = z.object({ t: z.literal("host:kick"), playerId: z.string() });
// token = access_token de Supabase Auth (JWT de la sesión del admin), no un secreto fijo.
export const HostJoinMsg = z.object({ t: z.literal("host:join"), token: z.string() });

export const HostCreatePropertyMsg = z.object({ t: z.literal("host:create_property"), data: PropertyInputSchema });
export const HostUpdatePropertyMsg = z.object({
  t: z.literal("host:update_property"),
  propertyId: z.string(),
  data: PropertyInputSchema,
});
export const HostDeletePropertyMsg = z.object({ t: z.literal("host:delete_property"), propertyId: z.string() });
// Vuelve a poner en subasta un inmueble ya adjudicado (estado -> disponible).
export const HostRelistPropertyMsg = z.object({ t: z.literal("host:relist_property"), propertyId: z.string() });

// Crea un nuevo usuario admin directamente en Supabase Auth (email + contraseña).
export const HostCreateAdminMsg = z.object({
  t: z.literal("host:create_admin"),
  email: z.string().email(),
  password: z.string().min(6),
});

// Borra a todos los jugadores registrados y los manda de vuelta a la pantalla de registro.
export const HostResetPlayersMsg = z.object({ t: z.literal("host:reset_players") });

// Cierra una ronda ya terminada (estado "ended") sin tocar el estado del inmueble, a diferencia de host:abort.
export const HostCloseRoundMsg = z.object({ t: z.literal("host:close_round") });

export const HostToServerMsg = z.discriminatedUnion("t", [
  HostArmMsg,
  HostStartMsg,
  HostAbortMsg,
  HostRepeatMsg,
  HostNextMsg,
  HostPodiumMsg,
  HostKickMsg,
  HostJoinMsg,
  HostCreatePropertyMsg,
  HostUpdatePropertyMsg,
  HostDeletePropertyMsg,
  HostRelistPropertyMsg,
  HostCreateAdminMsg,
  HostResetPlayersMsg,
  HostCloseRoundMsg,
]);
export type HostToServerMsg = z.infer<typeof HostToServerMsg>;

// ---------- Servidor -> Presentador ----------

export const HostStateMsg = z.object({
  t: z.literal("host:state"),
  estado: z.string(),
  pin: z.string(),
  properties: z.array(PropertySchema),
  jugadores: z.array(
    z.object({
      playerId: z.string(),
      nickname: z.string(),
      telefono: z.string().optional(),
      correo: z.string().optional(),
      conectado: z.boolean().optional(),
      flagged: z.boolean(),
    })
  ),
  rondaActual: z
    .object({ roundId: z.string(), propiedad: PropertySchema, estado: z.string() })
    .nullable(),
});
export type HostStateMsg = z.infer<typeof HostStateMsg>;

export const AdminCreatedMsg = z.object({ t: z.literal("host:admin_created"), email: z.string() });

// Ranking en vivo de la ronda en curso, para que el admin vea cómo van las pujas.
export const HostTickMsg = z.object({
  t: z.literal("host:tick"),
  roundId: z.string(),
  remainingMs: z.number(),
  top: z.array(PlayerSummarySchema),
  tapsTotales: z.number().int().nonnegative(),
  valorActual: z.number().nonnegative(),
});

export const ServerToHostMsg = z.discriminatedUnion("t", [HostStateMsg, AdminCreatedMsg, HostTickMsg, ErrorMsg]);
export type ServerToHostMsg = z.infer<typeof ServerToHostMsg>;

// ---------- Constantes de juego ----------

export const GAME_CONSTANTS = {
  ROUND_DURATION_MS: 20_000,
  ARM_LEAD_MS: 3_000,
  GRACE_MS: 600, // ventana extra tras el cierre, ver anti-trampa
  TAP_BATCH_INTERVAL_MS: 150,
  TICK_HZ_PLAYER: 10,
  TICK_HZ_SCREEN: 10,
  TOKEN_BUCKET_CAPACITY: 30,
  TOKEN_BUCKET_REFILL_PER_SEC: 15,
  JITTER_MIN_MS: 8,
  JITTER_FLAG_STREAK: 3,
  RATE_LIMIT_MSGS_PER_SEC: 20,
  RATE_LIMIT_STRIKES: 3,
  DEFAULT_VALOR_POR_TAP: 1_000_000,
} as const;
