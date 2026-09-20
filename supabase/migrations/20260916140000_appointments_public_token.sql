-- Token público seguro para los links de email (confirmar / cancelar /
-- solicitar reprogramación) sin que el paciente necesite cuenta TurnIA.
--
-- Migración mínima y reversible: agrega TRES columnas a `appointments`,
-- ninguna migración de datos históricos destructiva, ninguna tabla
-- renombrada, ningún refactor. Se puede revertir con:
--   alter table public.appointments drop column public_token;
--   alter table public.appointments drop column reschedule_requested_at;
--   alter table public.appointments drop column reschedule_note;
--
-- Por qué un token aparte y no el id del turno: el id de `appointments` no
-- fue diseñado para ser secreto, así que usarlo directo como identificador
-- público permitiría iterar ids y tocar turnos ajenos. `public_token` es un
-- uuid random (gen_random_uuid(), pgcrypto — ya disponible en Supabase),
-- impredecible, exclusivo de esa fila, y la fila no expone tenant_id en
-- ninguna respuesta pública.

alter table public.appointments
  add column if not exists public_token uuid not null default gen_random_uuid();

-- Backfill explícito: no debería hacer falta con DEFAULT + NOT NULL en el
-- alter de arriba, pero es un no-op seguro si ya están todas las filas.
update public.appointments set public_token = gen_random_uuid() where public_token is null;

create unique index if not exists appointments_public_token_key on public.appointments (public_token);

comment on column public.appointments.public_token is
  'Token público impredecible para links de email (confirmar/cancelar/reprogramar). Nunca usar el id del turno para esto.';

-- Reprogramación (PARTE 20 del pedido): todavía no existe un motor de
-- disponibilidad seguro para que el paciente elija otro horario solo, así
-- que esta pasada implementa la versión mínima segura: el paciente
-- "solicita" reprogramación desde el link público, y el profesional ve la
-- solicitud en TurnIA para gestionarla manualmente. El turno NO se mueve ni
-- se cancela solo — sólo se marca la solicitud.
alter table public.appointments
  add column if not exists reschedule_requested_at timestamptz,
  add column if not exists reschedule_note text;

comment on column public.appointments.reschedule_requested_at is
  'Cuándo el paciente pidió reprogramar desde el link público del email. NULL = sin solicitud pendiente.';
comment on column public.appointments.reschedule_note is
  'Nota opcional del paciente al solicitar reprogramación (ej. preferencia de horario). Texto libre, no clínico.';
