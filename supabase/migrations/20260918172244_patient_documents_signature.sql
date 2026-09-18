-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Fase 1 de firma digital externa — tabla patient_documents +
-- patient_document_audit_log + 2 RPC transaccionales SECURITY DEFINER
-- (creación/versionado de documento, adjuntar copia firmada subida por el
-- propio profesional).
-- Proyecto: turnia-staging (nnbpefxvpmegngqopcvw)
-- Generado: 2026-09-18
--
-- Este archivo es una PROPUESTA para revisión de Dario. NO se ejecutó contra
-- turnia-staging ni ninguna otra base. Requiere autorización explícita antes
-- de aplicarse (Supabase CLI / dashboard, fuera de este entorno).
--
-- CONTEXTO (ver informe de arquitectura completo de la tarea de firma
-- digital externa):
--   - TurnIA NO firma digitalmente por sí mismo en Fase 1: el profesional
--     genera un PDF desde TurnIA, lo descarga, lo firma con la herramienta
--     que quiera FUERA de TurnIA, y sube el PDF ya firmado de vuelta.
--     TurnIA sólo guarda ambos archivos y su trazabilidad — nunca valida
--     PKI/certificado/firma embebida del PDF. Por eso el estado post-carga
--     se llama 'signed_uploaded_unverified', nunca 'signed' a secas, y la
--     UI nunca debe decir "firma verificada" en esta fase.
--   - Storage: la documentación oficial actual de Supabase ("Creating
--     Buckets") indica explícitamente tres formas soportadas de crear un
--     bucket — Dashboard, client library, o SQL insertando en
--     storage.buckets — así que un INSERT directo en storage.buckets es una
--     práctica válida y no algo a evitar. El bucket patient-documents de
--     esta Fase 1 NO se creó dentro de esta migración de todos modos: se
--     gestionó como una dependencia de infraestructura aparte, creada y
--     verificada ANTES de aplicar esta migración (public=false,
--     file_size_limit=20971520, allowed_mime_types={'application/pdf'}, sin
--     policies directas para anon/authenticated sobre storage.objects) — ver
--     el bloque "DEPENDENCIA DE INFRAESTRUCTURA: BUCKET patient-documents"
--     al final de este archivo con el detalle y la verificación ya
--     realizada.
--   - Ownership: a diferencia de clinical_audit_log (donde cualquier
--     miembro del tenant puede mutar sobre cualquier paciente del tenant),
--     acá la MUTACIÓN de un documento está atada al profesional que lo creó
--     (patient_documents.professional_user_id = auth.uid() en el momento de
--     creación). Sólo ese mismo profesional puede adjuntar el PDF firmado o
--     generar una nueva versión — nunca otro miembro del mismo tenant,
--     aunque tenga acceso de lectura. La LECTURA/listado sigue siendo por
--     tenant (is_tenant_member), sin restricción de ownership — eso se
--     revisará en una fase posterior si el producto lo necesita.
--
-- Qué agrega:
--   1) Tabla public.patient_documents (nueva).
--   2) Tabla public.patient_document_audit_log (nueva, separada de
--      clinical_audit_log y de audit_logs — ver justificación en el informe
--      de arquitectura: eventos de ciclo de vida de documento, no diffs de
--      contenido clínico, y audit_logs no tiene patient_id ni un patrón de
--      escritura establecido).
--   3) 2 funciones SECURITY DEFINER: create_patient_document,
--      attach_signed_patient_document.
--
-- Qué NO hace:
--   - No modifica ninguna tabla existente (patients, patient_records,
--     patient_follow_ups, tenant_members, clinical_audit_log, audit_logs).
--   - No crea el bucket de Storage ni ninguna policy sobre storage.objects
--     — ese bucket ya existía como dependencia de infraestructura antes de
--     aplicar esta migración, ver "DEPENDENCIA DE INFRAESTRUCTURA: BUCKET
--     patient-documents" al final.
--   - No agrega ninguna función de UPDATE ni DELETE sobre
--     patient_document_audit_log — inmutable, mismo criterio que
--     clinical_audit_log.
--   - No implementa endpoints ni UI — sólo el esquema de base.
--   - No valida PKI, certificado, ni la firma digital embebida en el PDF
--     subido — eso está deliberadamente fuera de alcance de Fase 1.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Tabla public.patient_documents
-- ----------------------------------------------------------------------------
--
-- document_id se genera SIEMPRE server-side (crypto.randomUUID() en la app,
-- nunca en el cliente) y se pasa explícito a create_patient_document, porque
-- el endpoint necesita conocer el id ANTES de insertar la fila para poder
-- armar el path de Storage ({tenant_id}/{patient_id}/{document_id}/...) y
-- subir el objeto antes de registrar la metadata (ver comentario de
-- create_patient_document más abajo sobre por qué el orden es
-- Storage-primero-DB-después, y compensación si falla el segundo paso).

