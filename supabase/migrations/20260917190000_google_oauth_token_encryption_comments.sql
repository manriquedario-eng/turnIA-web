-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Documentación (sólo COMMENT ON COLUMN) del nuevo formato cifrado de los
-- tokens de Google, + notas para un futuro CHECK constraint.
-- Generado: 2026-09-17
--
-- Este archivo es una PROPUESTA para revisión de Dario. No se ejecutó contra
-- ninguna base. Requiere autorización explícita antes de aplicarse.
--
-- Qué hace: ÚNICAMENTE actualiza los comentarios de
-- google_oauth_connections.access_token / .refresh_token para reflejar que,
-- a partir de esta pasada de hardening, la app cifra estas columnas en
-- reposo con AES-256-GCM (ver lib/google/token-crypto.ts) antes de
-- guardarlas — formato `enc:v1:<iv>:<tag>:<ciphertext>` (todo base64url).
--
-- Qué NO hace (a propósito, en esta pasada):
--   - No cambia el tipo de las columnas (siguen siendo `text`): el envelope
--     cifrado es texto, cabe sin cambios de schema.
--   - No agrega ningún CHECK constraint todavía. Preview y Production
--     comparten hoy este mismo proyecto de Supabase, y existe una conexión
--     legacy con tokens en texto plano que la app migra de forma perezosa
--     (lazy) al leerla por primera vez después de este deploy — un
--     constraint `access_token LIKE 'enc:v1:%'` aplicado ANTES de que esa
--     migración lazy ocurra rompería esa fila y, con ella, esa conexión de
--     Google real.
--
-- Orden seguro para un futuro constraint (NO ejecutar todavía):
--   1) Desplegar el código de esta pasada (cifra conexiones nuevas, migra
--      lazy las legacy al leerlas) a Preview y Production.
--   2) Disparar una operación server-side que lea la conexión legacy
--      existente (esto por sí solo dispara su migración a cifrado).
--   3) Verificar en Supabase, SIN recuperar los valores, que:
--        select id from public.google_oauth_connections
--        where access_token not like 'enc:v1:%' or refresh_token not like 'enc:v1:%';
--      no devuelve ninguna fila.
--   4) Recién ahí, en una migración NUEVA separada, agregar:
--        ALTER TABLE public.google_oauth_connections
--          ADD CONSTRAINT google_oauth_connections_access_token_encrypted_check
--          CHECK (access_token LIKE 'enc:v1:%'),
--          ADD CONSTRAINT google_oauth_connections_refresh_token_encrypted_check
--          CHECK (refresh_token LIKE 'enc:v1:%');
--      (NOT VALID + VALIDATE CONSTRAINT por separado si la tabla tuviera
--      muchas filas y se quisiera evitar un lock largo — hoy es una sola
--      fila, no debería hacer falta.)
-- ============================================================================

COMMENT ON COLUMN public.google_oauth_connections.access_token IS
  'Access token de corta duración, cifrado en reposo con AES-256-GCM antes de guardarse (formato enc:v1:<iv>:<tag>:<ciphertext>, todo base64url — ver lib/google/token-crypto.ts). Se descifra únicamente en memoria, server-side, vía lib/google/connection.ts. Una conexión legacy anterior a este hardening puede tener este valor en texto plano hasta que la app la lea por primera vez y la migre automáticamente a este formato — nunca asumir un formato sin chequear el prefijo enc:v1:.';

COMMENT ON COLUMN public.google_oauth_connections.refresh_token IS
  'Refresh token de larga duración — el más sensible de los dos. Cifrado en reposo con AES-256-GCM antes de guardarse (mismo formato/mecanismo que access_token, ver comentario de esa columna). Nunca loguearlo, nunca exponerlo en ninguna respuesta HTTP, ni cifrado ni descifrado.';

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario.
-- ============================================================================
