-- Cover the new billing foreign keys with indexes so deletes/joins remain efficient.
create index if not exists patients_billing_entity_fk_idx
  on public.patients (billing_entity_id)
  where billing_entity_id is not null;

create index if not exists billing_invoices_professional_fk_idx
  on public.billing_invoices (professional_id);

create index if not exists billing_invoices_patient_fk_idx
  on public.billing_invoices (patient_id)
  where patient_id is not null;

create index if not exists billing_invoices_entity_fk_idx
  on public.billing_invoices (billing_entity_id)
  where billing_entity_id is not null;

create index if not exists billing_invoice_lines_invoice_fk_idx
  on public.billing_invoice_lines (invoice_id);

create index if not exists billing_invoice_appointments_appointment_fk_idx
  on public.billing_invoice_appointments (appointment_id);
