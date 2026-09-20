-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Revocación explícita de links públicos de turno (/t/[token]) + RPC atómicas
-- para las mutaciones públicas (confirmar/cancelar/reprogramar)
-- Generado: 2026-09-17 (actualizado tras revisión de seguridad de Dario)
--
-- Este archivo es una PROPUESTA para revisión de Dario. No se ejecutó contra
-- ninguna base. Requiere autorización explícita antes de aplicarse.
--
-- Migración NUEVA — no modifica la migración histórica
-- 20260916140000_appointments_public_token.sql, que originalmente agregó
-- `public_token`, `reschedule_requested_at` y `reschedule_note`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Columna de revocación
-- ----------------------------------------------------------------------------
--
-- Semántica:
--   NULL      = link público vigente, sujeto ÚNICAMENTE al vencimiento
--               normal (ends_at + 24 horas). A propósito NO existe una
--               columna fija de expiración: si el profesional reprograma el
--               turno (cambia ends_at), el vencimiento del link lo
--               acompaña automáticamente sin sincronizar dos columnas.
--   timestamp = link revocado explícitamente en ese momento: deja de
--               aceptar lectura pública, confirmar, cancelar o solicitar
--               reprogramación PARA SIEMPRE, sin importar ends_at.
--
-- Esta pasada NO agrega ninguna acción que efectivamente escriba esta
-- columna (no hay todavía botón de "revocar link" ni de "regenerar link").
-- Una futura función de "regenerar link" debería, sobre la misma fila:
--   1) generar un public_token nuevo (gen_random_uuid());
--   2) limpiar (poner en NULL) public_token_revoked_at.
--
-- Idempotente y no destructiva: `add column if not exists`, sin backfill
-- (NULL ya es el estado correcto para todas las filas existentes).

alter table public.appointments
  add column if not exists public_token_revoked_at timestamptz null;

comment on column public.appointments.public_token_revoked_at is
  'NULL = link público (/t/[token]) vigente, sujeto únicamente al vencimiento normal (ends_at + 24hs). Fecha presente = link revocado explícitamente en ese momento: deja de aceptar lectura pública, confirmar, cancelar o solicitar reprogramación para siempre, sin importar ends_at. Cancelar un turno desde el propio link público NO escribe esta columna. Ver funciones confirm_public_appointment/cancel_public_appointment/request_public_appointment_reschedule más abajo, y lib/appointments/public-token.ts.';

-- ----------------------------------------------------------------------------
-- 2) RPC atómicas para las mutaciones públicas
-- ----------------------------------------------------------------------------
--
-- Por qué RPC y no UPDATE armado desde TypeScript: la condición de
-- vencimiento (`ends_at + interval '24 hours' > clock_timestamp()`) tiene
-- que evaluarse dentro de POSTGRES, en el mismo statement que hace el
-- UPDATE — calcular ese corte en Node y mandarlo como parámetro deja una
-- ventana (por más chica que sea) entre "Node calculó la hora" y "Postgres
-- ejecuta el UPDATE". Estas tres funciones cierran esa ventana por
-- completo: todo — lectura con lock, decisión y escritura — ocurre dentro
-- de Postgres, en una sola transacción por invocación.
--
-- Por qué `clock_timestamp()` y NO `now()`/`transaction_timestamp()`:
-- `now()` queda FIJADO al inicio de la transacción — no se re-evalúa
-- durante su ejecución. El `SELECT ... FOR UPDATE` de abajo puede tener
-- que ESPERAR un lock si otra transacción concurrente está tocando la
-- misma fila; si el token vence justo durante esa espera, una comparación
-- contra `now()` seguiría usando la hora de ANTES de la espera y podría
-- tratar como vigente un link que ya venció en el mundo real.
-- `clock_timestamp()` es volátil: se re-evalúa en el momento real de
-- ejecución de cada sentencia, después de cualquier espera de lock. Por
-- eso se usa en las DOS comprobaciones de cada función — la del
-- `SELECT ... FOR UPDATE` inicial Y la del `UPDATE` final — nunca una sola
-- vez reutilizada. El `UPDATE` final, además, repite explícitamente
-- `public_token_revoked_at is null` y la condición de `ends_at`, y usa
-- `RETURNING ... INTO` para confirmar que realmente escribió una fila: si
-- el `SELECT` encontró la fila vigente pero, al momento exacto de este
-- `UPDATE`, la condición temporal ya no se cumple, `RETURNING` no
-- devuelve nada y la función responde `'not_available'`, nunca `'ok'`.
--
-- SECURITY DEFINER (no INVOKER): igual que check_rate_limit en
-- 20260917120000_rate_limit_counters.sql, la tabla appointments tiene su
-- propio RLS de área autenticada, pero estas funciones son para el flujo
-- público SIN sesión — necesitan poder leer/escribir la fila exacta del
-- token sin depender de policies de usuario. `SET search_path = ''` +
-- nombres completamente calificados (`public.appointments`) neutralizan el
-- riesgo de "search_path hijacking" propio de SECURITY DEFINER.
--
-- Cada función:
--   - Recibe el token como `uuid` (no `text`): Postgres ya rechaza
--     cualquier valor con forma inválida al momento de castear el
--     parámetro, como capa adicional a la validación de formato que
--     lib/appointments/public-token.ts ya hace ANTES de llamar a la RPC.
--   - Nunca acepta ni recibe ningún otro identificador del turno (id,
--     patient_id, etc.) — sólo el public_token.
--   - Devuelve ÚNICAMENTE `result text` con un valor de un conjunto fijo
--     ('ok' | 'already_cancelled' | 'not_available') — nunca tenant_id,
--     patient_id, ni ningún dato clínico o de negocio.
--   - Colapsa token inexistente + revocado + vencido en el mismo
--     'not_available': nunca se distingue el motivo, ni siquiera para la
--     app — esa distinción no existe en ningún lado después de esta capa.
--   - No se le otorga EXECUTE a PUBLIC/anon/authenticated — sólo a
--     service_role (ver GRANT/REVOKE al final de cada función).

