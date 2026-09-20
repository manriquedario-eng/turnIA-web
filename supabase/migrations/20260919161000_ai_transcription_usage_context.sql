-- Contexto mínimo de consumo para métricas de Transcripción IA.
-- No almacena texto clínico, paciente ni audio.
ALTER TABLE public.ai_transcription_ledger
  ADD COLUMN IF NOT EXISTS usage_context text;

ALTER TABLE public.ai_transcription_ledger
  DROP CONSTRAINT IF EXISTS ai_transcription_ledger_usage_context_check;

ALTER TABLE public.ai_transcription_ledger
  ADD CONSTRAINT ai_transcription_ledger_usage_context_check
  CHECK (usage_context IS NULL OR usage_context IN ('session', 'follow_up', 'other'));

CREATE OR REPLACE FUNCTION public.consume_ai_transcription_seconds(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_seconds bigint,
  p_usage_context text DEFAULT 'other'
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
    tenant_id, professional_id, kind, seconds, usage_context
  ) VALUES (
    p_tenant_id, p_professional_id, 'usage', p_seconds, p_usage_context
  );

  RETURN true;
END;
$consume$;

REVOKE ALL ON FUNCTION public.consume_ai_transcription_seconds(uuid, uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_transcription_seconds(uuid, uuid, bigint, text) TO authenticated;
