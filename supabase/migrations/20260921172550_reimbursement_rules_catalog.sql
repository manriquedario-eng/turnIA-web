-- Global, versioned reimbursement requirements catalog.
-- Professionals can only read verified rules. Curation is service-role only.

create table public.reimbursement_rule_sets (
  id uuid primary key default gen_random_uuid(),
  coverage_name text not null check (length(trim(coverage_name)) between 1 and 160),
  coverage_aliases text[] not null default '{}',
  jurisdiction text not null default 'AR',
  plan_pattern text null check (plan_pattern is null or length(plan_pattern) <= 160),
  service_type text not null default 'psychotherapy_individual' check (length(service_type) <= 120),
  flow_type text not null default 'patient_reimbursement'
    check (flow_type in ('patient_reimbursement','direct_provider')),
  valid_from date not null,
  valid_to date null,
  status text not null default 'draft'
    check (status in ('draft','verified','retired')),
  requirements jsonb not null default '[]'::jsonb,
  source_url text null,
  source_title text null,
  verified_at timestamptz null,
  notes text null check (notes is null or length(notes) <= 5000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint reimbursement_rule_sets_validity_check
    check (valid_to is null or valid_to >= valid_from)
);

create index reimbursement_rule_sets_lookup_idx
  on public.reimbursement_rule_sets
  (lower(coverage_name), service_type, flow_type, valid_from desc);

create index reimbursement_rule_sets_status_idx
  on public.reimbursement_rule_sets (status, valid_from desc);

alter table public.reimbursement_rule_sets enable row level security;

create policy reimbursement_rule_sets_verified_read
on public.reimbursement_rule_sets
for select
to authenticated
using (status = 'verified');

revoke insert, update, delete on public.reimbursement_rule_sets from authenticated;
grant select on public.reimbursement_rule_sets to authenticated;
grant all on public.reimbursement_rule_sets to service_role;

comment on table public.reimbursement_rule_sets is
  'Catálogo global y versionado de requisitos verificados para reintegros/prestaciones. Los profesionales sólo leen reglas verificadas; la curación se realiza con service_role.';
