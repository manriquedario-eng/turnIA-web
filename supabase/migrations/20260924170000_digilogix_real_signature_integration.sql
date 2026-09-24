-- Digilogix real integration for TurnIA patient documents.
-- Additive to the existing manual external-signature flow.
-- No Digilogix secrets are stored in Postgres; provider credentials remain server-side env vars.

CREATE TABLE IF NOT EXISTS public.digilogix_connections (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  cuil text NOT NULL,
  email text NULL,
  status text NOT NULL DEFAULT 'disconnected',
  last_certificate_check_at timestamptz NULL,
  connected_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT digilogix_connections_cuil_check CHECK (cuil ~ '^[0-9]{11}$'),
  CONSTRAINT digilogix_connections_status_check
    CHECK (status IN ('disconnected', 'onboarding_required', 'connected', 'error'))
);

ALTER TABLE public.digilogix_connections ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.digilogix_connections FROM PUBLIC;
REVOKE ALL ON TABLE public.digilogix_connections FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.digilogix_connections TO authenticated;

CREATE POLICY digilogix_connections_select_own
  ON public.digilogix_connections FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_tenant_member(tenant_id)
  );

CREATE POLICY digilogix_connections_insert_own
  ON public.digilogix_connections FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_tenant_member(tenant_id)
  );

CREATE POLICY digilogix_connections_update_own
  ON public.digilogix_connections FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_tenant_member(tenant_id)
  )
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_tenant_member(tenant_id)
  );

CREATE POLICY digilogix_connections_delete_own
  ON public.digilogix_connections FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND public.is_tenant_member(tenant_id)
  );

ALTER TABLE public.patient_documents
  ADD COLUMN IF NOT EXISTS signature_provider text NULL,
  ADD COLUMN IF NOT EXISTS provider_document_id text NULL,
  ADD COLUMN IF NOT EXISTS provider_state_code integer NULL,
  ADD COLUMN IF NOT EXISTS provider_state_description text NULL,
  ADD COLUMN IF NOT EXISTS provider_hash_verification text NULL,
  ADD COLUMN IF NOT EXISTS provider_signed_at timestamptz NULL;

ALTER TABLE public.patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_status_check;

ALTER TABLE public.patient_documents
  ADD CONSTRAINT patient_documents_status_check
  CHECK (status IN (
    'pending_signature',
    'provider_signature_pending',
    'provider_signature_rejected',
    'signed_uploaded_unverified',
    'signed_provider_confirmed'
  ));

ALTER TABLE public.patient_documents
  DROP CONSTRAINT IF EXISTS patient_documents_status_signed_fields_check;

ALTER TABLE public.patient_documents
  ADD CONSTRAINT patient_documents_status_signed_fields_check
  CHECK (
    (
      status IN ('pending_signature', 'provider_signature_pending', 'provider_signature_rejected')
      AND signed_storage_path IS NULL
      AND signed_sha256 IS NULL
      AND signed_bytes IS NULL
      AND signed_uploaded_by IS NULL
      AND signed_at IS NULL
    )
    OR
    (
      status IN ('signed_uploaded_unverified', 'signed_provider_confirmed')
      AND signed_storage_path IS NOT NULL
      AND signed_sha256 IS NOT NULL
      AND signed_bytes IS NOT NULL
      AND signed_uploaded_by IS NOT NULL
      AND signed_at IS NOT NULL
    )
  );

ALTER TABLE public.patient_documents
  ADD CONSTRAINT patient_documents_signature_provider_check
  CHECK (signature_provider IS NULL OR signature_provider IN ('digilogix'));

ALTER TABLE public.patient_documents
  ADD CONSTRAINT patient_documents_provider_hash_verification_check
  CHECK (
    provider_hash_verification IS NULL
    OR provider_hash_verification IN ('verified', 'unavailable', 'failed')
  );

ALTER TABLE public.patient_document_audit_log
  DROP CONSTRAINT IF EXISTS patient_document_audit_log_event_check;

ALTER TABLE public.patient_document_audit_log
  ADD CONSTRAINT patient_document_audit_log_event_check
  CHECK (event IN (
    'document_created',
    'signed_copy_uploaded',
    'document_superseded',
    'provider_signature_requested',
    'provider_signature_rejected',
    'provider_signature_completed'
  ));

