-- Harden Digilogix provider state transitions.
-- Browser-authenticated users may read their own connection, but all writes and
-- provider-signature state transitions are server-only through service_role.

REVOKE INSERT, UPDATE, DELETE ON TABLE public.digilogix_connections FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.digilogix_connections TO service_role;

DROP POLICY IF EXISTS digilogix_connections_insert_own ON public.digilogix_connections;
DROP POLICY IF EXISTS digilogix_connections_update_own ON public.digilogix_connections;
DROP POLICY IF EXISTS digilogix_connections_delete_own ON public.digilogix_connections;

REVOKE EXECUTE ON FUNCTION public.start_provider_patient_document_signature(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_provider_patient_document_rejected(uuid, integer, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_provider_patient_document_signature(uuid, text, text, bigint, integer, text, text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.start_provider_patient_document_signature_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
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
  v_patient_id uuid;
  v_owner uuid;
  v_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_actor_user_id
  ) THEN
    RETURN QUERY SELECT false, 'not_tenant_member'::text;
    RETURN;
  END IF;

  SELECT pd.patient_id, pd.professional_user_id, pd.status
    INTO v_patient_id, v_owner, v_status
  FROM public.patient_documents pd
  WHERE pd.id = p_document_id AND pd.tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RETURN QUERY SELECT false, 'document_not_found'::text;
    RETURN;
  END IF;
  IF v_owner <> p_actor_user_id THEN
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
  WHERE id = p_document_id AND tenant_id = p_tenant_id;

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    p_tenant_id, p_actor_user_id, 'professional', p_document_id, v_patient_id,
    'provider_signature_requested', jsonb_build_object('provider', p_provider)
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_provider_patient_document_rejected_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
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
  v_patient_id uuid;
  v_owner uuid;
  v_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_actor_user_id
  ) THEN
    RETURN QUERY SELECT false, 'not_tenant_member'::text;
    RETURN;
  END IF;

  SELECT pd.patient_id, pd.professional_user_id, pd.status
    INTO v_patient_id, v_owner, v_status
  FROM public.patient_documents pd
  WHERE pd.id = p_document_id AND pd.tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RETURN QUERY SELECT false, 'document_not_found'::text;
    RETURN;
  END IF;
  IF v_owner <> p_actor_user_id THEN
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
  WHERE id = p_document_id AND tenant_id = p_tenant_id;

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    p_tenant_id, p_actor_user_id, 'professional', p_document_id, v_patient_id,
    'provider_signature_rejected', jsonb_build_object('provider', 'digilogix')
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_provider_patient_document_signature_server(
  p_tenant_id uuid,
  p_actor_user_id uuid,
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
  v_patient_id uuid;
  v_owner uuid;
  v_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_members tm
    WHERE tm.tenant_id = p_tenant_id AND tm.user_id = p_actor_user_id
  ) THEN
    RETURN QUERY SELECT false, 'not_tenant_member'::text;
    RETURN;
  END IF;

  SELECT pd.patient_id, pd.professional_user_id, pd.status
    INTO v_patient_id, v_owner, v_status
  FROM public.patient_documents pd
  WHERE pd.id = p_document_id AND pd.tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_owner IS NULL THEN
    RETURN QUERY SELECT false, 'document_not_found'::text;
    RETURN;
  END IF;
  IF v_owner <> p_actor_user_id THEN
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
    '^' || p_tenant_id::text || '/' || v_patient_id::text || '/' || p_document_id::text ||
    '/signed/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$'
  ) THEN
    RETURN QUERY SELECT false, 'invalid_storage_path'::text;
    RETURN;
  END IF;

  UPDATE public.patient_documents
  SET status = 'signed_provider_confirmed',
      signed_storage_path = p_signed_storage_path,
      signed_sha256 = p_signed_sha256,
      signed_bytes = p_signed_bytes,
      signed_uploaded_by = p_actor_user_id,
      signed_at = clock_timestamp(),
      provider_state_code = p_provider_state_code,
      provider_state_description = left(coalesce(p_provider_state_description, ''), 240),
      provider_hash_verification = p_provider_hash_verification,
      provider_signed_at = clock_timestamp()
  WHERE id = p_document_id AND tenant_id = p_tenant_id;

  INSERT INTO public.patient_document_audit_log (
    tenant_id, actor_user_id, actor_kind, document_id, patient_id, event, detail
  ) VALUES (
    p_tenant_id, p_actor_user_id, 'professional', p_document_id, v_patient_id,
    'provider_signature_completed',
    jsonb_build_object(
      'provider', 'digilogix',
      'hash_verification', p_provider_hash_verification
    )
  );

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.start_provider_patient_document_signature_server(uuid, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_provider_patient_document_signature_server(uuid, uuid, uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_provider_patient_document_rejected_server(uuid, uuid, uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_provider_patient_document_rejected_server(uuid, uuid, uuid, integer, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.complete_provider_patient_document_signature_server(uuid, uuid, uuid, text, text, bigint, integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_provider_patient_document_signature_server(uuid, uuid, uuid, text, text, bigint, integer, text, text)
  TO service_role;
