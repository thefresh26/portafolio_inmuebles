import type { Property, PropertyEstado, PropertyInput } from "@subasta/shared";
import type { HistorialEntry } from "./types.js";
import { supabaseAdmin } from "./supabase.js";
import { PROPERTIES as SEED_PROPERTIES } from "./properties.js";

// Fila cruda de la tabla `properties` en Supabase (snake_case).
interface PropertyRow {
  id: string;
  nombre: string;
  ciudad: string;
  tipo: string;
  matricula_inmobiliaria: string;
  area_m2: number | string;
  avaluo: number | string;
  descripcion: string | null;
  imagen_url: string | null;
  estado: PropertyEstado;
}

function rowToProperty(row: PropertyRow): Property {
  return {
    id: row.id,
    nombre: row.nombre,
    ciudad: row.ciudad,
    tipo: row.tipo,
    matriculaInmobiliaria: row.matricula_inmobiliaria,
    areaM2: Number(row.area_m2),
    avaluo: Number(row.avaluo),
    descripcion: row.descripcion ?? undefined,
    imagenUrl: row.imagen_url ?? undefined,
    estado: row.estado,
  };
}

function inputToRow(input: PropertyInput) {
  return {
    nombre: input.nombre,
    ciudad: input.ciudad,
    tipo: input.tipo,
    matricula_inmobiliaria: input.matriculaInmobiliaria,
    area_m2: input.areaM2,
    avaluo: input.avaluo,
    descripcion: input.descripcion ?? null,
    imagen_url: input.imagenUrl ?? null,
  };
}

export async function loadProperties(): Promise<Property[]> {
  if (!supabaseAdmin) return SEED_PROPERTIES;
  const { data, error } = await supabaseAdmin
    .from("properties")
    .select("*")
    .eq("archivado", false)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[supabase] error cargando properties:", error.message);
    return SEED_PROPERTIES;
  }
  return (data as PropertyRow[]).map(rowToProperty);
}

export async function createProperty(input: PropertyInput): Promise<Property> {
  if (!supabaseAdmin) throw new Error("Base de datos no configurada (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)");
  const { data, error } = await supabaseAdmin
    .from("properties")
    .insert(inputToRow(input))
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToProperty(data as PropertyRow);
}

export async function updateProperty(id: string, input: PropertyInput): Promise<Property> {
  if (!supabaseAdmin) throw new Error("Base de datos no configurada (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)");
  const { data, error } = await supabaseAdmin
    .from("properties")
    .update({ ...inputToRow(input), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToProperty(data as PropertyRow);
}

export async function archiveProperty(id: string): Promise<void> {
  if (!supabaseAdmin) throw new Error("Base de datos no configurada (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)");
  const { error } = await supabaseAdmin
    .from("properties")
    .update({ archivado: true, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setPropertyEstado(id: string, estado: PropertyEstado): Promise<Property | null> {
  if (!supabaseAdmin) return null; // modo sin DB: el estado solo vive en memoria
  const { data, error } = await supabaseAdmin
    .from("properties")
    .update({ estado, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("[supabase] error actualizando estado de property:", error.message);
    return null;
  }
  return rowToProperty(data as PropertyRow);
}

export async function logPlayerLogin(params: {
  eventPin: string;
  nickname: string;
  playerId: string;
  telefono: string;
  correo: string;
}): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from("player_logins").insert({
    event_pin: params.eventPin,
    nickname: params.nickname,
    player_id: params.playerId,
    telefono: params.telefono,
    correo: params.correo,
  });
  if (error) console.error("[supabase] error registrando login de jugador:", error.message);
}

export async function deletePlayerLogins(eventPin: string): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from("player_logins").delete().eq("event_pin", eventPin);
  if (error) console.error("[supabase] error borrando player_logins:", error);
}

export async function logRoundResult(params: {
  propertyId: string;
  propertyNombre: string;
  propertyFmi: string;
  propertyCiudad?: string;
  winnerNickname: string | null;
  winnerTaps: number;
  valorFinal: number;
  startedAt: number;
  endedAt: number;
  abortada: boolean;
}): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin.from("rounds_log").insert({
    property_id: params.propertyId,
    property_nombre: params.propertyNombre,
    property_fmi: params.propertyFmi,
    property_ciudad: params.propertyCiudad ?? null,
    winner_nickname: params.winnerNickname,
    winner_taps: params.winnerTaps,
    valor_final: params.valorFinal,
    started_at: new Date(params.startedAt).toISOString(),
    ended_at: new Date(params.endedAt).toISOString(),
    abortada: params.abortada,
  });
  if (error) console.error("[supabase] error registrando rounds_log:", error.message);
}

// Fila cruda de la tabla `rounds_log` en Supabase (snake_case).
interface RoundsLogRow {
  id: number | string;
  property_nombre: string | null;
  property_fmi: string | null;
  property_ciudad: string | null;
  winner_nickname: string | null;
  valor_final: number | string | null;
  abortada: boolean | null;
  ended_at: string | null;
  started_at: string | null;
}

/** Trae el historial ya persistido en Supabase (mas reciente primero), para sobrevivir reinicios del servidor. */
export async function fetchHistorial(limit = 30): Promise<HistorialEntry[]> {
  if (!supabaseAdmin) return [];
  const { data, error } = await supabaseAdmin
    .from("rounds_log")
    .select("id, property_nombre, property_fmi, property_ciudad, winner_nickname, valor_final, abortada, ended_at, started_at")
    .order("ended_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[supabase] error cargando rounds_log:", error.message);
    return [];
  }
  return (data as RoundsLogRow[]).map((row) => ({
    roundId: `db-${row.id}`,
    propiedad: {
      nombre: row.property_nombre ?? "Inmueble",
      matriculaInmobiliaria: row.property_fmi ?? "-",
      ciudad: row.property_ciudad ?? undefined,
    },
    ganador: row.winner_nickname
      ? { playerId: "", nickname: row.winner_nickname, valorFinal: Number(row.valor_final ?? 0) }
      : null,
    abortada: row.abortada === true,
    finalizadaEn: new Date(row.ended_at ?? row.started_at ?? Date.now()).getTime(),
  }));
}
