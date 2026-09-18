-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Fase 1 de auditoría clínica — tabla clinical_audit_log + 3 RPC
-- transaccionales SECURITY DEFINER (upsert de ficha clínica, archivado de
-- paciente, creación de sesión/seguimiento)
-- Proyecto: turnia-staging (nnbpefxvpmegngqopcvw)
-- Generado: 2026-09-18
--
-- Este archivo es una PROPUESTA para revisión de Dario. NO se ejecutó
-- contra turnia-staging ni ninguna otra base. Requiere autorización
-- explícita antes de aplicarse (Supabase CLI / dashboard, fuera de este
-- entorno).
--
-- CONTEXTO (ver informe completo de la tarea de auditoría clínica):
--   - Se introspeccionó la base real y se confirmó que YA existe
--     public.audit_logs (0 filas, esquema genérico: id/tenant_id/
--     actor_user_id/action/resource_type/resource_id/created_at, sin
--     changed_fields/before_data/after_data/patient_id, sin código en este
--     repo que la lea ni la escriba). Esta migración NO la toca ni la
--     borra. clinical_audit_log queda deliberadamente separada: nace con
--     un único propósito (3 entity_type clínicos), soporta diffs
--     estructurados (changed_fields/before_data/after_data) que
--     audit_logs no tiene, y no depende de heredar permisos/estructura de
--     una tabla cuyo origen y diseño actual no están documentados en este
--     repo.
--   - Se confirmó también que public.clinical_sessions, public.recordings
--     y public.transcriptions existen en la base real, pero ningún código
--     de este repo las lee ni las escribe (grep sin resultados) — son
--     remanentes de la funcionalidad de Voice Notes de una versión
--     anterior a la reconstrucción "Recovery" (ver docs/recovery-status.md:
--     "No reactivar Voice Notes", y el chequeo de
--     scripts/security-regression.mjs que falla el build si aparece
--     MediaRecorder/getUserMedia/patient_voice_notes//transcribe en el
--     runtime activo). No participan de ningún flujo clínico activo hoy y
--     esta migración no las toca.
--   - El CHECK real de patient_follow_ups.source_type sólo permite
--     ('manual_text', 'voice_note') — NO ('manual_session',
--     'manual_follow_up'), a pesar de que el código actual de
--     app/(protected)/patients/actions.ts (líneas 196-256, antes de esta
--     migración) escribe esos dos últimos valores. Es un bug preexistente
--     de esa pasada, no introducido por esta migración ni por el cambio de
--     actions.ts que la acompaña — ver informe. La RPC de creación de
--     sesión/seguimiento de más abajo usa exclusivamente 'manual_text'
--     (el valor legacy real, compatible con el CHECK), nunca los dos
--     valores nuevos inexistentes en el schema real.
--   - patient_records.follow_up existe en la base real pero el flujo
--     activo de "Ficha clínica" (upsertPatientRecord) nunca lo lee ni lo
--     escribe. Esta migración preserva esa semántica exacta: la RPC de
--     ficha clínica no incluye follow_up ni en su lista de columnas del
--     INSERT ni en el SET del UPDATE (ON CONFLICT DO UPDATE conserva el
--     valor existente en la fila al no listar esa columna), y nunca genera
--     una entrada de auditoría para ese campo.
--
-- Qué agrega:
--   1) Tabla public.clinical_audit_log (nueva, separada de audit_logs).
--   2) 3 funciones SECURITY DEFINER: upsert_patient_record_with_audit,
--      archive_patient_with_audit, create_patient_follow_up_with_audit.
--
-- Qué NO hace:
--   - No modifica ni borra audit_logs, clinical_sessions, recordings,
--     transcriptions.
--   - No altera el schema de las tablas existentes (patients,
--     patient_records, patient_follow_ups, appointments, tenant_members).
--     Las RPC sí realizan las mutaciones clínicas ya existentes sobre
--     patients/patient_records/patient_follow_ups y agregan su auditoría
--     transaccional — ver secciones 4, 5 y 6 más abajo.
--   - No agrega ninguna función de UPDATE ni DELETE sobre
--     clinical_audit_log — no existe ningún camino, ni siquiera
--     administrativo dentro de esta migración, para editar o borrar una
--     fila ya escrita.
--   - No toca Google, WhatsApp, exportaciones PDF/Word/Excel, ni ningún
--     formulario/UI.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla public.clinical_audit_log
-- ----------------------------------------------------------------------------

