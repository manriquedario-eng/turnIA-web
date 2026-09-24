-- Prevent a single appointment from being reused across multiple reimbursement cases.
-- Existing duplicate draft cases were reviewed and cleaned before this migration was prepared.

alter table public.reimbursement_case_appointments
  add constraint reimbursement_case_appointments_appointment_unique
  unique (appointment_id);
