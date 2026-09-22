-- MisRX integration hardening / advisor follow-up.

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