create or replace function public.confirm_public_appointment(p_token uuid)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_updated_id uuid;
begin
  -- clock_timestamp(), no now(): se re-evalúa en el momento real en que
  -- esta sentencia se ejecuta, incluso si tuvo que esperar el lock de
  -- FOR UPDATE — ver comentario más arriba, antes de esta función.
  select a.id, a.status
    into v_id, v_status
  from public.appointments as a
  where a.public_token = p_token
    and a.public_token_revoked_at is null
    and a.ends_at + interval '24 hours' > clock_timestamp()
  for update;

  if not found then
    return query select 'not_available'::text;
    return;
  end if;

  if v_status in ('cancelled', 'cancelado') then
    return query select 'already_cancelled'::text;
    return;
  end if;

  -- Segunda comprobación, independiente de la de arriba: mismo
  -- public_token_revoked_at/ends_at, con su propio clock_timestamp() —
  -- nunca el mismo valor "cacheado" del SELECT. RETURNING ... INTO detecta
  -- si realmente se escribió una fila.
  update public.appointments as a
  set status = 'confirmed', updated_at = clock_timestamp()
  where a.id = v_id
    and a.public_token_revoked_at is null
    and a.ends_at + interval '24 hours' > clock_timestamp()
  returning a.id into v_updated_id;

  if v_updated_id is null then
    -- El SELECT encontró la fila vigente, pero al momento real de este
    -- UPDATE la condición temporal ya no se cumple (o se revocó) —
    -- nunca se reporta éxito en ese caso.
    return query select 'not_available'::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;

comment on function public.confirm_public_appointment(uuid) is
  'Confirma un turno vía su public_token. La condición de vigencia (no revocado, ends_at + 24hs vía clock_timestamp(), nunca now()) se re-evalúa DOS VECES en la misma transacción: en el SELECT ... FOR UPDATE inicial y de nuevo en el WHERE del UPDATE final (con RETURNING para confirmar que escribió una fila) — así un vencimiento ocurrido mientras la función esperaba un lock nunca puede terminar en un UPDATE exitoso. Devuelve solamente result: ok | already_cancelled | not_available (nunca distingue inexistente/revocado/vencido). Ejecutable únicamente por service_role.';

revoke all on function public.confirm_public_appointment(uuid) from public;
revoke all on function public.confirm_public_appointment(uuid) from anon, authenticated;
grant execute on function public.confirm_public_appointment(uuid) to service_role;