CREATE OR REPLACE FUNCTION public.start_provider_patient_document_signature(
  p_document_id uuid,
  p_provider text,
  p_provider_document_id text
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_patient_id uuid;
  v_owner uuid;
  v_status text;
BEGIN
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = v_actor_user_id
  LIMIT 1;

  SELECT pd.patient_id, pd.professional_user_id, pd.status
    INTO v_patient_id, v_owner, v_status
  FROM public.patient_documents pd
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

  IF v_status NOT IN ('pending_signature', 'provider_signature_rejected') THEN
    RETURN QUERY SELECT false, 'document_not_available_for_provider_signature'::text;
    RETURN;
  END IF;

  IF p_provider <> 'digilogix' OR coalesce(trim(p_provider_document_id), '') = '' THEN
    RETURN QUERY SELECT false, 'invalid_provider_data'::text;
    RETURN;
  END IF;

  UPDATE public.patient_documents
  SET status = 'provider_signature_pending',
      signature_provider = p_provider,
      provider_document_id = trim(p_provider_document_id),
      provider_state_code = NULL,
      provider_state_description = NULL,
      provider_hash_verification = NULL,
      provider_signed_at = NULL
  WHERE id = p_document_id;

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    v_tenant_id, v_actor_user_id, 'professional', p_document_id, v_patient_id,
    'provider_signature_requested', jsonb_build_object('provider', p_provider)
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_provider_patient_document_rejected(
  p_document_id uuid,
  p_provider_state_code integer,
  p_provider_state_description text
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_patient_id uuid;
  v_owner uuid;
  v_status text;
BEGIN
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = v_actor_user_id
  LIMIT 1;

  SELECT pd.patient_id, pd.professional_user_id, pd.status
    INTO v_patient_id, v_owner, v_status
  FROM public.patient_documents pd
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
  IF v_status <> 'provider_signature_pending' THEN
    RETURN QUERY SELECT false, 'document_not_pending_provider_signature'::text;
    RETURN;
  END IF;

  UPDATE public.patient_documents
  SET status = 'provider_signature_rejected',
      provider_state_code = p_provider_state_code,
      provider_state_description = left(coalesce(p_provider_state_description, ''), 240)
  WHERE id = p_document_id;

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    v_tenant_id, v_actor_user_id, 'professional', p_document_id, v_patient_id,
    'provider_signature_rejected', jsonb_build_object('provider', 'digilogix')
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_provider_patient_document_signature(
  p_document_id uuid,
  p_signed_storage_path text,
  p_signed_sha256 text,
  p_signed_bytes bigint,
  p_provider_state_code integer,
  p_provider_state_description text,
  p_provider_hash_verification text
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor_user_id uuid;
  v_tenant_id uuid;
  v_patient_id uuid;
  v_owner uuid;
  v_status text;
BEGIN
  v_actor_user_id := auth.uid();
  IF v_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT tm.tenant_id INTO v_tenant_id
  FROM public.tenant_members tm
  WHERE tm.user_id = v_actor_user_id
  LIMIT 1;

  SELECT pd.patient_id, pd.professional_user_id, pd.status
    INTO v_patient_id, v_owner, v_status
  FROM public.patient_documents pd
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
  IF v_status <> 'provider_signature_pending' THEN
    RETURN QUERY SELECT false, 'document_not_pending_provider_signature'::text;
    RETURN;
  END IF;
  IF p_provider_hash_verification NOT IN ('verified', 'unavailable', 'failed') THEN
    RETURN QUERY SELECT false, 'invalid_provider_data'::text;
    RETURN;
  END IF;
  IF p_signed_sha256 !~ '^[0-9a-f]{64}$' OR p_signed_bytes <= 0 THEN
    RETURN QUERY SELECT false, 'invalid_provider_data'::text;
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
  SET status = 'signed_provider_confirmed',
      signed_storage_path = p_signed_storage_path,
      signed_sha256 = p_signed_sha256,
      signed_bytes = p_signed_bytes,
      signed_uploaded_by = v_actor_user_id,
      signed_at = clock_timestamp(),
      provider_state_code = p_provider_state_code,
      provider_state_description = left(coalesce(p_provider_state_description, ''), 240),
      provider_hash_verification = p_provider_hash_verification,
      provider_signed_at = clock_timestamp()
  WHERE id = p_document_id;

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    v_tenant_id, v_actor_user_id, 'professional', p_document_id, v_patient_id,
    'provider_signature_completed',
    jsonb_build_object(
      'provider', 'digilogix',
      'hash_verification', p_provider_hash_verification
    )
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.start_provider_patient_document_signature(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_provider_patient_document_signature(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_provider_patient_document_rejected(uuid, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_provider_patient_document_rejected(uuid, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_provider_patient_document_signature(uuid, text, text, bigint, integer, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.complete_provider_patient_document_signature(uuid, text, text, bigint, integer, text, text) TO authenticated;