CREATE TABLE public.patient_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id),
  patient_id              uuid NOT NULL REFERENCES public.patients(id),
  professional_user_id    uuid NOT NULL REFERENCES auth.users(id),

  document_type           text NOT NULL,
  document_label          text NULL,

  status                  text NOT NULL DEFAULT 'pending_signature',

  original_storage_path   text NOT NULL,
  original_sha256         text NOT NULL,
  original_bytes          bigint NOT NULL,
  original_created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),

  signed_storage_path     text NULL,
  signed_sha256           text NULL,
  signed_bytes            bigint NULL,
  signed_uploaded_by      uuid NULL REFERENCES auth.users(id),
  signed_at               timestamptz NULL,

  document_group_id       uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1,
  supersedes_document_id  uuid NULL REFERENCES public.patient_documents(id),

  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT patient_documents_document_type_check
    CHECK (document_type IN ('ficha_clinica', 'consentimiento_informado', 'informe_clinico', 'otro')),

  CONSTRAINT patient_documents_status_check
    CHECK (status IN ('pending_signature', 'signed_uploaded_unverified')),

  CONSTRAINT patient_documents_version_check
    CHECK (version >= 1),

  CONSTRAINT patient_documents_original_bytes_check
    CHECK (original_bytes > 0),

  CONSTRAINT patient_documents_signed_bytes_check
    CHECK (signed_bytes IS NULL OR signed_bytes > 0),

  CONSTRAINT patient_documents_original_sha256_format_check
    CHECK (original_sha256 ~ '^[0-9a-f]{64}$'),

  CONSTRAINT patient_documents_signed_sha256_format_check
    CHECK (signed_sha256 IS NULL OR signed_sha256 ~ '^[0-9a-f]{64}$'),

  -- Consistencia estado <-> campos signed_*: en pending_signature TODOS los
  -- signed_* tienen que ser NULL; en signed_uploaded_unverified TODOS tienen
  -- que estar completos. No hay estado intermedio posible.
  CONSTRAINT patient_documents_status_signed_fields_check
    CHECK (
      (status = 'pending_signature'
        AND signed_storage_path IS NULL AND signed_sha256 IS NULL
        AND signed_bytes IS NULL AND signed_uploaded_by IS NULL AND signed_at IS NULL)
      OR
      (status = 'signed_uploaded_unverified'
        AND signed_storage_path IS NOT NULL AND signed_sha256 IS NOT NULL
        AND signed_bytes IS NOT NULL AND signed_uploaded_by IS NOT NULL AND signed_at IS NOT NULL)
    ),

  -- version 1 siempre abre su propio grupo (document_group_id = su propio
  -- id) y no tiene predecesor; version > 1 siempre tiene predecesor
  -- explícito. La continuidad de document_group_id entre versiones de un
  -- mismo grupo, y que no haya dos filas con el mismo supersedes_document_id,
  -- se garantiza en create_patient_document (único camino de INSERT) — no
  -- son expresables como CHECK de una sola fila.
  CONSTRAINT patient_documents_version_group_check
    CHECK (
      (version = 1 AND document_group_id = id AND supersedes_document_id IS NULL)
      OR
      (version > 1 AND supersedes_document_id IS NOT NULL)
    ),

  CONSTRAINT patient_documents_not_self_superseding_check
    CHECK (supersedes_document_id IS NULL OR supersedes_document_id <> id)
);

COMMENT ON TABLE public.patient_documents IS
  'Fase 1 de firma digital externa: PDF generado por TurnIA ("original") y, opcionalmente, su copia firmada fuera de TurnIA y re-subida ("signed_uploaded_unverified"). TurnIA no firma ni valida PKI/certificado — sólo conserva trazabilidad e integridad (hash) de ambos archivos. Inmutable por diseño salvo la única transición pending_signature -> signed_uploaded_unverified (ver attach_signed_patient_document). El único camino de escritura son las 2 funciones SECURITY DEFINER de esta misma migración.';

COMMENT ON COLUMN public.patient_documents.professional_user_id IS
  'auth.uid() de quien generó ESTE documento (fila), resuelto dentro de create_patient_document — nunca aceptado como parámetro. Determina el ownership: sólo este mismo usuario puede adjuntar el firmado (attach_signed_patient_document) o generar una nueva versión que lo supere (create_patient_document con p_supersedes_document_id). Pertenecer al mismo tenant NO alcanza para mutar — sólo para leer/listar.';

