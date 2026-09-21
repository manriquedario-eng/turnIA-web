-- Indexes for the reimbursement foreign keys reported by the Supabase advisor.

create index reimbursement_cases_patient_id_idx
  on public.reimbursement_cases (patient_id);
create index reimbursement_cases_professional_id_idx
  on public.reimbursement_cases (professional_id);
create index reimbursement_cases_invoice_id_idx
  on public.reimbursement_cases (invoice_id)
  where invoice_id is not null;

create index reimbursement_case_appointments_tenant_idx
  on public.reimbursement_case_appointments (tenant_id);
create index reimbursement_case_appointments_case_tenant_idx
  on public.reimbursement_case_appointments (reimbursement_case_id, tenant_id);
drop index if exists public.reimbursement_case_appointments_appointment_idx;
create index reimbursement_case_appointments_appointment_tenant_idx
  on public.reimbursement_case_appointments (appointment_id, tenant_id);
