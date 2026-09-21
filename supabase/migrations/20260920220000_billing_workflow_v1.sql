-- ============================================================================
-- TurnIA — Facturación operativa V1
-- Fecha: 2026-09-20
--
-- Objetivo:
--   1) separar configuración técnica ARCA de la operatoria de facturación;
--   2) modelar pagadores/obras sociales reutilizables;
--   3) vincular pacientes con un pagador;
--   4) guardar borradores y comprobantes con snapshot fiscal histórico;
--   5) relacionar una factura con varias sesiones/turnos;
--   6) dejar preparada la actividad ARCA del profesional.
--
-- La migración es aditiva: no elimina ni renombra columnas/tablas existentes.
-- ============================================================================

create table if not exists public.billing_entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null default 'insurance',
  display_name text not null,
  legal_name text,
  cuit text,
  vat_condition_id integer,
  vat_condition_label text,
  commercial_address text,
  billing_email text,
  default_sale_condition text not null default 'cuenta_corriente',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint billing_entities_kind_check
    check (kind = any (array['insurance'::text,'company'::text,'individual'::text,'other'::text])),
  constraint billing_entities_name_check
    check (char_length(btrim(display_name)) > 0),
  constraint billing_entities_cuit_check
    check (cuit is null or cuit ~ '^\d{11}$'),
  constraint billing_entities_sale_condition_check
    check (default_sale_condition = any (array[
      'contado'::text,
      'cuenta_corriente'::text,
      'transferencia'::text,
      'tarjeta_debito'::text,
      'tarjeta_credito'::text,
      'cheque'::text,
      'otra'::text,
      'otros_medios_electronicos'::text
    ]))
);

comment on table public.billing_entities is
  'Pagadores/receptores fiscales reutilizables (obra social, empresa, particular). Los datos pueden cambiar para futuras facturas; cada factura guarda además su propio snapshot histórico.';

create unique index if not exists billing_entities_tenant_cuit_active_uidx
  on public.billing_entities (tenant_id, cuit)
  where cuit is not null and deleted_at is null;

create index if not exists billing_entities_tenant_name_idx
  on public.billing_entities (tenant_id, display_name)
  where deleted_at is null;

alter table public.patients
  add column if not exists billing_entity_id uuid references public.billing_entities(id) on delete set null;

create index if not exists patients_billing_entity_idx
  on public.patients (tenant_id, billing_entity_id)
  where billing_entity_id is not null and deleted_at is null;

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  professional_id uuid not null references auth.users(id) on delete restrict,
  patient_id uuid references public.patients(id) on delete set null,
  billing_entity_id uuid references public.billing_entities(id) on delete set null,

  environment text not null default 'homologacion',
  status text not null default 'draft',
  voucher_type integer not null default 11,
  point_of_sale integer,
  concept_id integer not null default 2,

  issue_date date not null,
  service_from date,
  service_to date,
  due_date date,
  currency text not null default 'PES',
  currency_rate numeric(18,6) not null default 1,
  total numeric(14,2) not null,
  detail text not null,
  sale_condition text,

  recipient_doc_type integer,
  recipient_doc_number text,
  recipient_legal_name text not null,
  recipient_cuit text,
  recipient_vat_condition_id integer,
  recipient_vat_condition_label text,
  recipient_address text,
  recipient_email text,

  activity_code text,
  activity_description text,

  arca_result text,
  arca_cae text,
  arca_cae_expires_at date,
  arca_voucher_number bigint,
  arca_processed_at timestamptz,
  arca_error_message text,
  authorized_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint billing_invoices_environment_check
    check (environment = any (array['homologacion'::text,'produccion'::text])),
  constraint billing_invoices_status_check
    check (status = any (array['draft'::text,'authorized'::text,'rejected'::text])),
  constraint billing_invoices_total_check check (total > 0),
  constraint billing_invoices_point_of_sale_check check (point_of_sale is null or point_of_sale > 0),
  constraint billing_invoices_recipient_cuit_check
    check (recipient_cuit is null or recipient_cuit ~ '^\d{11}$')
);

comment on table public.billing_invoices is
  'Borradores y comprobantes ARCA. recipient_* es un snapshot inmutable de los datos del receptor al momento de armar/emitir la factura; no depende de cambios posteriores en billing_entities.';

create unique index if not exists billing_invoices_authorized_number_uidx
  on public.billing_invoices (
    tenant_id,
    professional_id,
    environment,
    point_of_sale,
    voucher_type,
    arca_voucher_number
  )
  where status = 'authorized' and arca_voucher_number is not null;

create index if not exists billing_invoices_tenant_status_date_idx
  on public.billing_invoices (tenant_id, status, issue_date desc);

create index if not exists billing_invoices_patient_idx
  on public.billing_invoices (tenant_id, patient_id, created_at desc)
  where patient_id is not null;

create table if not exists public.billing_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(14,2) not null,
  line_total numeric(14,2) not null,
  created_at timestamptz not null default now(),
  constraint billing_invoice_lines_description_check check (char_length(btrim(description)) > 0),
  constraint billing_invoice_lines_quantity_check check (quantity > 0),
  constraint billing_invoice_lines_amount_check check (unit_price >= 0 and line_total >= 0)
);

create index if not exists billing_invoice_lines_invoice_idx
  on public.billing_invoice_lines (tenant_id, invoice_id);

create table if not exists public.billing_invoice_appointments (
  invoice_id uuid not null references public.billing_invoices(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (invoice_id, appointment_id)
);

create index if not exists billing_invoice_appointments_appointment_idx
  on public.billing_invoice_appointments (tenant_id, appointment_id);

alter table public.arca_connections
  add column if not exists activity_code text,
  add column if not exists activity_description text;

comment on column public.arca_connections.activity_code is
  'Código de actividad económica ARCA usado como valor predeterminado en la facturación del profesional.';
comment on column public.arca_connections.activity_description is
  'Descripción visible de la actividad ARCA seleccionada por el profesional.';

-- RLS: operatoria compartida por miembros del mismo tenant. La emisión fiscal
-- real sigue siendo server-side y usa el professional_id/certificado correcto.
alter table public.billing_entities enable row level security;
alter table public.billing_invoices enable row level security;
alter table public.billing_invoice_lines enable row level security;
alter table public.billing_invoice_appointments enable row level security;

drop policy if exists billing_entities_tenant_all on public.billing_entities;
create policy billing_entities_tenant_all
  on public.billing_entities
  for all
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists billing_invoices_tenant_all on public.billing_invoices;
create policy billing_invoices_tenant_all
  on public.billing_invoices
  for all
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists billing_invoice_lines_tenant_all on public.billing_invoice_lines;
create policy billing_invoice_lines_tenant_all
  on public.billing_invoice_lines
  for all
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop policy if exists billing_invoice_appointments_tenant_all on public.billing_invoice_appointments;
create policy billing_invoice_appointments_tenant_all
  on public.billing_invoice_appointments
  for all
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.billing_entities to authenticated;
grant select, insert, update, delete on public.billing_invoices to authenticated;
grant select, insert, update, delete on public.billing_invoice_lines to authenticated;
grant select, insert, update, delete on public.billing_invoice_appointments to authenticated;
