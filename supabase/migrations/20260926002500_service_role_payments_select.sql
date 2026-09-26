-- The public Mercado Pago payment offer is evaluated server-side with
-- the Supabase service-role client. It must be able to read payments in
-- order to calculate the remaining balance and prevent double collection.
grant select on table public.payments to service_role;