COMMENT ON COLUMN public.patient_documents.original_sha256 IS
  'SHA-256 (hex, 64 caracteres) del PDF original tal cual se subió a Storage. Sirve ÚNICAMENTE para verificar integridad (detectar si el archivo cambió después de subido) — NO prueba autoría, NO es una firma digital, y no tiene ninguna relación criptográfica verificada con signed_sha256.';

COMMENT ON COLUMN public.patient_documents.signed_sha256 IS
  'SHA-256 (hex, 64 caracteres) del PDF firmado tal cual se subió a Storage. Sirve ÚNICAMENTE para verificar integridad del archivo subido — Fase 1 NO valida la firma digital/PKI/certificado embebido en el PDF, y este hash NO prueba que el archivo derive criptográficamente del original ni que la firma sea válida. Por eso el estado se llama signed_uploaded_unverified y no "signed": es un hecho de que se subió un archivo marcado como firmado por el profesional, no una verificación.';

COMMENT ON COLUMN public.patient_documents.document_group_id IS
  'Agrupa todas las versiones de "el mismo documento lógico". En version=1 es igual a id (fila fundacional del grupo). Las versiones siguientes heredan el mismo document_group_id de la fila que superan. La versión vigente de un grupo se resuelve por MAX(version), nunca por un flag mutable — ninguna fila se actualiza para "dejar de ser la vigente".';

COMMENT ON COLUMN public.patient_documents.supersedes_document_id IS
  'Fila anterior que esta versión reemplaza. NULL sólo en version=1. La fila anterior nunca se modifica ni se borra: "reemplazar un documento firmado" es siempre crear una fila nueva, nunca tocar la existente (ver attach_signed_patient_document — no existe ningún camino para reescribir signed_* sobre una fila ya en signed_uploaded_unverified).';

-- Una sola fila por (grupo, versión) — evita dos "v2" concurrentes del mismo
-- documento incluso si hubiera un bug en la lógica de create_patient_document
-- (defensa en profundidad además del lock + chequeo explícito, ver la RPC).
CREATE UNIQUE INDEX patient_documents_group_version_uidx
  ON public.patient_documents (document_group_id, version);

-- Una fila sólo puede tener UN sucesor directo — Postgres lo garantiza
-- estructuralmente, además del lock FOR UPDATE + chequeo already_superseded
-- que ya hace create_patient_document (ese chequeo sigue siendo el que
-- produce el reason amigable; este índice es el backstop si esa lógica
-- tuviera un bug).
CREATE UNIQUE INDEX patient_documents_supersedes_uidx
  ON public.patient_documents (supersedes_document_id)
  WHERE supersedes_document_id IS NOT NULL;

-- Cada storage_path se usa una sola vez — defensa en profundidad si algún
-- día se agrega otro camino de escritura por error.
CREATE UNIQUE INDEX patient_documents_original_storage_path_uidx
  ON public.patient_documents (original_storage_path);

CREATE UNIQUE INDEX patient_documents_signed_storage_path_uidx
  ON public.patient_documents (signed_storage_path)
  WHERE signed_storage_path IS NOT NULL;

-- Historial de un paciente (tab "Documentos" de la ficha) y resolución de
-- "versión vigente" de un grupo.
CREATE INDEX patient_documents_patient_idx
  ON public.patient_documents (tenant_id, patient_id, created_at DESC);

CREATE INDEX patient_documents_group_idx
  ON public.patient_documents (tenant_id, document_group_id, version DESC);

-- ----------------------------------------------------------------------------
-- 2) Tabla public.patient_document_audit_log
-- ----------------------------------------------------------------------------
--
-- Separada de clinical_audit_log a propósito (ver informe de arquitectura):
-- clinical_audit_log está diseñada para diffs de contenido clínico
-- (reason/diagnosis/plan/notes, before_data/after_data de texto). Un evento
-- de documento es un evento de ciclo de vida (creado/firmado/superado) sobre
-- hashes y paths, no un diff de contenido — mezclar ambos modelos en la
-- misma tabla hubiera obligado a reabrir el CHECK de entity_type/action de
-- clinical_audit_log (ya revisado) para algo que no encaja bien en su
-- diseño. Tampoco se reutiliza audit_logs (existente, 0 filas): no tiene
-- patient_id (habría que resolver "historial de este paciente" vía JOIN
-- indirecto por resource_id) y no tiene ningún patrón de escritura
-- establecido todavía — reutilizarla hubiera costado la misma
-- infraestructura de RPC/RLS que esta tabla nueva, con un esquema peor.

