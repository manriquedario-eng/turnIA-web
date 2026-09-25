-- Payment/cash ledger indexes used by Mercado Pago reconciliation and tenant-scoped reads.

create index if not exists cash_movements_payment_id_idx
  on public.cash_movements(payment_id);

create index if not exists cash_movements_tenant_id_idx
  on public.cash_movements(tenant_id);
