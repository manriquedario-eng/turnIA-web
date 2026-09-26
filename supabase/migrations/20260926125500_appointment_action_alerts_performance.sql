-- Performance hardening for appointment action alerts.
-- Adds covering indexes for FK lookups and avoids per-row auth.uid() evaluation.

create index if not exists appointment_action_alerts_tenant_id_idx
  on public.appointment_action_alerts(tenant_id);

create index if not exists appointment_action_alerts_appointment_id_idx
  on public.appointment_action_alerts(appointment_id);

create index if not exists appointment_action_alerts_patient_id_idx
  on public.appointment_action_alerts(patient_id);

drop policy if exists appointment_action_alerts_select_own
  on public.appointment_action_alerts;

create policy appointment_action_alerts_select_own
  on public.appointment_action_alerts
  for select
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and professional_id = (select auth.uid())
  );
