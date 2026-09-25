-- WhatsApp backend permission fix.
-- Staging validated before release.
-- Grants only the minimum CRUD needed by reminder/webhook backend flows.
-- No anon/authenticated privileges are changed.

grant select, insert, update
on table public.appointment_messages
to service_role;
