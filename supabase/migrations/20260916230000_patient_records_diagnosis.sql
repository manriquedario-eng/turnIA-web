-- ============================================================================
-- MIGRACIÓN PROPUESTA — NO APLICADA
-- Campo Diagnóstico en Ficha clínica (PARTE 31-38 del pedido de rediseño +
-- cambio funcional prioritario)
-- Proyecto: turnia-staging (nnbpefxvpmegngqopcvw)
-- Generado: 2026-09-16
--
-- Este archivo es una PROPUESTA para revisión de Dario. No se ejecutó contra
-- turnia-staging ni ninguna otra base. Requiere autorización explícita antes
-- de aplicarse (Supabase CLI / dashboard, fuera de este entorno).
--
-- Auditoría previa (PARTE 32 del pedido): se revisó la estructura conocida
-- de `patient_records` a través de los `.select(...)` existentes en
-- app/(protected)/patients/[id]/page.tsx y lib/export/authorize.ts
-- ('id,reason,follow_up,background,notes,plan,updated_at') y el `.upsert(...)`
-- en app/(protected)/patients/actions.ts (upsertPatientRecord). No existe
-- ningún campo equivalente a diagnosis/diagnostico/diagnostic/
-- clinical_diagnosis en esas columnas, ni en ninguna otra migración de este
-- repo (grep sobre supabase/migrations/*.sql sin resultados para "diagnos").
-- No hay tabla de definición inicial de patient_records versionada en este
-- repo (se creó directamente en Supabase antes de este historial de
-- migraciones, igual que `patients`) — esta migración sólo agrega una
-- columna nueva, nunca recrea ni toca la tabla existente más allá de eso.
--
-- Qué agrega:
--   patient_records.diagnosis (text, nullable) — igual convención de tipo
--   que reason/background/plan/notes (texto libre, sin límite artificial
--   corto, cargado y editado por el profesional, nunca reescrito por IA).
--
-- Qué NO hace:
--   - No crea columnas duplicadas.
--   - No modifica ni elimina columnas existentes (reason, background, plan,
--     notes, follow_up, updated_at, patient_id, tenant_id, etc.).
--   - No borra datos.
--   - No recrea la tabla patient_records.
--   - No cambia constraints existentes (incluida la unique de
--     patient_id que ya usa el upsert de la app).
--   - No cambia políticas RLS existentes — diagnosis queda cubierto por la
--     misma política que ya protege el resto de la fila (aislada por
--     patient_id + tenant_id, igual que reason/background/plan/notes).
-- ============================================================================

ALTER TABLE public.patient_records
  ADD COLUMN IF NOT EXISTS diagnosis text;

COMMENT ON COLUMN public.patient_records.diagnosis IS
  'Diagnóstico clínico del paciente, texto libre cargado por el profesional. Mismo aislamiento por patient_id + tenant_id que el resto de la ficha clínica (RLS existente de patient_records, sin cambios). Nunca se muestra ni se exporta en listados generales de pacientes (/patients) — sólo en la ficha individual y sus exportaciones clínicas.';

-- ============================================================================
-- Fin de la migración propuesta. NO EJECUTAR sin autorización explícita de
-- Dario. Ver informe de la tarea (sección de Diagnóstico) para el detalle.
-- ============================================================================