CREATE TABLE public.patient_document_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES public.tenants(id),
  actor_user_id  uuid NULL REFERENCES auth.users(id),
  actor_kind     text NOT NULL DEFAULT 'professional',
  document_id    uuid NOT NULL REFERENCES public.patient_documents(id),
  patient_id     uuid NOT NULL REFERENCES public.patients(id),
  event          text NOT NULL,
  detail         jsonb NULL,
  created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT patient_document_audit_log_actor_kind_check
    CHECK (actor_kind IN ('professional', 'system')),
  CONSTRAINT patient_document_audit_log_event_check
    CHECK (event IN ('document_created', 'signed_copy_uploaded', 'document_superseded')),
  CONSTRAINT patient_document_audit_log_professional_requires_actor
    CHECK (actor_kind <> 'professional' OR actor_user_id IS NOT NULL)
);

COMMENT ON TABLE public.patient_document_audit_log IS
  'Auditoría de eventos de ciclo de vida de public.patient_documents (Fase 1 de firma digital externa). Separada de clinical_audit_log y de audit_logs a propósito — ver cabecera de esta migración. Inmutable por diseño: sin updated_at, sin deleted_at, sin ninguna función de UPDATE/DELETE. El único camino de escritura son create_patient_document y attach_signed_patient_document, en la MISMA transacción que la mutación de patient_documents que auditan.';

COMMENT ON COLUMN public.patient_document_audit_log.detail IS
  'Datos mínimos allowlisted por evento (ej. document_type en document_created, superseded_by en document_superseded) — nunca bytes del PDF, nunca storage_path completo si el document_id ya alcanza para trazar el evento.';

CREATE INDEX patient_document_audit_log_patient_idx
  ON public.patient_document_audit_log (tenant_id, patient_id, created_at DESC);

CREATE INDEX patient_document_audit_log_document_idx
  ON public.patient_document_audit_log (tenant_id, document_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3) RLS y grants — ambas tablas: lectura por tenant, cero escritura directa
-- ----------------------------------------------------------------------------
--
-- authenticated: SOLO SELECT, filtrado por tenant vía is_tenant_member
-- (mismo criterio que clinical_audit_log y el resto del esquema). La
-- lectura/listado es por tenant, sin restricción de ownership — eso se
-- revisará en una fase posterior. La MUTACIÓN sí está restringida a
-- ownership, pero eso se aplica dentro de las funciones, no por RLS (RLS
-- acá sólo decide "SELECT sí, todo lo demás no" — la restricción de
-- ownership sobre escritura vive en las RPC porque authenticated no tiene
-- ningún privilegio de escritura de todos modos).
--
-- REVOKE ALL primero (cubre INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/
-- TRIGGER sin depender de qué privilegios existan en esta versión de
-- Postgres, mismo criterio que clinical_audit_log y
-- 20260917120000_rate_limit_counters.sql), y sólo después se otorga el
-- único privilegio que sí queremos.
--
-- anon: sin ningún privilegio — ni SELECT.
-- service_role: sin ningún privilegio directo sobre ninguna de las dos
-- tablas — no hay ningún flujo público sin sesión en Fase 1 de firma
-- digital, así que no hay razón para que service_role las toque
-- directamente (el cliente service-role de lib/supabase/service.ts se usa
-- para Storage, no para estas tablas).

ALTER TABLE public.patient_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_documents_select_tenant_member
  ON public.patient_documents
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

REVOKE ALL ON TABLE public.patient_documents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.patient_documents TO authenticated;

ALTER TABLE public.patient_document_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_document_audit_log_select_tenant_member
  ON public.patient_document_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_tenant_member(tenant_id));

REVOKE ALL ON TABLE public.patient_document_audit_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.patient_document_audit_log TO authenticated;

