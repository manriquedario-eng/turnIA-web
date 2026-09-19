-- Asocia consumo de Transcripción IA a paciente para métricas.
-- Sólo metadata de uso; no guarda audio ni texto clínico.

ALTER TABLE public.ai_transcription_ledger
  ADD COLUMN IF NOT EXISTS patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ai_transcription_ledger_patient_idx
  ON public.ai_transcription_ledger (patient_id);

DROP FUNCTION IF EXISTS public.consume_ai_transcription_seconds(uuid, uuid, bigint, text);

CREATE FUNCTION public.consume_ai_transcription_seconds(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_seconds bigint,
  p_usage_context text DEFAULT 'other',
  p_patient_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $consume$
DECLARE
  affected integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_professional_id THEN
    RETURN false;
  END IF;

  IF NOT public.is_tenant_member(p_tenant_id)
     OR p_seconds <= 0
     OR p_seconds > 900
     OR p_usage_context NOT IN ('session', 'follow_up', 'other') THEN
    RETURN false;
  END IF;

  IF p_patient_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.patients p
    WHERE p.id = p_patient_id
      AND p.tenant_id = p_tenant_id
      AND p.deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.ai_transcription_accounts
  SET
    balance_seconds = balance_seconds - p_seconds,
    lifetime_used_seconds = lifetime_used_seconds + p_seconds,
    updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND enabled = true
    AND balance_seconds >= p_seconds;

  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_transcription_ledger (
    tenant_id, professional_id, kind, seconds, usage_context, patient_id
  ) VALUES (
    p_tenant_id, p_professional_id, 'usage', p_seconds, p_usage_context, p_patient_id
  );

  RETURN true;
END;
$consume$;

REVOKE ALL ON FUNCTION public.consume_ai_transcription_seconds(uuid, uuid, bigint, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_transcription_seconds(uuid, uuid, bigint, text, uuid) TO authenticated;
