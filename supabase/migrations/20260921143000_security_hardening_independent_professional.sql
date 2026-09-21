-- TurnIA security hardening for the independent-professional edition.
-- Each authenticated professional owns exactly one tenant in this edition.

-- 1) Split test-only extra memberships into their own tenants, preserving the
-- member with real activity in the existing tenant. The current dataset was
-- inspected before this migration: the memberships being split have no
-- professional-owned activity.
create temporary table _turnia_members_to_split on commit drop as
with scored as (
  select
    tm.tenant_id,
    tm.user_id,
    tm.role,
    (
      (select count(*) from public.appointments a where a.tenant_id = tm.tenant_id and a.professional_id = tm.user_id) +
      (select count(*) from public.patient_follow_ups f where f.tenant_id = tm.tenant_id and f.professional_id = tm.user_id) +
      (select count(*) from public.patient_documents d where d.tenant_id = tm.tenant_id and d.professional_user_id = tm.user_id) +
      (select count(*) from public.patient_voice_notes v where v.tenant_id = tm.tenant_id and v.professional_id = tm.user_id) +
      (select count(*) from public.professional_reminders r where r.tenant_id = tm.tenant_id and r.professional_id = tm.user_id) +
      (select count(*) from public.google_oauth_connections g where g.tenant_id = tm.tenant_id and g.user_id = tm.user_id) +
      (select count(*) from public.mercadopago_connections m where m.tenant_id = tm.tenant_id and m.user_id = tm.user_id) +
      (select count(*) from public.arca_connections ar where ar.tenant_id = tm.tenant_id and ar.user_id = tm.user_id)
    )::bigint as activity_score
  from public.tenant_members tm
),
ranked as (
  select
    s.*,
    row_number() over (
      partition by s.tenant_id
      order by s.activity_score desc, (s.role = 'owner') desc, s.user_id
    ) as rn
  from scored s
)
select
  r.tenant_id as old_tenant_id,
  r.user_id,
  gen_random_uuid() as new_tenant_id
from ranked r
where r.rn > 1;

insert into public.tenants (id, name, timezone)
select
  s.new_tenant_id,
  'Profesional independiente',
  t.timezone
from _turnia_members_to_split s
join public.tenants t on t.id = s.old_tenant_id;

update public.tenant_members tm
set tenant_id = s.new_tenant_id,
    role = 'owner'
from _turnia_members_to_split s
where tm.tenant_id = s.old_tenant_id
  and tm.user_id = s.user_id;

-- Defensive ownership migration. These updates are no-ops for the currently
-- split test users, but keep the migration safe if a small user-owned row was
-- created between the audit and migration execution.
update public.appointments x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;
update public.patient_follow_ups x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;
update public.patient_documents x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_user_id = s.user_id;
update public.patient_voice_notes x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;
update public.availability_blocks x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;
update public.professional_reminders x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;
update public.google_oauth_connections x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.user_id = s.user_id;
update public.mercadopago_connections x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.user_id = s.user_id;
update public.arca_connections x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.user_id = s.user_id;
update public.arca_auth_tickets x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.user_id = s.user_id;
update public.integration_status x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.user_id = s.user_id;
update public.mercadopago_orders x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;
update public.billing_invoices x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;
update public.ai_transcription_ledger x set tenant_id = s.new_tenant_id
from _turnia_members_to_split s
where x.tenant_id = s.old_tenant_id and x.professional_id = s.user_id;

alter table public.tenant_members
  add constraint tenant_members_one_user_per_tenant unique (tenant_id),
  add constraint tenant_members_one_tenant_per_user unique (user_id);

-- 2) Harden the membership helper.
create or replace function public.is_tenant_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = target_tenant
      and tm.user_id = auth.uid()
  );
$$;

-- 3) Explicit clinical text limits. These are intentionally generous so
-- normal clinical notes are unaffected while pathological payloads are bounded.
alter table public.patient_records
  add constraint patient_records_reason_length check (reason is null or length(reason) <= 20000),
  add constraint patient_records_follow_up_length check (follow_up is null or length(follow_up) <= 20000),
  add constraint patient_records_background_length check (background is null or length(background) <= 20000),
  add constraint patient_records_notes_length check (notes is null or length(notes) <= 20000),
  add constraint patient_records_plan_length check (plan is null or length(plan) <= 20000),
  add constraint patient_records_diagnosis_length check (diagnosis is null or length(diagnosis) <= 20000);

alter table public.patient_follow_ups
  add constraint patient_follow_ups_content_length check (length(content) <= 20000);

-- 4) Atomic transcription reservations. Direct table access is forbidden;
-- authenticated callers can only use the audited RPCs below.
create table public.ai_transcription_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid null references public.patients(id) on delete set null,
  usage_context text not null check (usage_context in ('session','follow_up','other')),
  reserved_seconds bigint not null check (reserved_seconds between 1 and 900),
  actual_seconds bigint null check (actual_seconds between 1 and 900),
  status text not null default 'reserved' check (status in ('reserved','settled','refunded')),
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz null
);

alter table public.ai_transcription_reservations enable row level security;
revoke all on table public.ai_transcription_reservations from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_transcription_reservations to service_role;

