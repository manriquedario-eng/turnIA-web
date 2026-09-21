-- TurnIA — dos circuitos de facturación:
-- 1) factura al paciente para reintegro;
-- 2) factura directa a obra social / empresa.
-- Migración aditiva: conserva billing_entity_id como vínculo opcional a un
-- receptor institucional reutilizable y agrega datos fiscales propios del paciente.

alter table public.patients
  add column if not exists fiscal_cuit text,
  add column if not exists fiscal_vat_condition_id integer,
  add column if not exists fiscal_vat_condition_label text,
  add column if not exists fiscal_address text,
  add column if not exists fiscal_email text;

alter table public.patients
  drop constraint if exists patients_fiscal_cuit_check;

alter table public.patients
  add constraint patients_fiscal_cuit_check
  check (fiscal_cuit is null or fiscal_cuit ~ '^\d{11}$');

alter table public.billing_invoices
  add column if not exists recipient_mode text not null default 'patient_reimbursement';

alter table public.billing_invoices
  drop constraint if exists billing_invoices_recipient_mode_check;

alter table public.billing_invoices
  add constraint billing_invoices_recipient_mode_check
  check (recipient_mode = any (array[
    'patient_reimbursement'::text,
    'direct_payer'::text
  ]));

comment on column public.billing_invoices.recipient_mode is
  'patient_reimbursement=factura al paciente para presentar a su cobertura; direct_payer=factura a obra social/empresa como receptor fiscal.';

comment on column public.patients.billing_entity_id is
  'Receptor institucional predeterminado cuando el profesional factura directamente a una obra social/empresa. No reemplaza los datos de cobertura del paciente.';

comment on column public.patients.fiscal_cuit is
  'CUIT opcional del paciente cuando la factura se emite a su nombre; si no existe puede usarse DNI según reglas ARCA.';
