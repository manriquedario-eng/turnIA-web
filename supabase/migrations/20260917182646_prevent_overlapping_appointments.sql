-- TurnIA — protección de concurrencia para turnos superpuestos
--
-- Esta migración ya figura aplicada en Supabase producción con la versión
-- 20260917182646. Se agrega al repositorio para eliminar drift entre Git y
-- el historial real de la base y para que reconstrucciones futuras conserven
-- la misma defensa.
--
-- Regla: un mismo profesional dentro del mismo tenant no puede tener dos
-- turnos activos cuyos rangos [starts_at, ends_at) se superpongan.
-- Los turnos cancelados quedan fuera de la restricción.

create extension if not exists btree_gist;

alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    tenant_id with =,
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  )
  where (status not in ('cancelled', 'cancelado'));