create or replace function public.cancel_public_appointment(p_token uuid)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_updated_id uuid;
begin
  select a.id, a.status
    into v_id, v_status
  from public.appointments as a
  where a.public_token = p_token
    and a.public_token_revoked_at is null
    and a.ends_at + interval '24 hours' > clock_timestamp()
  for update;

  if not found then
    return query select 'not_available'::text;
    return;
  end if;

  -- Idempotente: si ya estaba cancelado Y el link sigue vigente (recién
  -- verificado arriba con clock_timestamp()), se informa éxito sin volver
  -- a escribir la fila. A propósito esta función NUNCA toca
  -- public_token_revoked_at: cancelar desde el propio link no revoca el
  -- token (ver comentario en lib/appointments/public-token.ts).
  if v_status in ('cancelled', 'cancelado') then
    return query select 'ok'::text;
    return;
  end if;

  -- Segunda comprobación independiente, con su propio clock_timestamp(), y
  -- RETURNING ... INTO para confirmar que realmente escribió una fila.
  update public.appointments as a
  set status = 'cancelled', updated_at = clock_timestamp()
  where a.id = v_id
    and a.public_token_revoked_at is null
    and a.ends_at + interval '24 hours' > clock_timestamp()
  returning a.id into v_updated_id;

  if v_updated_id is null then
    return query select 'not_available'::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;

comment on function public.cancel_public_appointment(uuid) is
  'Cancela un turno vía su public_token. Idempotente: si ya estaba cancelado y el link sigue vigente, devuelve ok sin escribir. La condición de vigencia (clock_timestamp(), nunca now()) se re-evalúa en el SELECT ... FOR UPDATE inicial y de nuevo en el WHERE del UPDATE final (con RETURNING) para el caso no-cancelado, así un vencimiento ocurrido durante una espera de lock nunca puede terminar en un UPDATE exitoso. NUNCA escribe public_token_revoked_at. Devuelve solamente result: ok | not_available. Ejecutable únicamente por service_role.';

revoke all on function public.cancel_public_appointment(uuid) from public;
revoke all on function public.cancel_public_appointment(uuid) from anon, authenticated;
grant execute on function public.cancel_public_appointment(uuid) to service_role;


create or replace function public.request_public_appointment_reschedule(p_token uuid, p_note text)
returns table (result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_note text;
  v_updated_id uuid;
begin
  select a.id, a.status
    into v_id, v_status
  from public.appointments as a
  where a.public_token = p_token
    and a.public_token_revoked_at is null
    and a.ends_at + interval '24 hours' > clock_timestamp()
  for update;

  if not found then
    return query select 'not_available'::text;
    return;
  end if;

  if v_status in ('cancelled', 'cancelado') then
    return query select 'already_cancelled'::text;
    return;
  end if;

  -- Mismo criterio que la versión anterior en TypeScript: trim, string
  -- vacío -> NULL, tope de 500 caracteres.
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 500 then
    v_note := left(v_note, 500);
  end if;

  -- Segunda comprobación independiente, con su propio clock_timestamp(), y
  -- RETURNING ... INTO para confirmar que realmente escribió una fila.
  -- reschedule_requested_at/updated_at también usan clock_timestamp() para
  -- representar el momento real de escritura, no el inicio de la
  -- transacción.
  update public.appointments as a
  set reschedule_requested_at = clock_timestamp(),
      reschedule_note = v_note,
      updated_at = clock_timestamp()
  where a.id = v_id
    and a.public_token_revoked_at is null
    and a.ends_at + interval '24 hours' > clock_timestamp()
  returning a.id into v_updated_id;

  if v_updated_id is null then
    return query select 'not_available'::text;
    return;
  end if;

  return query select 'ok'::text;
end;
$$;

comment on function public.request_public_appointment_reschedule(uuid, text) is
  'Registra una solicitud de reprogramación vía public_token (no mueve el turno). La condición de vigencia (clock_timestamp(), nunca now()) se re-evalúa en el SELECT ... FOR UPDATE inicial y de nuevo en el WHERE del UPDATE final (con RETURNING), así un vencimiento ocurrido durante una espera de lock nunca puede terminar en un UPDATE exitoso. Trunca reschedule_note a 500 caracteres server-side. Devuelve solamente result: ok | already_cancelled | not_available. Ejecutable únicamente por service_role.';

revoke all on function public.request_public_appointment_reschedule(uuid, text) from public;
revoke all on function public.request_public_appointment_reschedule(uuid, text) from anon, authenticated;
grant execute on function public.request_public_appointment_reschedule(uuid, text) to service_role;

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario.
-- ============================================================================
