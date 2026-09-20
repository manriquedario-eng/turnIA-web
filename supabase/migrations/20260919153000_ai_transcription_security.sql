-- Ajustes de seguridad/performance posteriores a ai_transcription_credits.

REVOKE ALL ON FUNCTION public.create_ai_transcription_account_for_tenant() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_ai_transcription_account_for_tenant() FROM anon;
REVOKE ALL ON FUNCTION public.create_ai_transcription_account_for_tenant() FROM authenticated;

CREATE INDEX IF NOT EXISTS ai_transcription_ledger_professional_idx
  ON public.ai_transcription_ledger (professional_id);
