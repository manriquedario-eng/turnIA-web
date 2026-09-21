-- Reimbursement foundation: tenant-isolated reimbursement packets linked to appointments.
-- Payer-specific rules are intentionally not hard-coded here; they will be
-- versioned separately once verified.

create table public.reimbursement_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  invoice_id uuid null references public.billing_invoices(id) on delete set null,
  coverage_name text not null check (length(trim(coverage_name)) between 1 and 160),
  coverage_plan text null check (coverage_plan is null or length(coverage_plan) <= 160),
  member_number text null check (member_number is null or length(member_number) <= 120),
  service_type text not null default 'psychotherapy_individual' check (length(service_type) <= 120),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft'
    check (status in ('draft','ready','submitted','approved','observed','rejected','closed')),
  requirements_snapshot jsonb not null default '[]'::jsonb,
  notes text null check (notes is null or length(notes) <= 5000),
  submitted_at timestamptz null,
  resolved_at timestamptz null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint reimbursement_cases_period_check check (period_end >= period_start),
  constraint reimbursement_cases_id_tenant_unique unique (id, tenant_id)
);

create unique index if not exists appointments_id_tenant_unique
  on public.appointments (id, tenant_id);

create table public.reimbursement_case_appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reimbursement_case_id uuid not null,
  appointment_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint reimbursement_case_appointments_case_fk
    foreign key (reimbursement_case_id, tenant_id)
    references public.reimbursement_cases(id, tenant_id)
    on delete cascade,
  constraint reimbursement_case_appointments_appointment_fk
    foreign key (appointment_id, tenant_id)
    references public.appointments(id, tenant_id)
    on delete cascade,
  constraint reimbursement_case_appointments_unique
    unique (reimbursement_case_id, appointment_id)
);

create index reimbursement_cases_tenant_patient_idx
  on public.reimbursement_cases (tenant_id, patient_id, period_start desc);
create index reimbursement_cases_tenant_status_idx
  on public.reimbursement_cases (tenant_id, status, created_at desc);
create index reimbursement_case_appointments_appointment_idx
  on public.reimbursement_case_appointments (appointment_id);

alter table public.reimbursement_cases enable row level security;
alter table public.reimbursement_case_appointments enable row level security;

create policy reimbursement_cases_select_own
on public.reimbursement_cases for select to authenticated
using ((select auth.uid()) = professional_id and public.is_tenant_member(tenant_id));

create policy reimbursement_cases_insert_own
on public.reimbursement_cases for insert to authenticated
with check (
  (select auth.uid()) = professional_id
  and public.is_tenant_member(tenant_id)
  and exists (
    select 1 from public.patients p
    where p.id = patient_id
      and p.tenant_id = reimbursement_cases.tenant_id
      and p.deleted_at is null
  )
);

create policy reimbursement_cases_update_own
on public.reimbursement_cases for update to authenticated
using ((select auth.uid()) = professional_id and public.is_tenant_member(tenant_id))
with check (
  (select auth.uid()) = professional_id
  and public.is_tenant_member(tenant_id)
  and exists (
    select 1 from public.patients p
    where p.id = patient_id
      and p.tenant_id = reimbursement_cases.tenant_id
      and p.deleted_at is null
  )
);

create policy reimbursement_cases_delete_own
on public.reimbursement_cases for delete to authenticated
using ((select auth.uid()) = professional_id and public.is_tenant_member(tenant_id));

create policy reimbursement_case_appointments_select_own
on public.reimbursement_case_appointments for select to authenticated
using (public.is_tenant_member(tenant_id));

create policy reimbursement_case_appointments_insert_own
on public.reimbursement_case_appointments for insert to authenticated
with check (
  public.is_tenant_member(tenant_id)
  and exists (
    select 1 from public.reimbursement_cases rc
    where rc.id = reimbursement_case_id
      and rc.tenant_id = reimbursement_case_appointments.tenant_id
      and rc.professional_id = (select auth.uid())
  )
);

create policy reimbursement_case_appointments_delete_own
on public.reimbursement_case_appointments for delete to authenticated
using (
  public.is_tenant_member(tenant_id)
  and exists (
    select 1 from public.reimbursement_cases rc
    where rc.id = reimbursement_case_id
      and rc.tenant_id = reimbursement_case_appointments.tenant_id
      and rc.professional_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.reimbursement_cases to authenticated;
grant select, insert, delete on public.reimbursement_case_appointments to authenticated;
