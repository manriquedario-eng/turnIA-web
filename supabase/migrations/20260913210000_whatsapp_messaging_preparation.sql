-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Fase 5E.1 — preparación de datos para WhatsApp automático
-- Proyecto: turnia-staging (nnbpefxvpmegngqopcvw)
-- Generado: 2026-09-13
--
-- Este archivo es una PROPUESTA para revisión de Dario. No se ejecutó contra
-- turnia-staging ni ninguna otra base. Requiere autorización explícita antes
-- de aplicarse (Supabase CLI / dashboard, fuera de este entorno).
--
-- Qué agrega:
--   1) Columnas nuevas en public.patients (consentimiento + teléfono E.164).
--   2) Tabla nueva public.appointment_messages (historial/cola de mensajería).
--
-- Qué NO hace:
--   - No modifica ni elimina columnas existentes.
--   - No borra ni migra datos.
--   - No cambia políticas RLS de tablas existentes.
--   - No crea triggers, funciones de envío, cron jobs ni webhooks.
--   - No envía ningún mensaje.
--
-- Todas las columnas nuevas son NULLABLE o tienen DEFAULT seguro, por lo que
-- es aditiva y no debería romper filas existentes. IF NOT EXISTS / OR REPLACE
-- en todo lo creable para que sea re-ejecutable sin error.
-- ============================================================================

-- 1) Patients: consentimiento y teléfono normalizado ------------------------

ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS phone_e164 text,
  ADD COLUMN IF NOT EXISTS whatsapp_consent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS appointment_reminders_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.patients.phone_e164 IS
  'Teléfono normalizado a formato internacional E.164 (+<código país><número>), calculado desde patients.phone. NULL cuando la normalización es ambigua (no se asume país por defecto). patients.phone (el original) nunca se sobrescribe ni se borra.';

COMMENT ON COLUMN public.patients.whatsapp_consent IS
  'Consentimiento explícito del paciente para recibir mensajes por WhatsApp. Default false: nunca se asume ni se infiere consentimiento.';

COMMENT ON COLUMN public.patients.whatsapp_consent_at IS
  'Fecha/hora del último guardado con whatsapp_consent = true. NULL si nunca se otorgó o si fue revocado.';

COMMENT ON COLUMN public.patients.appointment_reminders_opt_in IS
  'Preferencia del paciente para recibir recordatorios automáticos de turnos. En fases futuras, enviar por WhatsApp requiere ADEMÁS whatsapp_consent = true.';

-- No se requieren cambios de RLS en patients: las políticas existentes
-- aplican a la fila completa, así que cubren las columnas nuevas sin tocarlas.

-- 2) Historial / cola de mensajería relacionada a turnos ---------------------

CREATE TABLE IF NOT EXISTS public.appointment_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  message_type text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'pending',
  scheduled_at timestamptz,
  sent_at timestamptz,
  patient_response text,
  responded_at timestamptz,
  provider_message_id text,
  error_message text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_messages_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text, 'scheduled'::text, 'sent'::text,
      'delivered'::text, 'read'::text, 'failed'::text, 'cancelled'::text
    ])
  )
);

COMMENT ON TABLE public.appointment_messages IS
  'Historial y cola de mensajes salientes relacionados a turnos (WhatsApp u otro canal futuro). Preparada en 5E.1; nada la escribe todavía. 5E.2+ deberá insertar/actualizar filas acá al implementar el envío real.';

COMMENT ON COLUMN public.appointment_messages.message_type IS
  'Texto libre, sin CHECK a propósito, para no limitar tipos futuros (ej. appointment_created, appointment_reminder_24h, appointment_response). Validar en la capa de aplicación (Zod), no en el schema.';

COMMENT ON COLUMN public.appointment_messages.channel IS
  'Canal de envío. Hoy sólo se usará "whatsapp" pero se deja como texto libre en vez de CHECK/enum para no acoplar el schema a un único proveedor.';

COMMENT ON COLUMN public.appointment_messages.patient_response IS
  'Respuesta cruda reportada por el paciente/proveedor (texto o acción). Sin CHECK: interpretarla como confirmar/cancelar/reprogramar es responsabilidad de 5E.2+ y NO debe, por sí sola, cambiar el estado de un turno vía este schema.';

COMMENT ON COLUMN public.appointment_messages.payload IS
  'Metadata flexible (ej. plantilla usada, variables interpoladas, respuesta cruda del proveedor) para absorber necesidades futuras sin otra migración.';

CREATE INDEX IF NOT EXISTS appointment_messages_tenant_status_scheduled_idx
  ON public.appointment_messages (tenant_id, status, scheduled_at);

CREATE INDEX IF NOT EXISTS appointment_messages_patient_idx
  ON public.appointment_messages (patient_id);

CREATE INDEX IF NOT EXISTS appointment_messages_appointment_idx
  ON public.appointment_messages (appointment_id);

ALTER TABLE public.appointment_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_messages_member_all ON public.appointment_messages;
CREATE POLICY appointment_messages_member_all
  ON public.appointment_messages
  FOR ALL
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

GRANT ALL ON TABLE public.appointment_messages TO authenticated;

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario, y no antes de que el código de la app que depende de estas columnas
-- (patients/actions.ts, formularios de paciente) esté desplegado o listo
-- para desplegarse junto con esta migración — ver riesgo en el informe.
-- ============================================================================
