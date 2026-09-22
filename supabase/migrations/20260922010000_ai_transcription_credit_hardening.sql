-- TurnIA — hardening de créditos de Transcripción IA
-- Fecha: 2026-09-22
--
-- Riesgo corregido:
-- authenticated tenía UPDATE a nivel de tabla sobre ai_transcription_accounts.
-- La RLS limitaba la fila al tenant, pero no las columnas, por lo que un
-- cliente autenticado podía intentar alterar balance_seconds o
-- lifetime_used_seconds directamente.
--
-- Compatibilidad:
-- la UI actual sólo actualiza enabled + updated_at, por lo que mantenemos
-- exactamente esas dos columnas editables y retiramos UPDATE sobre el resto.
-- Las funciones SECURITY DEFINER de reserva/settlement/refund continúan
-- siendo las únicas vías normales para mover saldos y consumo.

begin;

revoke update on table public.ai_transcription_accounts from authenticated;

grant update (enabled, updated_at)
  on table public.ai_transcription_accounts
  to authenticated;

comment on column public.ai_transcription_accounts.enabled is
  'Única preferencia de Transcripción IA editable directamente por el profesional autenticado.';

comment on column public.ai_transcription_accounts.balance_seconds is
  'Saldo administrado únicamente por funciones controladas de créditos/consumo; no editable directamente por authenticated.';

comment on column public.ai_transcription_accounts.lifetime_used_seconds is
  'Consumo acumulado administrado únicamente por funciones controladas; no editable directamente por authenticated.';

commit;
