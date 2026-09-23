-- Per-professional operational contact details for TurnIA notifications.
-- Additive only. Prepared on the WhatsApp branch; do not apply to production
-- until the WhatsApp release is explicitly approved.

create table if not exists public.professional_contacts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_e164 text,
  email text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, user_id),
  constraint professional_contacts_phone_check
    check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$')
);

comment on table public.professional_contacts is
  'Operational contact details per professional for appointment notifications.';

alter table public.professional_contacts enable row level security;

revoke all on table public.professional_contacts from anon;
grant select, insert, update on table public.professional_contacts to authenticated;

drop policy if exists professional_contacts_self_select on public.professional_contacts;
create policy professional_contacts_self_select
  on public.professional_contacts
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_tenant_member(tenant_id)
  );

drop policy if exists professional_contacts_self_insert on public.professional_contacts;
create policy professional_contacts_self_insert
  on public.professional_contacts
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_tenant_member(tenant_id)
  );

drop policy if exists professional_contacts_self_update on public.professional_contacts;
create policy professional_contacts_self_update
  on public.professional_contacts
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and public.is_tenant_member(tenant_id)
  )
  with check (
    user_id = auth.uid()
    and public.is_tenant_member(tenant_id)
  );

revoke delete on table public.professional_contacts from authenticated;

-- Safe legacy backfill: only when the tenant has exactly one member, so the
-- historical tenant-wide professional_phone/professional_email can be mapped
-- without guessing which professional owns it. Multi-professional tenants are
-- intentionally left untouched and must configure each professional explicitly.
with single_member_tenants as (
  select
    tm.tenant_id,
    min(tm.user_id::text)::uuid as user_id
  from public.tenant_members tm
  group by tm.tenant_id
  having count(*) = 1
),
legacy_contacts as (
  select
    s.tenant_id,
    smt.user_id,
    case
      when nullif(btrim(s.profile->>'professional_phone'), '') ~ '^\+[1-9][0-9]{7,14}
        then btrim(s.profile->>'professional_phone')
      else null
    end as phone_e164,
    nullif(btrim(s.profile->>'professional_email'), '') as email
  from public.settings s
  join single_member_tenants smt on smt.tenant_id = s.tenant_id
)
insert into public.professional_contacts (
  tenant_id,
  user_id,
  phone_e164,
  email
)
select
  tenant_id,
  user_id,
  phone_e164,
  email
from legacy_contacts
where phone_e164 is not null or email is not null
on conflict (tenant_id, user_id) do nothing;
