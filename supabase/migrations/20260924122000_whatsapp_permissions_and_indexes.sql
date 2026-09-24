-- WhatsApp staging validation follow-up:
-- explicit backend grants, covering indexes, and RLS init-plan optimization.

-- Backend-only WhatsApp webhook ledger. No anon/authenticated access.
grant select, insert, update on table public.whatsapp_inbound_events to service_role;

-- Backend notification routing needs to read per-professional contacts.
grant select on table public.professional_contacts to service_role;

-- Cover foreign keys used by cleanup and tenant/patient scoped lookups.
create index if not exists whatsapp_inbound_events_tenant_idx
  on public.whatsapp_inbound_events (tenant_id);

create index if not exists whatsapp_inbound_events_patient_idx
  on public.whatsapp_inbound_events (patient_id);

create index if not exists professional_contacts_user_idx
  on public.professional_contacts (user_id);

-- Avoid per-row auth.uid() re-evaluation in RLS policies.
drop policy if exists professional_contacts_self_select on public.professional_contacts;
create policy professional_contacts_self_select
  on public.professional_contacts
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_tenant_member(tenant_id)
  );

drop policy if exists professional_contacts_self_insert on public.professional_contacts;
create policy professional_contacts_self_insert
  on public.professional_contacts
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_tenant_member(tenant_id)
  );

drop policy if exists professional_contacts_self_update on public.professional_contacts;
create policy professional_contacts_self_update
  on public.professional_contacts
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    and public.is_tenant_member(tenant_id)
  )
  with check (
    user_id = (select auth.uid())
    and public.is_tenant_member(tenant_id)
  );
