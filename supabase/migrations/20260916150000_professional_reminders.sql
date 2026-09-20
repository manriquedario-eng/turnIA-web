-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Recordatorios personales del profesional (PARTE 6-9-15 del pedido de
-- corrección funcional/UX final de TurnIA Salud)
-- Proyecto: turnia-staging (nnbpefxvpmegngqopcvw)
-- Generado: 2026-09-16
--
-- Este archivo es una PROPUESTA para revisión de Dario. No se ejecutó contra
-- turnia-staging ni ninguna otra base. Requiere autorización explícita antes
-- de aplicarse (Supabase CLI / dashboard, fuera de este entorno).
--
-- Qué agrega:
--   professional_reminders: agenda PERSONAL del profesional (no de turnos,
--   no de WhatsApp, no de seguimientos de pacientes — ver comentario en la
--   tabla). No existía ninguna tabla equivalente en las migraciones previas
--   (whatsapp_messaging_preparation, google_meet_and_email_messaging,
--   patients_unique_contact_proposal, appointments_public_token), así que se
--   crea nueva en vez de reutilizar algo existente.
--
-- Qué NO hace:
--   - No modifica ni elimina columnas ni tablas existentes.
--   - No borra ni migra datos.
--   - No cambia políticas RLS de tablas existentes.
--   - No crea triggers, cron jobs ni notificaciones push del navegador.
--
-- Aislamiento (PARTE 9 del pedido): cada recordatorio pertenece a UN
-- profesional dentro de UN tenant. RLS exige las dos condiciones a la vez
-- (public.is_tenant_member(tenant_id) Y professional_id = auth.uid()), así
-- que ni siquiera otro profesional del mismo consultorio puede ver los
-- recordatorios personales de un colega — a diferencia de integration_status
-- o appointment_messages (que sólo filtran por tenant), acá el filtro es
-- también por dueño exacto de la fila.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.professional_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  remind_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT professional_reminders_title_check CHECK (char_length(btrim(title)) > 0),
  CONSTRAINT professional_reminders_status_check CHECK (status = ANY (ARRAY['pending'::text, 'done'::text])),
  CONSTRAINT professional_reminders_completed_consistency_check CHECK (
    (status = 'done' AND completed_at IS NOT NULL) OR (status = 'pending' AND completed_at IS NULL)
  )
);

COMMENT ON TABLE public.professional_reminders IS
  'Agenda PERSONAL del profesional ("pasar a buscar la comida", "llamar al contador") — NO confundir con recordatorios de turnos, WhatsApp, o seguimientos de pacientes (patient_follow_ups), que son features completamente distintas y no se tocan acá. Visible sólo para el profesional dueño de la fila, dentro de su tenant (ver política RLS más abajo).';

COMMENT ON COLUMN public.professional_reminders.status IS
  '''pending'' o ''done''. completed_at es NOT NULL si y sólo si status = ''done'' (constraint professional_reminders_completed_consistency_check) — evita el estado inconsistente de "hecho sin fecha" o "pendiente con fecha de completado".';

ALTER TABLE public.professional_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS professional_reminders_owner_all ON public.professional_reminders;
CREATE POLICY professional_reminders_owner_all
  ON public.professional_reminders
  FOR ALL
  USING (public.is_tenant_member(tenant_id) AND professional_id = auth.uid())
  WITH CHECK (public.is_tenant_member(tenant_id) AND professional_id = auth.uid());

CREATE INDEX IF NOT EXISTS professional_reminders_owner_idx
  ON public.professional_reminders (tenant_id, professional_id, status, remind_at);

-- Sin trigger de updated_at: no hay certeza de que exista ya una función
-- helper tipo set_updated_at() en turnia-staging, y agregar una acá sería
-- ampliar el alcance de esta migración. Mismo patrón que el resto de la
-- app (agenda/actions.ts, patients/actions.ts, etc.): updated_at se setea
-- explícitamente desde cada server action en app/(protected)/reminders/actions.ts.

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario. Ver informe de la tarea (sección I) para el detalle.
-- ============================================================================
