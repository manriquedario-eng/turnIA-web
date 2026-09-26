create table if not exists public.appointment_action_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  action text not null check (action in ('confirm','cancel','reschedule')),
  dedupe_key text not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists appointment_action_alerts_professional_created_idx
  on public.appointment_action_alerts (professional_id, created_at desc);

alter table public.appointment_action_alerts enable row level security;

drop policy if exists appointment_action_alerts_select_own on public.appointment_action_alerts;
create policy appointment_action_alerts_select_own
  on public.appointment_action_alerts
  for select
  to authenticated
  using (
    is_tenant_member(tenant_id)
    and professional_id = auth.uid()
  );

grant select on table public.appointment_action_alerts to authenticated;
grant select, insert on table public.appointment_action_alerts to service_role;
