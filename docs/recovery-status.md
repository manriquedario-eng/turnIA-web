# TurnIA — estado operativo y de recuperación

Última actualización: 2026-09-23.

## Fuente de verdad

- La rama de producción es `main`.
- Los cambios funcionales deben entrar por rama aislada + Pull Request + TurnIA CI + Vercel Preview antes de mergear.
- Supabase producción y Vercel producción deben verificarse después de cada cambio que los afecte.
- Las ramas de trabajo de integraciones en curso no deben mezclarse automáticamente con `main`.

## Implementado en producción

- Autenticación y sesión con Supabase SSR.
- Resolución de tenant y protección server-side de áreas privadas.
- Dashboard.
- Pacientes: alta, edición, archivado, alias, datos administrativos y cobertura.
- Historia clínica, sesiones y seguimientos con auditoría transaccional.
- Agenda: alta, edición, reprogramación, cancelación y control de solapamientos.
- Servicios.
- Pagos y caja.
- Mercado Pago: OAuth, checkout y conciliación idempotente.
- Facturación interna y flujo ARCA en homologación.
- Reintegros / obras sociales.
- Google Calendar / Meet.
- Email transaccional.
- Exportaciones de Agenda, Pacientes, Pagos y ficha individual.
- Documentos clínicos firmados.
- Recordatorios personales del profesional.
- Dictado breve para transcripción de notas clínicas.

## Protecciones relevantes ya cerradas

- RLS de facturación endurecida: usuarios autenticados no pueden modificar directamente estados/CAE fiscales.
- Saldos de créditos de transcripción IA no son editables directamente por `authenticated`.
- Dictado limitado a un máximo de 5 minutos por grabación, con validación UI + server.
- Contactos activos de pacientes protegidos por unicidad de teléfono/email por tenant.
- Pagos manuales protegidos contra sobrepago.
- Reintegros protegidos contra reutilización de una misma sesión.
- Turnos protegidos a nivel de base contra solapamientos del mismo profesional.
- Edición de pacientes y turnos con optimistic locking para no pisar cambios concurrentes.
- Cancelación de turno conectada con cancelación del evento de Google y aviso por email.
- Recuperación/reconciliación de CAE ARCA ante fallo local posterior a autorización.
- Timeouts explícitos en llamadas salientes a Google y email.
- Backups cifrados de producción y restauración validada en entorno de prueba.

## Transcripción por voz

El dictado actual está activo y es distinto de la implementación legacy de "Voice Notes".

- Máximo 5 minutos por grabación.
- No está diseñado para grabar sesiones o conversaciones completas.
- El audio se usa para transcribir y no se conserva en TurnIA; se conserva el texto resultante.
- La decisión de producto/privacidad sobre consentimiento explícito para el envío de audio al proveedor externo sigue siendo un punto pendiente de auditoría.

Las tablas y flujos legacy de Voice Notes no deben reactivarse sin una nueva revisión específica.

## Integraciones en trabajo paralelo

WhatsApp, MisRX y firma digital / Digilogix tienen trabajo propio y deben mantenerse aislados de las correcciones generales de auditoría salvo una integración deliberada y revisada.

Este documento no declara como terminadas esas ramas ni debe usarse para mezclarlas automáticamente con producción.

## Pendientes de auditoría

Entre los puntos todavía abiertos se encuentran, según prioridad y sin implicar que deban resolverse todos en un mismo cambio:

- Decisión/documentación de consentimiento para transcripción clínica por IA.
- Visibilidad y reintento de notificaciones fallidas sin cruzar el trabajo aislado de WhatsApp.
- Mejoras de exportación: filtros/paginación y evitar truncamientos silenciosos.
- Cobertura automatizada de integración/E2E sobre flujos críticos.
- Ampliación de los controles de seguridad estáticos donde corresponda.
- Revisión de avisos actuales de Security/Performance Advisors de Supabase antes de modificar políticas o índices.
- Mejoras de defensa en profundidad como CSP con nonce y rate limiting adicional, evaluadas de forma aislada para no romper integraciones existentes.

## Regla de despliegue

Un build exitoso por sí solo no cierra un punto. Antes de marcar una corrección como cerrada deben verificarse, según corresponda:

1. diff limitado al alcance esperado;
2. `main` sin cambios inesperados;
3. TurnIA CI en verde;
4. Vercel Preview en verde;
5. merge explícito;
6. deployment de producción READY;
7. ausencia de errores de runtime posteriores al deploy;
8. estado real de Supabase validado cuando el cambio afecta datos, constraints, RLS o migraciones.
