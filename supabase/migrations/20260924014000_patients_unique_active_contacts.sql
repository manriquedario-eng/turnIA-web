-- TurnIA — unicidad de contacto de pacientes activos
-- Cierra BUG-PAT-001 / BUG-RACE-002 de la auditoría de producción.
--
-- Alcance:
-- - sólo dentro del mismo tenant
-- - sólo pacientes activos (deleted_at is null)
-- - sólo valores no nulos
-- - email normalizado con lower(trim(email))
--
-- La base de producción fue verificada antes de preparar esta migración:
-- 0 grupos duplicados por phone_e164 y 0 por email normalizado.

create unique index if not exists patients_tenant_phone_e164_unique
  on public.patients (tenant_id, phone_e164)
  where deleted_at is null and phone_e164 is not null;

create unique index if not exists patients_tenant_email_norm_unique
  on public.patients (tenant_id, lower(trim(email)))
  where deleted_at is null and email is not null;