-- ----------------------------------------------------------------------------
-- 4) RPC 1 — create_patient_document
-- ----------------------------------------------------------------------------
--
-- SECURITY DEFINER + SET search_path = '' + nombres calificados: mismo
-- criterio que confirm_public_appointment / check_rate_limit /
-- upsert_patient_record_with_audit. Actor y tenant se resuelven DENTRO de
-- la función desde auth.uid() + tenant_members — la firma no tiene ningún
-- parámetro tenant_id/actor_user_id/professional_user_id.
--
-- p_document_id se recibe como parámetro (generado server-side por la app,
-- NUNCA por el cliente/browser) porque Storage y Postgres NO son una
-- transacción: el endpoint necesita subir el PDF original a
-- {tenant_id}/{patient_id}/{document_id}/original.pdf ANTES de poder
-- registrar la metadata (si subiera primero y recién después generara el
-- id, no podría nombrar el objeto con el id real). El flujo esperado del
-- endpoint es: generar buffer -> calcular hash -> subir objeto a Storage ->
-- llamar esta RPC -> si la RPC devuelve ok=false, borrar el objeto recién
-- subido (compensación best-effort, fuera de esta migración). Un
-- document_id repetido simplemente viola el PRIMARY KEY y la función
-- devuelve el error de Postgres tal cual — no hay manejo especial acá
-- porque un choque de UUID v4 es de probabilidad despreciable y, si
-- pasara, no hay ningún riesgo de pisar una fila ajena (el INSERT
-- simplemente falla).
--
-- Concurrencia:
--   - Se lockea SIEMPRE la fila de patients (FOR UPDATE) antes de insertar,
--     mismo patrón que upsert_patient_record_with_audit /
--     create_patient_follow_up_with_audit — serializa contra
--     archive_patient_with_audit.
--   - Si p_supersedes_document_id no es NULL, se lockea (FOR UPDATE) esa
--     fila ANTES de decidir si se puede versionar. Dos llamadas
--     concurrentes con el mismo p_supersedes_document_id se serializan por
--     ese lock: la segunda espera a que la primera termine (COMMIT libera
--     el lock), y recién ahí hace su propio SELECT de "¿ya tiene sucesor?"
--     — como ese SELECT corre después de esperar el lock, ve el INSERT ya
--     commiteado de la primera y se rechaza con reason='already_superseded'.
--     El UNIQUE(document_group_id, version) es el backstop estructural por
--     si esta lógica tuviera un bug: aunque dos INSERT llegaran a
--     ejecutarse con la misma (group_id, version) calculada, el segundo
--     falla por el índice único, nunca se corrompen datos.
--
-- Ownership (CORRECCIÓN 1): si se versiona un documento existente, sólo el
-- professional_user_id dueño de esa versión anterior puede hacerlo. Otro
-- profesional del mismo tenant (aunque pueda leerlo) NO puede generar una
-- nueva versión — reason='not_document_owner', sin insertar nada.

