alter table public.appointment_action_alerts
  add column if not exists read_at timestamptz;

create index if not exists appointment_action_alerts_professional_unread_idx
  on public.appointment_action_alerts (professional_id, created_at desc)
  where read_at is null;

grant update, delete on table public.appointment_action_alerts to service_role;
