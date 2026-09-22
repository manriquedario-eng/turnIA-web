-- TurnIA — hardening RLS de facturación
-- Objetivo: impedir que un usuario autenticado modifique directamente
-- estados/resultados fiscales de ARCA o altere líneas/sesiones de comprobantes
-- una vez que dejan de ser borradores.
--
-- Compatibilidad: el flujo server-side de emisión usa service_role para las
-- transiciones fiscales (draft -> authorizing -> authorized/rejected).

begin;

-- ---------------------------------------------------------------------------
-- billing_invoices
-- ---------------------------------------------------------------------------
drop policy if exists billing_invoices_tenant_all on public.billing_invoices;
drop policy if exists billing_invoices_tenant_select on public.billing_invoices;
drop policy if exists billing_invoices_tenant_insert_draft on public.billing_invoices;
drop policy if exists billing_invoices_owner_delete_draft on public.billing_invoices;

create policy billing_invoices_tenant_select
  on public.billing_invoices
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

create policy billing_invoices_tenant_insert_draft
  on public.billing_invoices
  for insert
  to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and professional_id = auth.uid()
    and status = 'draft'
    and arca_result is null
    and arca_cae is null
    and arca_cae_expires_at is null
    and arca_voucher_number is null
    and arca_processed_at is null
    and arca_error_message is null
    and authorized_at is null
  );

create policy billing_invoices_owner_delete_draft
  on public.billing_invoices
  for delete
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and professional_id = auth.uid()
    and status = 'draft'
  );

-- No existe policy UPDATE para authenticated. Las transiciones fiscales
-- quedan reservadas al backend con service_role.
revoke update on table public.billing_invoices from authenticated;
grant select, insert, delete on table public.billing_invoices to authenticated;

-- ---------------------------------------------------------------------------
-- billing_invoice_lines
-- ---------------------------------------------------------------------------
drop policy if exists billing_invoice_lines_tenant_all on public.billing_invoice_lines;
drop policy if exists billing_invoice_lines_tenant_select on public.billing_invoice_lines;
drop policy if exists billing_invoice_lines_insert_draft on public.billing_invoice_lines;
drop policy if exists billing_invoice_lines_delete_draft on public.billing_invoice_lines;

create policy billing_invoice_lines_tenant_select
  on public.billing_invoice_lines
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

create policy billing_invoice_lines_insert_draft
  on public.billing_invoice_lines
  for insert
  to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1
      from public.billing_invoices bi
      where bi.id = invoice_id
        and bi.tenant_id = tenant_id
        and bi.professional_id = auth.uid()
        and bi.status = 'draft'
    )
  );

create policy billing_invoice_lines_delete_draft
  on public.billing_invoice_lines
  for delete
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1
      from public.billing_invoices bi
      where bi.id = invoice_id
        and bi.tenant_id = tenant_id
        and bi.professional_id = auth.uid()
        and bi.status = 'draft'
    )
  );

revoke update on table public.billing_invoice_lines from authenticated;
grant select, insert, delete on table public.billing_invoice_lines to authenticated;

-- ---------------------------------------------------------------------------
-- billing_invoice_appointments
-- ---------------------------------------------------------------------------
drop policy if exists billing_invoice_appointments_tenant_all on public.billing_invoice_appointments;
drop policy if exists billing_invoice_appointments_tenant_select on public.billing_invoice_appointments;
drop policy if exists billing_invoice_appointments_insert_draft on public.billing_invoice_appointments;
drop policy if exists billing_invoice_appointments_delete_draft on public.billing_invoice_appointments;

create policy billing_invoice_appointments_tenant_select
  on public.billing_invoice_appointments
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id));

create policy billing_invoice_appointments_insert_draft
  on public.billing_invoice_appointments
  for insert
  to authenticated
  with check (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1
      from public.billing_invoices bi
      where bi.id = invoice_id
        and bi.tenant_id = tenant_id
        and bi.professional_id = auth.uid()
        and bi.status = 'draft'
    )
  );

create policy billing_invoice_appointments_delete_draft
  on public.billing_invoice_appointments
  for delete
  to authenticated
  using (
    public.is_tenant_member(tenant_id)
    and exists (
      select 1
      from public.billing_invoices bi
      where bi.id = invoice_id
        and bi.tenant_id = tenant_id
        and bi.professional_id = auth.uid()
        and bi.status = 'draft'
    )
  );

revoke update on table public.billing_invoice_appointments from authenticated;
grant select, insert, delete on table public.billing_invoice_appointments to authenticated;

commit;
