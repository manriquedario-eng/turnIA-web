-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Fase 5F — Google Meet automático + confirmación por email (multi-tenant)
-- Proyecto: turnia-staging (nnbpefxvpmegngqopcvw)
-- Generado: 2026-09-14
--
-- Este archivo es una PROPUESTA para revisión de Dario. No se ejecutó contra
-- turnia-staging ni ninguna otra base. Requiere autorización explícita antes
-- de aplicarse (Supabase CLI / dashboard, fuera de este entorno).
--
-- Precondición: asume que la migración anterior
-- (20260913210000_whatsapp_messaging_preparation.sql) ya está aplicada, ya
-- que el código actual de la app (agenda/actions.ts, patients/actions.ts)
-- depende de patients.phone_e164 / whatsapp_consent y de
-- appointment_messages. Si todavía no se aplicó, aplicar esa primero.
--
-- Qué agrega:
--   1) appointments: constraint de modalidad (mantiene los 3 valores en uso
--      real: presencial/domicilio/online — no se elimina "domicilio" para
--      no romper turnos existentes) + columnas de videollamada.
--   2) google_oauth_connections: tokens OAuth de Google por profesional,
--      NUNCA accesibles desde el cliente (sin políticas RLS para
--      'authenticated'/'anon' — sólo service_role, server-side).
--   3) integration_status: estado de integraciones visible en Settings
--      (sin secretos), uno por tenant+profesional+proveedor.
--
-- Qué NO hace:
--   - No modifica ni elimina columnas existentes.
--   - No borra ni migra datos.
--   - No cambia políticas RLS de tablas existentes.
--   - No crea triggers, cron jobs ni lógica de envío.
--   - No guarda ningún token real (eso lo hace la app en runtime).
--
-- Seguridad de los tokens (ver lib/google/oauth.ts y lib/supabase/service.ts
-- para el detalle del flujo):
--   - google_oauth_connections tiene RLS habilitado y, a propósito, CERO
--     políticas para 'authenticated'/'anon': ninguna fila es visible ni
--     escribible a través del cliente normal de la app (que usa la
--     publishable key + sesión del usuario). Sólo el service_role (usado
--     exclusivamente en server actions / route handlers, nunca en el
--     browser) puede leer/escribir esta tabla, porque service_role
--     bypassea RLS.
--   - Además se revocan explícitamente los privilegios por defecto sobre la
--     tabla para 'authenticated' y 'anon', como capa extra por si el
--     proyecto tuviera privilegios por defecto más permisivos.
--   - Pendiente (documentado, no implementado acá): cifrado adicional en
--     reposo de access_token/refresh_token (por ejemplo con pgsodium o
--     Supabase Vault). Mientras tanto, la única barrera es RLS + que el
--     service role key nunca se expone al cliente. Ver informe final.
--
-- Todas las columnas nuevas son NULLABLE o tienen DEFAULT seguro, por lo que
-- es aditiva y no debería romper filas existentes. IF NOT EXISTS / OR
-- REPLACE en todo lo creable para que sea re-ejecutable sin error.
-- ============================================================================

-- 1) Appointments: modalidad tipada + datos de videollamada -----------------

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS meeting_provider text,
  ADD COLUMN IF NOT EXISTS meeting_url text,
  ADD COLUMN IF NOT EXISTS external_calendar_event_id text;

COMMENT ON COLUMN public.appointments.meeting_provider IS
  'Proveedor de videollamada del turno online. Hoy sólo "google_meet". NULL para turnos presenciales/domicilio o cuando la creación del Meet falló.';

COMMENT ON COLUMN public.appointments.meeting_url IS
  'URL de Google Meet generada vía Google Calendar API para este turno. NULL si el turno no es online, o si el profesional no tiene Google conectado, o si la creación falló (el turno se crea igual).';

COMMENT ON COLUMN public.appointments.external_calendar_event_id IS
  'ID del evento en Google Calendar del profesional, para poder actualizarlo/cancelarlo en fases futuras cuando cambie o se cancele el turno. NULL si no se creó evento.';

-- Constraint de modality: aditivo, mantiene los 3 valores que la app ya usa
-- en producción (no se restringe a sólo presencial/online para no romper
-- turnos existentes con modality = 'domicilio'). Sólo modality = 'online'
-- dispara la creación de Google Meet en la capa de aplicación.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_modality_check'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_modality_check
      CHECK (modality = ANY (ARRAY['presencial'::text, 'domicilio'::text, 'online'::text]));
  END IF;
END $$;