CREATE OR REPLACE FUNCTION public.create_patient_document(
  p_document_id uuid,
  p_patient_id uuid,
  p_document_type text,
  p_document_label text,
  p_original_storage_path text,
  p_original_sha256 text,
  p_original_bytes bigint,
  p_supersedes_document_id uuid DEFAULT NULL
)
RETURNS TABLE (ok boolean, document_id uuid, document_group_id uuid, version integer, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_patient_id uuid;
  v_expected_original_path text;
  v_old_owner uuid;
  v_old_group_id uuid;
  v_old_version integer;
  v_already_superseded boolean;
  v_group_id uuid;
  v_version integer;
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

  -- Lock de la fila del paciente, mismo patrón de las RPC de auditoría
  -- clínica — serializa contra archive_patient_with_audit y contra otra
  -- creación de documento concurrente sobre el mismo paciente.
  SELECT p.id INTO v_patient_id
  FROM public.patients AS p
  WHERE p.id = p_patient_id
    AND p.tenant_id = v_tenant_id
    AND p.deleted_at IS NULL
  FOR UPDATE;

  IF v_patient_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::integer, 'patient_not_found'::text;
    RETURN;
  END IF;

  -- CORRECCIÓN — storage path confusion / cross-tenant: la función tiene
  -- EXECUTE para authenticated, así que un usuario podría invocarla
  -- directamente (sin pasar por nuestros route handlers) con un
  -- p_original_storage_path arbitrario. tenant_id/patient_id/document_id ya
  -- están resueltos y autorizados en este punto (nunca se usa lo que venga
  -- del parámetro para construir el path esperado) — el único path que se
  -- acepta es exactamente el que la app tendría que haber usado para subir
  -- el original. Cualquier otro valor (de otro tenant, otro paciente, u
  -- otro documento) se rechaza sin insertar ni auditar nada.
  v_expected_original_path :=
    v_tenant_id::text || '/' ||
    p_patient_id::text || '/' ||
    p_document_id::text || '/original.pdf';

  IF p_original_storage_path <> v_expected_original_path THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::integer, 'invalid_storage_path'::text;
    RETURN;
  END IF;

  IF p_supersedes_document_id IS NULL THEN
    v_group_id := p_document_id;
    v_version := 1;
  ELSE
    -- Lock de la fila anterior ANTES de decidir si se puede versionar —
    -- ver comentario de concurrencia arriba de la función.
    SELECT pd.professional_user_id, pd.document_group_id, pd.version
      INTO v_old_owner, v_old_group_id, v_old_version
    FROM public.patient_documents AS pd
    WHERE pd.id = p_supersedes_document_id
      AND pd.tenant_id = v_tenant_id
      AND pd.patient_id = p_patient_id
    FOR UPDATE;

    IF v_old_owner IS NULL THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::integer, 'document_not_found'::text;
      RETURN;
    END IF;

    IF v_old_owner <> v_actor_user_id THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::integer, 'not_document_owner'::text;
      RETURN;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.patient_documents AS pd
      WHERE pd.supersedes_document_id = p_supersedes_document_id
    ) INTO v_already_superseded;

    IF v_already_superseded THEN
      RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::integer, 'already_superseded'::text;
      RETURN;
    END IF;

    v_group_id := v_old_group_id;
    v_version := v_old_version + 1;
  END IF;

  INSERT INTO public.patient_documents (
    id, tenant_id, patient_id, professional_user_id,
    document_type, document_label,
    original_storage_path, original_sha256, original_bytes,
    document_group_id, version, supersedes_document_id
  ) VALUES (
    p_document_id, v_tenant_id, p_patient_id, v_actor_user_id,
    p_document_type, p_document_label,
    p_original_storage_path, p_original_sha256, p_original_bytes,
    v_group_id, v_version, p_supersedes_document_id
  );

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    v_tenant_id, v_actor_user_id, 'professional', p_document_id, p_patient_id,
    'document_created', jsonb_build_object('document_type', p_document_type)
  );

  IF p_supersedes_document_id IS NOT NULL THEN
    -- La fila anterior NUNCA se modifica — sólo se audita el evento sobre
    -- ella, apuntando a la fila nueva que la reemplaza.
    INSERT INTO public.patient_document_audit_log (
      tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
    ) VALUES (
      v_tenant_id, v_actor_user_id, 'professional', p_supersedes_document_id, p_patient_id,
      'document_superseded', jsonb_build_object('superseded_by', p_document_id)
    );
  END IF;

  RETURN QUERY SELECT true, p_document_id, v_group_id, v_version, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.create_patient_document(uuid, uuid, text, text, text, text, bigint, uuid) IS
  'Registra un documento ya subido a Storage (original) y su auditoría en la MISMA transacción. p_document_id lo genera la app server-side ANTES de llamar esta función (necesario para poder subir a Storage primero — ver comentario en el cuerpo). p_original_storage_path se valida contra el path exacto esperado ({tenant_id}/{patient_id}/{document_id}/original.pdf), calculado internamente — nunca se confía en el valor del parámetro tal cual (reason=invalid_storage_path si no coincide, sin insertar nada; necesario porque esta función tiene EXECUTE para authenticated y puede invocarse sin pasar por los route handlers). Si p_supersedes_document_id viene, exige que quien llama sea professional_user_id de esa versión anterior (ok=false, reason=not_document_owner si no) y que nadie la haya versionado todavía (reason=already_superseded si no). tenant_id/actor_user_id resueltos internamente desde auth.uid() + tenant_members. Ejecutable únicamente por authenticated.';

