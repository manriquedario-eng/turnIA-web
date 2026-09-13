# TurnIA Recovery — estado

## Rama activa
`recovery/turnia-base`

## Objetivo del bloque 1
Reconstruir la base de la aplicación sin modificar el esquema de `turnia-staging`.

## Implementado
- Next.js + TypeScript strict.
- Supabase SSR con publishable key por variables de entorno.
- Refresh de sesión por middleware.
- Login y logout server-side.
- Protección de rutas.
- Resolución de tenant desde `tenant_members`.
- Dashboard inicial tenant-scoped.
- Listado de pacientes tenant-scoped y compatible con RLS.

## No implementado todavía
- Crear/editar pacientes.
- Ficha clínica y seguimientos manuales.
- Agenda.
- Servicios.
- Pagos y caja.
- Settings.
- Suite E2E Tenant A/B.

## Restricciones
- No tocar migrations ni RLS de Supabase durante Recovery Base 1.
- No usar service-role en frontend.
- No reactivar Voice Notes.
- No iniciar Fase 4A reminders todavía.

## Próximo checkpoint
Validar build/typecheck y probar login + aislamiento Tenant A/B contra staging antes de continuar con CRUD de pacientes.
