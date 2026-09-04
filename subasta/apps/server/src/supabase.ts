import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

/**
 * Cliente con la service_role key: vive únicamente en el servidor, nunca se
 * expone al navegador. Bypassa RLS a propósito porque el servidor de juego
 * ya es la autoridad de todo lo que escribe en la base de datos.
 */
export const supabaseAdmin = supabaseEnabled
  ? createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

if (!supabaseEnabled) {
  console.warn(
    "[supabase] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no configurados: " +
      "corriendo en modo desarrollo sin base de datos (inmuebles hardcodeados, " +
      "login de admin con HOST_TOKEN, sin registro de logins de jugadores)."
  );
}

/**
 * Verifica el token que envía la consola del presentador.
 * - Con Supabase configurado: el token es el access_token (JWT) de una sesión
 *   real de Supabase Auth (email + contraseña) y se valida contra ella.
 * - Sin Supabase (desarrollo local): se acepta el token fijo de HOST_TOKEN,
 *   igual que en la Fase 1, para no romper el flujo de pruebas rápidas.
 */
export async function verifyAdminToken(token: string): Promise<{ ok: boolean; email?: string }> {
  if (!supabaseAdmin) {
    const devToken = process.env.HOST_TOKEN ?? "dev-host-token";
    return { ok: token === devToken };
  }
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return { ok: false };
  return { ok: true, email: data.user.email ?? undefined };
}

/**
 * Crea un nuevo usuario admin directamente en Supabase Auth (con la
 * service_role key, que tiene permiso para esto). Queda auto-confirmado
 * (email_confirm: true) para que pueda iniciar sesión de inmediato en
 * /host sin tener que confirmar por correo.
 */
export async function createAdminUser(
  email: string,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  if (!supabaseAdmin) {
    return { ok: false, error: "Base de datos no configurada (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)" };
  }
  const { error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
