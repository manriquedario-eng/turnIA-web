-- ============================================================================
-- TurnIA · Transcripción IA opcional y prepaga
-- PROPUESTA DE MIGRACIÓN — requiere aplicación explícita en Supabase.
--
-- Objetivo:
--   - habilitación por tenant;
--   - saldo en segundos;
--   - ledger de consumo/créditos;
--   - descuento atómico únicamente después de una transcripción exitosa.
--
-- No guarda audio ni texto clínico. El ledger conserva sólo metadatos de
-- consumo (segundos y tipo de movimiento).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ai_transcription_accounts (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  balance_seconds bigint NOT NULL DEFAULT 0 CHECK (balance_seconds >= 0),
  lifetime_used_seconds bigint NOT NULL DEFAULT 0 CHECK (lifetime_used_seconds >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_transcription_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  professional_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('credit', 'usage', 'adjustment')),
  seconds bigint NOT NULL CHECK (seconds > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_transcription_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_transcription_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_transcription_accounts_tenant_select ON public.ai_transcription_accounts;
CREATE POLICY ai_transcription_accounts_tenant_select
  ON public.ai_transcription_accounts
  FOR SELECT
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS ai_transcription_accounts_tenant_update ON public.ai_transcription_accounts;
CREATE POLICY ai_transcription_accounts_tenant_update
  ON public.ai_transcription_accounts
  FOR UPDATE
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS ai_transcription_ledger_tenant_select ON public.ai_transcription_ledger;
CREATE POLICY ai_transcription_ledger_tenant_select
  ON public.ai_transcription_ledger
  FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE INDEX IF NOT EXISTS ai_transcription_ledger_tenant_created_idx
  ON public.ai_transcription_ledger (tenant_id, created_at DESC);

-- Descuento atómico. Sólo se puede consumir si el módulo está activo y
-- existe saldo suficiente. SECURITY DEFINER evita depender de INSERT directo
-- del usuario sobre el ledger, pero valida pertenencia al tenant.
CREATE OR REPLACE FUNCTION public.consume_ai_transcription_seconds(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_seconds bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_professional_id THEN
    RETURN false;
  END IF;

  IF NOT public.is_tenant_member(p_tenant_id) OR p_seconds <= 0 OR p_seconds > 900 THEN
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
    tenant_id, professional_id, kind, seconds
  ) VALUES (
    p_tenant_id, p_professional_id, 'usage', p_seconds
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_transcription_seconds(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_transcription_seconds(uuid, uuid, bigint) TO authenticated;

COMMENT ON TABLE public.ai_transcription_accounts IS
  'Saldo y estado del módulo opcional de Transcripción IA por tenant. No almacena audio ni contenido clínico.';
COMMENT ON TABLE public.ai_transcription_ledger IS
  'Ledger de créditos/consumos de Transcripción IA. Sólo metadatos de segundos; nunca audio ni texto clínico.';