-- Constraint de meeting_provider: hoy sólo 'google_meet', o NULL (turno sin
-- videollamada generada). Se deja como constraint separado y laxo (no NOT
-- NULL) para no acoplar meeting_provider a modality a nivel de schema; esa
-- regla ("sólo se genera Meet si modality = 'online'") vive en la capa de
-- aplicación (lib/google/calendar.ts), igual que la app ya hace con
-- WhatsApp.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_meeting_provider_check'
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_meeting_provider_check
      CHECK (meeting_provider IS NULL OR meeting_provider = 'google_meet'::text);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS appointments_external_calendar_event_id_idx
  ON public.appointments (external_calendar_event_id)
  WHERE external_calendar_event_id IS NOT NULL;

-- 2) google_oauth_connections: tokens OAuth de Google, uno por profesional --
--
-- Clave (tenant_id, user_id): cada profesional dentro de un tenant conecta
-- su propia cuenta de Google (no hay una cuenta compartida por tenant).
-- user_id referencia a auth.users, igual que tenant_members.user_id.

CREATE TABLE IF NOT EXISTS public.google_oauth_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_account_email text,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT google_oauth_connections_tenant_user_unique UNIQUE (tenant_id, user_id)
);

COMMENT ON TABLE public.google_oauth_connections IS
  'Tokens OAuth 2.0 de Google por profesional (tenant_id + user_id), usados para crear eventos de Google Calendar con Google Meet. Acceso EXCLUSIVAMENTE server-side vía service_role — ver notas de seguridad al inicio de este archivo. Nunca leer/escribir esta tabla desde código que corra en el browser ni con la publishable key.';

COMMENT ON COLUMN public.google_oauth_connections.access_token IS
  'Access token de corta duración (se refresca con refresh_token cuando expira). Pendiente: cifrado adicional en reposo (ver notas de seguridad al inicio del archivo).';

COMMENT ON COLUMN public.google_oauth_connections.refresh_token IS
  'Refresh token de larga duración — el más sensible de los dos. Tratar como secreto: nunca loguearlo, nunca exponerlo en ninguna respuesta HTTP. Pendiente: cifrado adicional en reposo.';

ALTER TABLE public.google_oauth_connections ENABLE ROW LEVEL SECURITY;

-- A propósito: NINGUNA política para 'authenticated' ni 'anon'. Sin
-- políticas, RLS deniega todo acceso a esos roles; sólo service_role (que
-- bypassea RLS) puede operar sobre esta tabla, y ese rol sólo se usa en
-- código server-side (ver lib/supabase/service.ts).
REVOKE ALL ON TABLE public.google_oauth_connections FROM authenticated, anon;

CREATE INDEX IF NOT EXISTS google_oauth_connections_tenant_idx
  ON public.google_oauth_connections (tenant_id);

-- 3) integration_status: estado de integraciones, visible en Settings ------
--
-- Nunca contiene secretos — sólo lo necesario para mostrar "Conectado /
-- No conectado" y un email de referencia en la UI. La escribe el server
-- (rutas de OAuth, con service role) al conectar/desconectar; los miembros
-- del tenant sólo la leen.

CREATE TABLE IF NOT EXISTS public.integration_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'not_connected',
  account_label text,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_status_provider_check CHECK (provider = ANY (ARRAY['google_calendar'::text])),
  CONSTRAINT integration_status_status_check CHECK (status = ANY (ARRAY['connected'::text, 'not_connected'::text, 'error'::text])),
  CONSTRAINT integration_status_tenant_user_provider_unique UNIQUE (tenant_id, user_id, provider)
);

COMMENT ON TABLE public.integration_status IS
  'Estado visible (sin secretos) de integraciones externas por profesional, para la sección Integraciones de Settings. provider hoy sólo admite google_calendar; WhatsApp y Email se muestran en Settings a partir de variables de entorno del tenant/plataforma, no de esta tabla, porque todavía no son por-profesional.';

ALTER TABLE public.integration_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS integration_status_member_select ON public.integration_status;
CREATE POLICY integration_status_member_select
  ON public.integration_status
  FOR SELECT
  USING (public.is_tenant_member(tenant_id));

-- Sin política de INSERT/UPDATE/DELETE para 'authenticated': esta tabla la
-- escribe únicamente el server (service_role) al completar o revocar el
-- flujo OAuth, nunca el cliente directamente.
GRANT SELECT ON TABLE public.integration_status TO authenticated;

CREATE INDEX IF NOT EXISTS integration_status_tenant_idx
  ON public.integration_status (tenant_id);

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario. Ver informe de la tarea para el detalle de qué falta configurar
-- (Google Cloud Console, SUPABASE_SERVICE_ROLE_KEY, proveedor de email)
-- antes de que esto funcione end-to-end.
-- ============================================================================
