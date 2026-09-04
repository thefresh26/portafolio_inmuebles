import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Cliente de Supabase para el navegador. Usa la llave pública (anon/publishable),
 * segura de exponer en el cliente: Row Level Security en la base de datos es lo
 * que realmente protege los datos, no el secreto de esta llave.
 *
 * Si no se configuraron las variables de entorno (por ejemplo en desarrollo
 * local sin Supabase), queda en null y la consola del presentador cae de
 * vuelta al login por token fijo, igual que en la Fase 1.
 */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;