CREATE TABLE public.clinical_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  actor_user_id  uuid NULL REFERENCES auth.users(id),
  actor_kind     text NOT NULL DEFAULT 'professional',
  entity_type    text NOT NULL,
  entity_id      uuid NOT NULL,
  patient_id     uuid NOT NULL REFERENCES public.patients(id),
  action         text NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}',
  before_data    jsonb NULL,
  after_data     jsonb NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT clinical_audit_log_actor_kind_check
    CHECK (actor_kind IN ('professional', 'public_token', 'system')),
  CONSTRAINT clinical_audit_log_entity_type_check
    CHECK (entity_type IN ('patient', 'patient_record', 'patient_follow_up')),
  CONSTRAINT clinical_audit_log_action_check
    CHECK (action IN ('create', 'update', 'archive', 'restore')),
  CONSTRAINT clinical_audit_log_professional_requires_actor
    CHECK (actor_kind <> 'professional' OR actor_user_id IS NOT NULL)
);

COMMENT ON TABLE public.clinical_audit_log IS
  'Auditoría de cambios sobre información clínica/sensible (Fase 1: ficha clínica de patient_records, archivado de patients, creación de sesiones/seguimientos en patient_follow_ups). Separada de public.audit_logs a propósito — ver cabecera de esta migración. Inmutable por diseño: sin updated_at, sin deleted_at, sin ninguna función de UPDATE/DELETE. El único camino de escritura son las 3 funciones SECURITY DEFINER de esta misma migración — ver sección de políticas/grants más abajo.';

COMMENT ON COLUMN public.clinical_audit_log.tenant_id IS
  'Resuelto siempre dentro de las funciones SECURITY DEFINER desde tenant_members + auth.uid() — nunca aceptado como parámetro de ninguna RPC ni escrito desde el cliente.';

COMMENT ON COLUMN public.clinical_audit_log.actor_user_id IS
  'auth.uid() de quien ejecutó la mutación, resuelto dentro de la función. NULL sólo permitido cuando actor_kind <> ''professional'' (ver constraint clinical_audit_log_professional_requires_actor) — no usado por ninguna de las 3 RPC de Fase 1, todas actor_kind=''professional''.';

COMMENT ON COLUMN public.clinical_audit_log.entity_id IS
  'Id de la fila afectada según entity_type: patients.id, patient_records.id o patient_follow_ups.id. Sin FK propia (polimórfico) — patient_id sí lleva FK real y es la forma soportada de consultar "todo el historial de este paciente" sin depender de a qué tabla apunta entity_id.';

COMMENT ON COLUMN public.clinical_audit_log.changed_fields IS
  'Nombres de columnas que efectivamente cambiaron, allowlisted explícitamente dentro de cada función (nunca calculado sobre "cualquier columna que cambie" de forma genérica). Nunca incluye nombres de columnas de tokens/secrets/credenciales.';

COMMENT ON COLUMN public.clinical_audit_log.before_data IS
  'Sólo contiene las claves listadas en changed_fields, con su valor previo. NULL en action=''create''. Nunca la fila completa.';

COMMENT ON COLUMN public.clinical_audit_log.after_data IS
  'Sólo contiene las claves listadas en changed_fields, con su valor nuevo. Nunca la fila completa.';

-- ----------------------------------------------------------------------------
-- 2) Índices
-- ----------------------------------------------------------------------------

CREATE INDEX clinical_audit_log_entity_idx
  ON public.clinical_audit_log (tenant_id, entity_type, entity_id, created_at DESC);

CREATE INDEX clinical_audit_log_actor_idx
  ON public.clinical_audit_log (tenant_id, actor_user_id, created_at DESC);