-- ----------------------------------------------------------------------------
-- 5) RPC 2 — attach_signed_patient_document
-- ----------------------------------------------------------------------------
--
-- Storage y Postgres NO son una transacción: el flujo esperado del endpoint
-- es validar el PDF (magic bytes, tamaño) -> calcular hash -> subir a un
-- path único {tenant_id}/{patient_id}/{document_id}/signed/{upload_uuid}.pdf
-- (nunca overwrite del mismo path) -> llamar esta RPC -> si devuelve
-- ok=false, borrar el objeto recién subido (compensación best-effort, fuera
-- de esta migración).
--
-- Concurrencia: el SELECT ... FOR UPDATE sobre la fila serializa cualquier
-- llamada concurrente sobre el mismo p_document_id — la que pierde la
-- carrera ve status ya en 'signed_uploaded_unverified' (o el ownership ya
-- resuelto) y devuelve ok=false sin tocar nada, nunca hay un UPDATE que
-- pise a otro.
--
-- Orden de locks (paciente ANTES que documento, igual que
-- create_patient_document): primero se hace una lectura SIN lock del
-- patient_id de la fila (patient_id nunca cambia después del INSERT, así
-- que esa lectura no bloqueada es segura), sólo para saber qué fila de
-- patients hay que lockear primero. Recién después se lockea patients
-- (FOR UPDATE) y luego patient_documents (FOR UPDATE), con un re-chequeo
-- autoritativo de ownership/estado bajo ese segundo lock. Mismo orden que
-- create_patient_document (patients -> patient_documents cuando versiona)
-- para que dos llamadas concurrentes entre ambas RPC nunca puedan
-- esperarse en sentidos opuestos — evita deadlock.
--
-- Paciente archivado: si el paciente fue archivado (o borrado, o es de
-- otro tenant) entre la creación del documento y el intento de adjuntar el
-- firmado, se rechaza con reason='patient_not_found' — mismo criterio que
-- el resto de las mutaciones clínicas (upsert_patient_record_with_audit /
-- create_patient_follow_up_with_audit) — sin tocar el documento ni auditar
-- nada.
--
-- Ownership (CORRECCIÓN 1): sólo professional_user_id = auth.uid() puede
-- adjuntar el firmado — no alcanza con pertenecer al mismo tenant.
--
-- Storage path (CORRECCIÓN 1): igual que create_patient_document, esta
-- función tiene EXECUTE para authenticated y puede invocarse sin pasar por
-- los route handlers, así que no se confía en p_signed_storage_path tal
-- cual. tenant_id/patient_id SIEMPRE salen de la fila ya autorizada bajo
-- lock (v_tenant_id, v_patient_id) — nunca del parámetro. El único formato
-- aceptado, validado con un regex anclado de punta a punta (^...$, sin
-- espacio para ningún "/" ni "../" adicional):
--   {tenant_id}/{patient_id}/{document_id}/signed/{uuid}.pdf
--
-- Transición única: sólo se puede pasar de pending_signature a
-- signed_uploaded_unverified. No existe ningún camino, en esta función ni
-- en ninguna otra, para volver a escribir signed_* sobre una fila que ya
-- está en signed_uploaded_unverified — "reemplazar un firmado" es siempre
-- crear una versión nueva vía create_patient_document, nunca un UPDATE
-- sobre esta fila.

