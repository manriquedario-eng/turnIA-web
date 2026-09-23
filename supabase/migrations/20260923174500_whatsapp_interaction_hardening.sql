-- WhatsApp interactions hardening.
-- Additive only. Apply before enabling interactive webhook processing in production.
-- Does not touch MisRX or Digilogix structures.

create table if not exists public.whatsapp_inbound_events (
  provider_message_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  action text not null check (action in ('confirm', 'cancel', 'reschedule')),
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed', 'rejected')),
  sender_wa_id text not null,
  error_message text,
  created_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

comment on table public.whatsapp_inbound_events is
  'Idempotency/audit ledger for signed WhatsApp appointment-action webhook events. Service-role only.';

create index if not exists whatsapp_inbound_events_appointment_idx
  on public.whatsapp_inbound_events (appointment_id, created_at desc);

alter table public.whatsapp_inbound_events enable row level security;

-- No authenticated/anon policy on purpose: webhook processing is service-role only.
revoke all on table public.whatsapp_inbound_events from anon, authenticated;

-- Only the flows that are semantically one-shot are unique. Appointment
-- creation/update confirmations are deliberately NOT included because TurnIA
-- resends them when a professional changes the appointment.
create unique index if not exists appointment_messages_once_for_reminders_and_reschedule_alerts
  on public.appointment_messages (appointment_id, message_type, channel)
  where appointment_id is not null
    and message_type in ('appointment_reminder_24h', 'professional_reschedule_requested');
