-- Evita doble emisión concurrente del mismo borrador.
alter table public.billing_invoices
  drop constraint if exists billing_invoices_status_check;

alter table public.billing_invoices
  add constraint billing_invoices_status_check
  check (status = any (array[
    'draft'::text,
    'authorizing'::text,
    'authorized'::text,
    'rejected'::text
  ]));

comment on column public.billing_invoices.status is
  'draft=borrador editable; authorizing=emisión ARCA en curso (lock lógico); authorized=CAE otorgado; rejected=ARCA rechazó la solicitud.';