CREATE OR REPLACE FUNCTION public.attach_signed_patient_document(
  p_document_id uuid,
  p_signed_storage_path text,
  p_signed_sha256 text,
  p_signed_bytes bigint
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_document_patient_id uuid;
  v_patient_id uuid;
  v_owner uuid;
  v_status text;
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

  -- Lectura SIN lock, sólo para saber qué fila de patients lockear primero
  -- (ver comentario de orden de locks arriba de la función).
  SELECT pd.patient_id INTO v_document_patient_id
  FROM public.patient_documents AS pd
  WHERE pd.id = p_document_id
    AND pd.tenant_id = v_tenant_id;

  IF v_document_patient_id IS NULL THEN
    RETURN QUERY SELECT false, 'document_not_found'::text;
    RETURN;
  END IF;

  -- Lock de patients ANTES que patient_documents — mismo orden que
  -- create_patient_document. Paciente archivado/borrado/de otro tenant =>
  -- mismo resultado que "no existe".
  SELECT p.id INTO v_patient_id
  FROM public.patients AS p
  WHERE p.id = v_document_patient_id
    AND p.tenant_id = v_tenant_id
    AND p.deleted_at IS NULL
  FOR UPDATE;

  IF v_patient_id IS NULL THEN
    RETURN QUERY SELECT false, 'patient_not_found'::text;
    RETURN;
  END IF;

  -- Lock del documento (después del paciente) y re-chequeo autoritativo de
  -- ownership/estado bajo ese lock.
  SELECT pd.professional_user_id, pd.status
    INTO v_owner, v_status
  FROM public.patient_documents AS pd
  WHERE pd.id = p_document_id
    AND pd.tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RETURN QUERY SELECT false, 'document_not_found'::text;
    RETURN;
  END IF;

  IF v_owner <> v_actor_user_id THEN
    RETURN QUERY SELECT false, 'not_document_owner'::text;
    RETURN;
  END IF;

  IF v_status <> 'pending_signature' THEN
    RETURN QUERY SELECT false, 'already_signed'::text;
    RETURN;
  END IF;

  IF p_signed_storage_path !~ (
    '^' || v_tenant_id::text || '/' || v_patient_id::text || '/' || p_document_id::text ||
    '/signed/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  ) THEN
    RETURN QUERY SELECT false, 'invalid_storage_path'::text;
    RETURN;
  END IF;

  UPDATE public.patient_documents
  SET status = 'signed_uploaded_unverified',
      signed_storage_path = p_signed_storage_path,
      signed_sha256 = p_signed_sha256,
      signed_bytes = p_signed_bytes,
      signed_uploaded_by = v_actor_user_id,
      signed_at = clock_timestamp()
  WHERE id = p_document_id;

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    v_tenant_id, v_actor_user_id, 'professional', p_document_id, v_patient_id,
    'signed_copy_uploaded', NULL
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.attach_signed_patient_document(uuid, text, text, bigint) IS
  'Adjunta la copia firmada (ya subida a Storage en un path único) a un documento pendiente y registra su auditoría en la MISMA transacción. Exige professional_user_id = auth.uid() (ownership estricto, no alcanza con el tenant), paciente no archivado (reason=patient_not_found) y status=pending_signature (reason=already_signed) — sin modificar nada en caso contrario. p_signed_storage_path se valida con un regex anclado contra {tenant_id}/{patient_id}/{document_id}/signed/{uuid}.pdf calculado desde la fila ya autorizada, nunca desde el parámetro (reason=invalid_storage_path si no matchea; necesario porque esta función tiene EXECUTE para authenticated y puede invocarse sin pasar por los route handlers). Lock order: patients antes que patient_documents, igual que create_patient_document, para no introducir deadlock entre ambas RPC. Transición única e irreversible: no existe ningún camino para volver a escribir signed_* sobre una fila ya en signed_uploaded_unverified. tenant_id/actor_user_id resueltos internamente. Ejecutable únicamente por authenticated.';

-- ----------------------------------------------------------------------------
-- 6) Grants/revokes explícitos de ambas RPC (CORRECCIÓN 2)
-- ----------------------------------------------------------------------------
--
-- REVOKE explícito de PUBLIC, anon y service_role (no sólo confiar en que
-- CREATE FUNCTION no dejó EXECUTE heredado) + GRANT explícito sólo a
-- authenticated — mismo criterio que confirm_public_appointment /
-- check_rate_limit / las 3 RPC de clinical_audit_log.

REVOKE ALL ON FUNCTION public.create_patient_document(uuid, uuid, text, text, text, text, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_patient_document(uuid, uuid, text, text, text, text, bigint, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.create_patient_document(uuid, uuid, text, text, text, text, bigint, uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.create_patient_document(uuid, uuid, text, text, text, text, bigint, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.attach_signed_patient_document(uuid, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_signed_patient_document(uuid, text, text, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.attach_signed_patient_document(uuid, text, text, bigint) FROM service_role;
GRANT EXECUTE ON FUNCTION public.attach_signed_patient_document(uuid, text, text, bigint) TO authenticated;

-- ============================================================================
-- DEPENDENCIA DE INFRAESTRUCTURA: BUCKET patient-documents
-- ============================================================================
--
-- Esta migración no crea el bucket ni ninguna policy sobre storage.objects.
-- No es porque SQL no sea una forma soportada de crearlo — la documentación
-- oficial actual de Supabase ("Creating Buckets") lista Dashboard, client
-- library y SQL (INSERT INTO storage.buckets) como tres formas igualmente
-- válidas —, sino porque el bucket se gestionó como una dependencia de
-- infraestructura aparte, creada y verificada ANTES de aplicar esta
-- migración, en vez de acoplarla al mismo archivo que crea las tablas/RPC.
--
-- Estado verificado del bucket patient-documents (ya aplicado):
--   - id / name: patient-documents
--   - public: false (privado)
--   - file_size_limit: 20971520 (20 MB en bytes)
--   - allowed_mime_types: {'application/pdf'}
--   - sin policies directas para anon/authenticated sobre storage.objects —
--     el acceso es exclusivamente vía el cliente service-role desde rutas
--     server-side (lib/supabase/service.ts), nunca vía el SDK de Storage en
--     el browser.
--
-- Verificación que se hizo (para referencia futura, no una acción pendiente):
--   1. El bucket figura como "Private" en el Dashboard (no "Public").
--   2. `select * from storage.buckets where id = 'patient-documents';`
--      muestra public = false, file_size_limit = 20971520,
--      allowed_mime_types = {'application/pdf'}.
--   3. `select * from pg_policies where schemaname = 'storage' and
--      tablename = 'objects' and qual ilike '%patient-documents%';` no
--      devuelve ninguna policy que otorgue acceso a `anon` ni a
--      `authenticated` sobre este bucket.
--   4. Un intento de `supabase.storage.from('patient-documents').list()`
--      con la publishable key (sin service role) devuelve un error de RLS —
--      confirma que el bucket no quedó accesible por accidente.
-- ============================================================================

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario. Ver el informe de arquitectura de la tarea para el detalle
-- completo del diseño.
-- ============================================================================
