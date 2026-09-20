-- Permisos mínimos para el módulo de Transcripción IA.
-- RLS sigue siendo la capa que restringe cada fila al tenant del usuario.

GRANT SELECT, UPDATE ON TABLE public.ai_transcription_accounts TO authenticated;
GRANT SELECT ON TABLE public.ai_transcription_ledger TO authenticated;

REVOKE ALL ON TABLE public.ai_transcription_accounts FROM anon;
REVOKE ALL ON TABLE public.ai_transcription_ledger FROM anon;