create index ai_transcription_reservations_tenant_professional_idx
  on public.ai_transcription_reservations (tenant_id, professional_id, created_at desc);

create or replace function public.reserve_ai_transcription_seconds(
  p_tenant_id uuid,
  p_professional_id uuid,
  p_seconds bigint,
  p_usage_context text default 'other',
  p_patient_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation_id uuid := gen_random_uuid();
  v_affected integer;
begin
  if auth.uid() is null or auth.uid() <> p_professional_id then
    return null;
  end if;

  if not public.is_tenant_member(p_tenant_id)
     or p_seconds <= 0
     or p_seconds > 900
     or p_usage_context not in ('session','follow_up','other') then
    return null;
  end if;

  if p_patient_id is not null and not exists (
    select 1
    from public.patients p
    where p.id = p_patient_id
      and p.tenant_id = p_tenant_id
      and p.deleted_at is null
  ) then
    return null;
  end if;

  update public.ai_transcription_accounts
  set balance_seconds = balance_seconds - p_seconds,
      updated_at = clock_timestamp()
  where tenant_id = p_tenant_id
    and enabled = true
    and balance_seconds >= p_seconds;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    return null;
  end if;

  insert into public.ai_transcription_reservations (
    id, tenant_id, professional_id, patient_id, usage_context, reserved_seconds
  ) values (
    v_reservation_id, p_tenant_id, p_professional_id, p_patient_id, p_usage_context, p_seconds
  );

  return v_reservation_id;
end;
$$;

create or replace function public.refund_ai_transcription_reservation(
  p_reservation_id uuid,
  p_tenant_id uuid,
  p_professional_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ai_transcription_reservations%rowtype;
begin
  if auth.uid() is null or auth.uid() <> p_professional_id
     or not public.is_tenant_member(p_tenant_id) then
    return false;
  end if;

  select *
  into v_row
  from public.ai_transcription_reservations r
  where r.id = p_reservation_id
    and r.tenant_id = p_tenant_id
    and r.professional_id = p_professional_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.status = 'refunded' then
    return true;
  end if;

  if v_row.status <> 'reserved' then
    return false;
  end if;

  update public.ai_transcription_accounts
  set balance_seconds = balance_seconds + v_row.reserved_seconds,
      updated_at = clock_timestamp()
  where tenant_id = p_tenant_id;

  update public.ai_transcription_reservations
  set status = 'refunded',
      settled_at = clock_timestamp()
  where id = p_reservation_id;

  return true;
end;
$$;

create or replace function public.settle_ai_transcription_reservation(
  p_reservation_id uuid,
  p_tenant_id uuid,
  p_professional_id uuid,
  p_actual_seconds bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ai_transcription_reservations%rowtype;
  v_delta bigint;
  v_affected integer;
begin
  if auth.uid() is null or auth.uid() <> p_professional_id
     or not public.is_tenant_member(p_tenant_id)
     or p_actual_seconds <= 0
     or p_actual_seconds > 900 then
    return false;
  end if;

  select *
  into v_row
  from public.ai_transcription_reservations r
  where r.id = p_reservation_id
    and r.tenant_id = p_tenant_id
    and r.professional_id = p_professional_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.status = 'settled' then
    return v_row.actual_seconds = p_actual_seconds;
  end if;

  if v_row.status <> 'reserved' then
    return false;
  end if;

  v_delta := p_actual_seconds - v_row.reserved_seconds;

  if v_delta > 0 then
    update public.ai_transcription_accounts
    set balance_seconds = balance_seconds - v_delta,
        lifetime_used_seconds = lifetime_used_seconds + p_actual_seconds,
        updated_at = clock_timestamp()
    where tenant_id = p_tenant_id
      and enabled = true
      and balance_seconds >= v_delta;
  else
    update public.ai_transcription_accounts
    set balance_seconds = balance_seconds + abs(v_delta),
        lifetime_used_seconds = lifetime_used_seconds + p_actual_seconds,
        updated_at = clock_timestamp()
    where tenant_id = p_tenant_id
      and enabled = true;
  end if;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    return false;
  end if;

  insert into public.ai_transcription_ledger (
    tenant_id, professional_id, kind, seconds, usage_context, patient_id
  ) values (
    p_tenant_id,
    p_professional_id,
    'usage',
    p_actual_seconds,
    v_row.usage_context,
    v_row.patient_id
  );

  update public.ai_transcription_reservations
  set status = 'settled',
      actual_seconds = p_actual_seconds,
      settled_at = clock_timestamp()
  where id = p_reservation_id;

  return true;
end;
$$;

revoke all on function public.reserve_ai_transcription_seconds(uuid,uuid,bigint,text,uuid) from public, anon;
revoke all on function public.refund_ai_transcription_reservation(uuid,uuid,uuid) from public, anon;
revoke all on function public.settle_ai_transcription_reservation(uuid,uuid,uuid,bigint) from public, anon;
grant execute on function public.reserve_ai_transcription_seconds(uuid,uuid,bigint,text,uuid) to authenticated, service_role;
grant execute on function public.refund_ai_transcription_reservation(uuid,uuid,uuid) to authenticated, service_role;
grant execute on function public.settle_ai_transcription_reservation(uuid,uuid,uuid,bigint) to authenticated, service_role;
