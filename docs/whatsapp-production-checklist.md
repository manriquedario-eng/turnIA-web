# TurnIA — Checklist de activación WhatsApp

> Rama de trabajo: `feat/whatsapp-interactions-main-sync`
> Regla: no promover a producción hasta completar esta lista y validar Meta.

## 1. Aislamiento

- No tocar ni mezclar MisRX.
- No tocar ni mezclar Firma Digital / Digilogix.
- Partir de la versión integrada vigente de `main` al momento del merge final.
- Revisar conflictos antes de promover.

## 2. Meta / WhatsApp Cloud API

Confirmar en Meta:

- Negocio verificado o en estado aceptado.
- Número de WhatsApp Business activo y con calidad normal.
- Webhook suscripto al número correcto.
- Plantilla de alta de turno aprobada.
- Plantilla de recordatorio 24 h aprobada.
- Plantilla de aviso de reprogramación al profesional aprobada.

### Plantilla de alta de turno

Nombre aprobado en Meta: `appointment_created` (`es_AR`).

Mensaje informativo / bienvenida. No lleva botones ni acciones.

Parámetros BODY, en este orden:

1. Paciente o alias de comunicación
2. Fecha
3. Hora
4. Profesional

### Plantilla de recordatorio 24 h

Nombre aprobado en Meta: `turniahealth_turno_registrado` (`es_AR`).

Parámetros BODY, en este orden:

1. Paciente
2. Fecha
3. Hora
4. Profesional

Botones, en este orden:

1. Confirmar
2. Cancelar
3. Reprogramar

### Plantilla de aviso al profesional por reprogramación

Parámetros BODY, en este orden:

1. Profesional
2. Paciente
3. Fecha actual del turno
4. Hora actual del turno

Debe ser Utility. Puede incluir un botón/URL estático hacia TurnIA si Meta lo aprueba.

## 3. Variables de entorno

Nunca pegar valores reales en código, documentación, commits o chats.

Variables esperadas:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TEMPLATE_NAME`
- `WHATSAPP_TEMPLATE_LANG`
- `WHATSAPP_GRAPH_API_VERSION`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_REMINDER_TEMPLATE_NAME`
- `WHATSAPP_REMINDER_TEMPLATE_LANG`
- `WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_NAME`
- `WHATSAPP_PROFESSIONAL_RESCHEDULE_TEMPLATE_LANG`
- `CRON_SECRET`

Los secretos deben cargarse directamente en Vercel por una persona autorizada.

## 4. Base de datos

Antes de activar el webhook interactivo en producción, aplicar y revisar EN ESTE ORDEN:

1. `supabase/migrations/20260923174500_whatsapp_interaction_hardening.sql`
2. `supabase/migrations/20260923183500_professional_contacts.sql`
3. `supabase/migrations/20260923185500_idempotent_reschedule_requests.sql`
4. `supabase/migrations/20260923190500_clear_pending_reschedule_on_final_action.sql`
5. `supabase/migrations/20260924121000_whatsapp_public_action_rpc_consistency.sql`
6. `supabase/migrations/20260924122000_whatsapp_permissions_and_indexes.sql`
7. `supabase/migrations/20260924204500_whatsapp_appointment_messages_service_role_grants.sql`
8. `supabase/migrations/20260924212000_public_appointment_actions_expire_at_start.sql`

Después confirmar:

- Existe `public.whatsapp_inbound_events`.
- Existe `public.professional_contacts` con clave `tenant_id + user_id`.
- La RPC de reprogramación devuelve `already_requested` si ya existe una solicitud pendiente.
- Confirmar o cancelar limpia cualquier solicitud de reprogramación pendiente.
- Confirmar / Cancelar / Reprogramar dejan de mutar cuando `starts_at` ya pasó, aunque el link público siga legible durante su gracia.
- Confirmar RLS habilitada y sin políticas de acceso para anon/authenticated.
- Confirmar columna `dedupe_key` en `appointment_messages`.
- Confirmar índice único por `appointment_id + message_type + channel + dedupe_key` para:
  - `appointment_reminder_24h`
  - `professional_reschedule_requested`
