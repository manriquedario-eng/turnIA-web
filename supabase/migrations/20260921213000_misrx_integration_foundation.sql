-- MisRX integration foundation.
-- Additive only: no existing TurnIA table/column is removed or renamed.
-- This file defines the persistence layer but is NOT applied automatically by Vercel.

CREATE TABLE IF NOT EXISTS public.misrx_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL,
  password_ciphertext text NOT NULL,
  encryption_key_version integer NOT NULL DEFAULT 1,
  misrx_usuario_id bigint,
  misrx_propio_id bigint,
  misrx_sisa_id text,
  account_label text,
  status text NOT NULL DEFAULT 'not_connected',
  last_verified_at timestamptz,
  last_error text,
  connected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT misrx_connections_tenant_user_unique UNIQUE (tenant_id, user_id),
  CONSTRAINT misrx_connections_status_check
    CHECK (status IN ('not_connected', 'connected', 'error'))
);

ALTER TABLE public.misrx_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.misrx_connections FROM authenticated, anon;
GRANT ALL ON TABLE public.misrx_connections TO service_role;

CREATE INDEX IF NOT EXISTS misrx_connections_tenant_idx
  ON public.misrx_connections (tenant_id);

CREATE TABLE IF NOT EXISTS public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'misrx',
  provider_prescription_number text,
  provider_token text,
  provider_batch_token text,
  convention_id bigint,
  plan_id bigint,
  affiliate_id bigint,
  diagnosis text,
  cie10 text,
  observations text,
  long_term_treatment boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  provider_status text,
  provider_status_description text,
  prescribed_at timestamptz,
  issued_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prescriptions_provider_check CHECK (provider IN ('misrx')),
  CONSTRAINT prescriptions_status_check
    CHECK (status IN ('draft', 'sending', 'issued', 'rejected', 'cancelled', 'error'))
);

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prescriptions_member_select ON public.prescriptions;
CREATE POLICY prescriptions_member_select
  ON public.prescriptions
  FOR SELECT
  USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS prescriptions_member_insert ON public.prescriptions;
CREATE POLICY prescriptions_member_insert
  ON public.prescriptions
  FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id) AND professional_id = auth.uid());

DROP POLICY IF EXISTS prescriptions_member_update ON public.prescriptions;
CREATE POLICY prescriptions_member_update
  ON public.prescriptions
  FOR UPDATE
  USING (public.is_tenant_member(tenant_id) AND professional_id = auth.uid())
  WITH CHECK (public.is_tenant_member(tenant_id) AND professional_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON TABLE public.prescriptions TO authenticated;

CREATE INDEX IF NOT EXISTS prescriptions_tenant_patient_idx
  ON public.prescriptions (tenant_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prescriptions_provider_token_idx
  ON public.prescriptions (provider, provider_token)
  WHERE provider_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  provider_product_code text,
  provider_product_id text,
  brand text,
  generic_name text,
  presentation text,
  potency text,
  laboratory text,
  quantity numeric,
  coverage_percentage numeric,
  print_brand boolean,
  substitutable boolean,
  diagnosis text,
  cie10 text,
  cuir text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prescription_items_member_select ON public.prescription_items;
CREATE POLICY prescription_items_member_select
  ON public.prescription_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.prescriptions p
      WHERE p.id = prescription_id
        AND public.is_tenant_member(p.tenant_id)
    )
  );

GRANT SELECT ON TABLE public.prescription_items TO authenticated;
GRANT ALL ON TABLE public.prescription_items TO service_role;

CREATE INDEX IF NOT EXISTS prescription_items_prescription_idx
  ON public.prescription_items (prescription_id);

CREATE TABLE IF NOT EXISTS public.prescription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  provider_status text,
  provider_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.prescription_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prescription_events_member_select ON public.prescription_events;
CREATE POLICY prescription_events_member_select
  ON public.prescription_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.prescriptions p
      WHERE p.id = prescription_id
        AND public.is_tenant_member(p.tenant_id)
    )
  );

GRANT SELECT ON TABLE public.prescription_events TO authenticated;
GRANT ALL ON TABLE public.prescription_events TO service_role;

CREATE INDEX IF NOT EXISTS prescription_events_prescription_idx
  ON public.prescription_events (prescription_id, created_at DESC);

-- integration_status already exists and is used by Google / Mercado Pago.
-- Expand the provider allow-list only if it is enforced by a CHECK constraint.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.integration_status'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%provider%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.integration_status DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE public.integration_status
    ADD CONSTRAINT integration_status_provider_check
    CHECK (provider IN ('google_calendar', 'mercadopago', 'arca', 'misrx'));
END
$$;


-- Hardening / advisor follow-up ------------------------------------------------
DROP POLICY IF EXISTS prescriptions_member_insert ON public.prescriptions;
CREATE POLICY prescriptions_member_insert
  ON public.prescriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    AND professional_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS prescriptions_member_update ON public.prescriptions;
CREATE POLICY prescriptions_member_update
  ON public.prescriptions
  FOR UPDATE
  TO authenticated
  USING (
    public.is_tenant_member(tenant_id)
    AND professional_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_tenant_member(tenant_id)
    AND professional_id = (SELECT auth.uid())
  );

CREATE INDEX IF NOT EXISTS misrx_connections_user_idx
  ON public.misrx_connections (user_id);

CREATE INDEX IF NOT EXISTS prescriptions_professional_idx
  ON public.prescriptions (professional_id);

CREATE INDEX IF NOT EXISTS prescriptions_patient_idx
  ON public.prescriptions (patient_id);

CREATE INDEX IF NOT EXISTS prescriptions_appointment_idx
  ON public.prescriptions (appointment_id)
  WHERE appointment_id IS NOT NULL;
