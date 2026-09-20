// Cliente de Supabase con SERVICE ROLE — bypassea RLS por completo.
//
// USO EXCLUSIVO server-side (Server Actions, Route Handlers). NUNCA importar
// este archivo desde un Client Component ni desde cualquier código que
// pueda terminar en el bundle del browser: SUPABASE_SERVICE_ROLE_KEY es
// equivalente a una llave maestra sobre toda la base.
//
// Por qué existe: `lib/supabase/server.ts` usa la publishable key + la
// sesión del usuario (respeta RLS), que es correcto para todo lo que ya
// hace la app. Pero `google_oauth_connections` está diseñada para NO ser
// accesible ni siquiera al usuario dueño de la fila a través de RLS (ver
// comentarios en la migración 20260914213000_google_meet_and_email_messaging.sql):
// sólo este cliente puede leerla/escribirla, y sólo se usa en
// lib/google/oauth.ts y lib/google/calendar.ts.
//
// Variable de entorno requerida (server-side únicamente, nunca
// NEXT_PUBLIC_): SUPABASE_SERVICE_ROLE_KEY. Mientras no esté configurada,
// toda la integración de Google queda en modo seguro (ver
// isServiceRoleConfigured / isGoogleOAuthConfigured): no se intenta ninguna
// operación, y las funciones que dependen de esto devuelven un resultado
// claro de "no configurado" en vez de lanzar.

import { createClient } from '@supabase/supabase-js';

export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Lanza si falta configuración: los llamadores (lib/google/*) deben chequear
 * `isServiceRoleConfigured()` antes de invocar esto y devolver su propio
 * resultado "no configurado" en vez de dejar que esto explote hacia el
 * flujo de creación de turnos.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing Supabase service role environment variables');
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