-- Caso de uso principal: historial completo de la ficha de un paciente,
-- sin importar en qué entity_type/entity_id quedó cada evento.
CREATE INDEX clinical_audit_log_patient_idx
  ON public.clinical_audit_log (tenant_id, patient_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3) RLS y grants — auditoría inmutable Y no falsificable
-- ----------------------------------------------------------------------------
--
-- authenticated: SOLO SELECT, filtrado por tenant vía is_tenant_member
-- (misma función ya usada en el resto del esquema, ver
-- 20260913210000_whatsapp_messaging_preparation.sql). Ninguna política de
-- INSERT/UPDATE/DELETE para 'authenticated' — sin política, RLS deniega
-- esa operación por defecto. Además, REVOKE ALL primero (cubre INSERT/
-- UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER sin depender de qué
-- privilegios existan en esta versión de Postgres, mismo criterio que
-- 20260917120000_rate_limit_counters.sql) y sólo después se otorga el
-- único privilegio que sí queremos: así 'authenticated' no tiene ni
-- siquiera el permiso de tabla para intentar escribir, más allá de lo
-- que ya bloquea RLS.
--
-- anon: sin ningún privilegio — ni SELECT.
--
-- service_role: sin ningún privilegio directo sobre la tabla. Ninguna de
-- las 3 RPC de Fase 1 corre en el flujo público sin sesión (a diferencia
-- de confirm_public_appointment y similares), así que no hay ninguna
-- razón para que service_role toque esta tabla directamente — el único
-- camino de escritura, para cualquier rol, son las 3 funciones
-- SECURITY DEFINER de abajo (dueñas: el rol que aplique esta migración).

ALTER TABLE public.clinical_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinical_audit_log_select_tenant_member
  ON public.clinical_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

REVOKE ALL ON TABLE public.clinical_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.clinical_audit_log TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) RPC 1 — upsert_patient_record_with_audit
-- ----------------------------------------------------------------------------
--
-- SECURITY DEFINER + SET search_path = '' + nombres calificados: mismo
-- criterio que confirm_public_appointment / check_rate_limit (ver esas
-- migraciones para la justificación completa del patrón). Actor y tenant
-- se resuelven DENTRO de la función desde auth.uid() + tenant_members —
-- la firma no tiene ningún parámetro tenant_id/actor_user_id/actor_kind.
--
-- Resolución de tenant (auth.uid() -> tenant_members -> LIMIT 1): hereda
-- EXACTAMENTE la misma suposición de "un usuario, un tenant" que ya usa
-- requireTenant() en lib/auth/require-user.ts hoy. tenant_members tiene
-- PK (tenant_id, user_id), NO UNIQUE(user_id) — si en el futuro un
-- usuario llegara a pertenecer a más de un tenant, este LIMIT 1 elegiría
-- una fila no determinística, exactamente la misma ambigüedad que ya
-- existiría del lado de TypeScript. Esta migración NO resuelve ni
-- introduce esa ambigüedad — sólo la hereda tal cual. Una futura
-- multi-tenancy por usuario requiere resolver esto (por ejemplo, con
-- UNIQUE(user_id) si el modelo de negocio pasa a exigirlo, o pasando el
-- tenant activo de forma explícita y verificada) ANTES de confiar en esta
-- función para ese escenario.
--
-- follow_up: a propósito NO aparece ni en el SELECT ... FOR UPDATE, ni en
-- la lista de columnas del INSERT, ni en el SET del DO UPDATE, ni en el
-- cálculo de changed_fields. En CREATE, Postgres aplica el DEFAULT propio
-- de la columna (nunca se fuerza un valor). En UPDATE, al no listarla en
-- SET, ON CONFLICT DO UPDATE conserva el valor que ya tenía la fila sin
-- tocarlo. Esta RPC nunca genera auditoría de ese campo. Cuando el
-- producto vuelva a habilitar follow_up en el flujo de ficha clínica,
-- esta función y su allowlist deberán ampliarse en una migración futura
-- — no antes.