- Verificar que una reprogramación real genera un nuevo ciclo y permite un nuevo recordatorio/aviso sin duplicar el anterior.
- Confirmar `service_role` con `SELECT, INSERT, UPDATE` sobre `appointment_messages`.
- Confirmar columnas:
  - `delivered_at`
  - `read_at`
  - `failed_at`

## 5. Seguridad

Validar:

- POST webhook rechaza firma inválida.
- POST webhook rechaza si falta App Secret.
- Phone Number ID distinto es ignorado.
- Sólo el mismo teléfono del paciente puede ejecutar una acción del turno.
- El contexto del botón, cuando Meta lo envía, debe corresponder al mismo turno y exclusivamente a:
  - `appointment_reminder_24h`
- Reintentos del mismo webhook no duplican acciones.
- Errores transitorios devuelven respuesta reintentable.
- Estados no retroceden de `read` a `delivered`/`sent`.

## 6. Consentimientos

Alta de turno por WhatsApp:

- requiere `phone_e164`
- requiere `whatsapp_consent = true`

Recordatorio 24 h:

- requiere `appointment_reminders_opt_in = true`
- para WhatsApp además requiere `whatsapp_consent = true`

Nunca asumir consentimiento por defecto.

## 7. Prueba punta a punta

Paciente de prueba con:

- teléfono E.164 válido
- consentimiento WhatsApp activo
- recordatorios activos
- email válido

Crear un turno y comprobar:

1. Email recibido.
2. WhatsApp inicial recibido sin botones de acción.
3. `appointment_messages` contiene los intentos.
4. WhatsApp llega a `sent`.
5. Meta actualiza a `delivered`.
6. Si se abre, pasa a `read`.

Las acciones Confirmar / Cancelar / Reprogramar se prueban únicamente desde el recordatorio 24 h.

### Confirmar

- tocar Confirmar
- TurnIA cambia el turno a confirmado
- respuesta de WhatsApp al paciente
- si el turno tiene saldo pendiente, email válido y Mercado Pago del profesional disponible, la respuesta ofrece el link `/pagar/[token]`
- abrir `/pagar/[token]` NO crea una orden: el paciente debe tocar “Pagar con Mercado Pago”
- el checkout usa el saldo pendiente server-side, nunca un importe recibido del navegador
- un turno sin saldo pendiente no ofrece pago
- si el paciente ya pagó y luego cancela/no se presenta, el pago permanece registrado: no hay refund ni crédito automático
- el POST de inicio de pago tiene rate-limit y bloqueo cross-site
- la redirección externa usa `Referrer-Policy: no-referrer`
- no se duplica al reenviar webhook

### Cancelar

- tocar Cancelar
- TurnIA cambia el turno a cancelado
- respuesta de WhatsApp al paciente
- no se duplica al reenviar webhook

### Reprogramar

- tocar Reprogramar
- NO cambia fecha ni hora
- marca `reschedule_requested_at`
- aparece en Agenda
- aparece en bloque global de solicitudes
- profesional recibe email
- profesional recibe WhatsApp cuando la plantilla esté configurada
- paciente recibe respuesta confirmando la solicitud

Luego el profesional cambia fecha/hora:

- se limpia la solicitud pendiente
- se reenvían comunicaciones actualizadas según el flujo existente

## 8. Recordatorio 24 h

Con un turno elegible:

- cron ejecuta cada 15 minutos
- una sola notificación por canal
- email 24 h enviado
- WhatsApp 24 h enviado
- botones funcionan igual que en alta
- fallos transitorios pueden reintentarse
- turno cancelado/completado no recibe recordatorio

## 9. UI TurnIA

Revisar:

- Configuración muestra diagnóstico WhatsApp sin secretos.
- Teléfono profesional normalizado.
- Consentimientos claros.
- Agenda muestra estado de email/WhatsApp.
- Agenda muestra “Pidió reprogramar”.
- Agenda muestra bloque global de solicitudes pendientes.

## 10. Antes del merge

Ejecutar:

```bash
npm run typecheck
npm run security:regression
npm run whatsapp:regression
npm run build
```

Todos deben terminar en PASS.

No hacer merge a `main` ni promover producción sin validación final manual.