CREATE OR REPLACE FUNCTION public.upsert_patient_record_with_audit(
  p_patient_id uuid,
  p_reason text,
  p_background text,
  p_diagnosis text,
  p_plan text,
  p_notes text
)
RETURNS TABLE (ok boolean, action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_patient_id uuid;
  v_record_id uuid;
  v_old_reason text;
  v_old_background text;
  v_old_diagnosis text;
  v_old_plan text;
  v_old_notes text;
  v_action text;
  v_changed_fields text[] := '{}';
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
BEGIN
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members AS tm
  WHERE tm.user_id = v_actor_user_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no_tenant' USING ERRCODE = '42501';
  END IF;

  -- Lock de la fila del paciente ANTES de tocar patient_records: serializa
  -- esta función contra cualquier otra transacción concurrente que también
  -- tome lock sobre la misma fila de patients (incluida
  -- archive_patient_with_audit), incluso en la primera creación de la
  -- ficha (cuando todavía no existe fila en patient_records que lockear).
  SELECT p.id INTO v_patient_id
  FROM public.patients AS p
  WHERE p.id = p_patient_id
    AND p.tenant_id = v_tenant_id
    AND p.deleted_at IS NULL
  FOR UPDATE;

  IF v_patient_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;

  -- Lock de la fila existente (si hay) para diffear de forma segura contra
  -- escrituras concurrentes sobre la misma ficha. follow_up NO se
  -- selecciona (ver comentario arriba de la función).
  SELECT pr.id, pr.reason, pr.background, pr.diagnosis, pr.plan, pr.notes
    INTO v_record_id, v_old_reason, v_old_background, v_old_diagnosis, v_old_plan, v_old_notes
  FROM public.patient_records AS pr
  WHERE pr.patient_id = p_patient_id AND pr.tenant_id = v_tenant_id
  FOR UPDATE;

  v_action := CASE WHEN v_record_id IS NULL THEN 'create' ELSE 'update' END;

  INSERT INTO public.patient_records (
    tenant_id, patient_id, reason, background, diagnosis, plan, notes, updated_at
  ) VALUES (
    v_tenant_id, p_patient_id, p_reason, p_background, p_diagnosis, p_plan, p_notes, clock_timestamp()
  )
  ON CONFLICT (patient_id) DO UPDATE SET
    reason = excluded.reason,
    background = excluded.background,
    diagnosis = excluded.diagnosis,
    plan = excluded.plan,
    notes = excluded.notes,
    updated_at = clock_timestamp()
  RETURNING id INTO v_record_id;

  IF v_action = 'create' THEN
    IF p_reason IS NOT NULL THEN
      v_changed_fields := array_append(v_changed_fields, 'reason');
      v_after := v_after || jsonb_build_object('reason', p_reason);
    END IF;
    IF p_background IS NOT NULL THEN
      v_changed_fields := array_append(v_changed_fields, 'background');
      v_after := v_after || jsonb_build_object('background', p_background);
    END IF;
    IF p_diagnosis IS NOT NULL THEN
      v_changed_fields := array_append(v_changed_fields, 'diagnosis');
      v_after := v_after || jsonb_build_object('diagnosis', p_diagnosis);
    END IF;
    IF p_plan IS NOT NULL THEN
      v_changed_fields := array_append(v_changed_fields, 'plan');
      v_after := v_after || jsonb_build_object('plan', p_plan);
    END IF;
    IF p_notes IS NOT NULL THEN
      v_changed_fields := array_append(v_changed_fields, 'notes');
      v_after := v_after || jsonb_build_object('notes', p_notes);
    END IF;
  ELSE
    IF p_reason IS DISTINCT FROM v_old_reason THEN
      v_changed_fields := array_append(v_changed_fields, 'reason');
      v_before := v_before || jsonb_build_object('reason', v_old_reason);
      v_after := v_after || jsonb_build_object('reason', p_reason);
    END IF;
    IF p_background IS DISTINCT FROM v_old_background THEN
      v_changed_fields := array_append(v_changed_fields, 'background');
      v_before := v_before || jsonb_build_object('background', v_old_background);
      v_after := v_after || jsonb_build_object('background', p_background);
    END IF;
    IF p_diagnosis IS DISTINCT FROM v_old_diagnosis THEN
      v_changed_fields := array_append(v_changed_fields, 'diagnosis');
      v_before := v_before || jsonb_build_object('diagnosis', v_old_diagnosis);
      v_after := v_after || jsonb_build_object('diagnosis', p_diagnosis);
    END IF;
    IF p_plan IS DISTINCT FROM v_old_plan THEN
      v_changed_fields := array_append(v_changed_fields, 'plan');
      v_before := v_before || jsonb_build_object('plan', v_old_plan);
      v_after := v_after || jsonb_build_object('plan', p_plan);
    END IF;
    IF p_notes IS DISTINCT FROM v_old_notes THEN
      v_changed_fields := array_append(v_changed_fields, 'notes');
      v_before := v_before || jsonb_build_object('notes', v_old_notes);
      v_after := v_after || jsonb_build_object('notes', p_notes);
    END IF;
  END IF;

  -- Sin cambios en ninguno de los 5 campos auditables: no se inserta
  -- ninguna fila de auditoría (ni en create sin contenido, ni en update
  -- sin diferencias) — nunca una entrada vacía.
  IF array_length(v_changed_fields, 1) IS NOT NULL THEN
    INSERT INTO public.clinical_audit_log (
      tenant_id, actor_user_id, actor_kind, entity_type, entity_id, patient_id,
      action, changed_fields, before_data, after_data
    ) VALUES (
      v_tenant_id, v_actor_user_id, 'professional', 'patient_record', v_record_id, p_patient_id,
      v_action, v_changed_fields,
      CASE WHEN v_action = 'create' THEN NULL ELSE v_before END,
      v_after
    );
  END IF;

  RETURN QUERY SELECT true, v_action;
END;
$$;

COMMENT ON FUNCTION public.upsert_patient_record_with_audit(uuid, text, text, text, text, text) IS
  'Crea o actualiza la ficha clínica (patient_records: reason/background/diagnosis/plan/notes) y registra su auditoría en clinical_audit_log dentro de la MISMA transacción. NO lee ni escribe patient_records.follow_up (ver comentario en el cuerpo de la función). tenant_id/actor_user_id resueltos internamente desde auth.uid() + tenant_members — nunca parámetros. Devuelve ok=false (sin escribir nada) si el paciente no existe, no pertenece al tenant del usuario, o está archivado. Ejecutable únicamente por authenticated.';

REVOKE ALL ON FUNCTION public.upsert_patient_record_with_audit(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_patient_record_with_audit(uuid, text, text, text, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5) RPC 2 — archive_patient_with_audit
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.archive_patient_with_audit(
  p_patient_id uuid
)
RETURNS TABLE (ok boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_now timestamptz;
  v_updated_id uuid;
BEGIN
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members AS tm
  WHERE tm.user_id = v_actor_user_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no_tenant' USING ERRCODE = '42501';
  END IF;

  v_now := clock_timestamp();

  UPDATE public.patients AS p
  SET deleted_at = v_now, updated_at = v_now
  WHERE p.id = p_patient_id
    AND p.tenant_id = v_tenant_id
    AND p.deleted_at IS NULL
  RETURNING p.id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    -- No encontrado, de otro tenant, o ya estaba archivado: mismo
    -- resultado (ok=false), SIN insertar ninguna fila de auditoría —
    -- nunca un action='archive' falso sobre algo que ya estaba archivado.
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  INSERT INTO public.clinical_audit_log (
    tenant_id, actor_user_id, actor_kind, entity_type, entity_id, patient_id,
    action, changed_fields, before_data, after_data
  ) VALUES (
    v_tenant_id, v_actor_user_id, 'professional', 'patient', p_patient_id, p_patient_id,
    'archive', ARRAY['deleted_at'],
    jsonb_build_object('deleted_at', NULL),
    jsonb_build_object('deleted_at', v_now)
  );

  RETURN QUERY SELECT true;
END;
$$;

COMMENT ON FUNCTION public.archive_patient_with_audit(uuid) IS
  'Archiva (soft delete) un paciente y registra su auditoría en clinical_audit_log dentro de la MISMA transacción. Mismo timestamp (clock_timestamp(), calculado una sola vez) escrito en patients.deleted_at/updated_at y en after_data. ok=false, sin auditoría, si el paciente no existe, no pertenece al tenant o ya estaba archivado. tenant_id/actor_user_id resueltos internamente. Ejecutable únicamente por authenticated.';

REVOKE ALL ON FUNCTION public.archive_patient_with_audit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_patient_with_audit(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6) RPC 3 — create_patient_follow_up_with_audit
-- ----------------------------------------------------------------------------
--
-- source_type SIEMPRE 'manual_text': único valor del CHECK real de
-- patient_follow_ups.source_type (('manual_text', 'voice_note'))
-- compatible con una carga manual desde la app — ver cabecera de esta
-- migración. 'manual_session'/'manual_follow_up' NO existen en el schema
-- real y NUNCA se escriben acá. La distinción Sesión/Seguimiento para la
-- UI se sigue haciendo, como ya hacía el código para filas legacy, por
-- appointment_id IS NOT NULL — nunca por source_type. voice_note_id
-- siempre NULL: esta función no participa del flujo de Voice Notes
-- (desactivado, ver docs/recovery-status.md) y no lo reactiva.

CREATE OR REPLACE FUNCTION public.create_patient_follow_up_with_audit(
  p_patient_id uuid,
  p_content text,
  p_appointment_id uuid DEFAULT NULL
)
RETURNS TABLE (ok boolean, follow_up_id uuid, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_patient_id uuid;
  v_appointment_exists boolean;
  v_follow_up_id uuid;
BEGIN
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members AS tm
  WHERE tm.user_id = v_actor_user_id
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no_tenant' USING ERRCODE = '42501';
  END IF;

  -- Lock de la fila del paciente ANTES del insert: serializa esta función
  -- contra cualquier otra transacción concurrente que también tome lock
  -- sobre la misma fila de patients (incluida archive_patient_with_audit).
  SELECT p.id INTO v_patient_id
  FROM public.patients AS p
  WHERE p.id = p_patient_id AND p.tenant_id = v_tenant_id AND p.deleted_at IS NULL
  FOR UPDATE;

  IF v_patient_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, 'patient_not_found'::text;
    RETURN;
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.appointments AS a
      WHERE a.id = p_appointment_id
        AND a.tenant_id = v_tenant_id
        AND a.patient_id = p_patient_id
    ) INTO v_appointment_exists;

    IF NOT v_appointment_exists THEN
      RETURN QUERY SELECT false, NULL::uuid, 'appointment_invalid'::text;
      RETURN;
    END IF;
  END IF;

  INSERT INTO public.patient_follow_ups (
    tenant_id, professional_id, patient_id, appointment_id,
    source_type, voice_note_id, content
  ) VALUES (
    v_tenant_id, v_actor_user_id, p_patient_id, p_appointment_id,
    'manual_text', NULL, p_content
  )
  RETURNING id INTO v_follow_up_id;

  INSERT INTO public.clinical_audit_log (
    tenant_id, actor_user_id, actor_kind, entity_type, entity_id, patient_id,
    action, changed_fields, before_data, after_data
  ) VALUES (
    v_tenant_id, v_actor_user_id, 'professional', 'patient_follow_up', v_follow_up_id, p_patient_id,
    'create', ARRAY['content'], NULL, jsonb_build_object('content', p_content)
  );

  RETURN QUERY SELECT true, v_follow_up_id, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.create_patient_follow_up_with_audit(uuid, text, uuid) IS
  'Crea una sesión o seguimiento manual (patient_follow_ups) y registra su auditoría en clinical_audit_log dentro de la MISMA transacción. source_type siempre ''manual_text'' (único valor del CHECK real compatible con carga manual — nunca ''manual_session''/''manual_follow_up''); voice_note_id siempre NULL. reason distingue por qué ok=false: ''patient_not_found'' o ''appointment_invalid''. tenant_id/actor_user_id/professional_id resueltos internamente desde auth.uid(). Ejecutable únicamente por authenticated.';

REVOKE ALL ON FUNCTION public.create_patient_follow_up_with_audit(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_patient_follow_up_with_audit(uuid, text, uuid) TO authenticated;

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario. Ver el informe de la tarea para el detalle completo del diseño.
-- ============================================================================
