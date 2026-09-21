'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { normalizePhone, type KnownCountryPrefix } from '@/lib/phone';
import { findDuplicatePatient } from '@/lib/patients/duplicate-check';
import { vatConditionLabel } from '@/lib/billing/constants';

// Tipos de retorno de las 3 RPC de auditoría clínica (Fase 1, ver
// supabase/migrations/20260918120000_clinical_audit_log.sql). El cliente de
// Supabase de este proyecto no se crea con un generic `Database` (ver
// lib/supabase/server.ts) y, aunque lo tuviera, estas funciones todavía no
// existen en ningún esquema generado porque la migración no está aplicada —
// sin este tipado explícito, `.rpc(...).single()` infiere `data` como `{}`.
// Tipados a mano contra la firma SQL real de cada función, sin agregar
// ningún campo que la RPC no devuelva.
type ArchivePatientRpcResult = {
  ok: boolean;
};

type CreatePatientFollowUpRpcResult = {
  ok: boolean;
  follow_up_id: string | null;
  reason: string | null;
};

// `action` es NULL cuando ok=false: la RPC hace
// `RETURN QUERY SELECT false, NULL::text;` en el caso de paciente
// inválido/inexistente. No es `'create' | 'update'` no-nullable — eso no
// coincidiría con la firma SQL real.
type UpsertPatientRecordRpcResult = {
  ok: boolean;
  action: 'create' | 'update' | null;
};

const KNOWN_PREFIXES = new Set<KnownCountryPrefix>(['+54 9', '+54', '+598', '+595', '+56', '+34', '+1']);

// `PhoneInput` manda el prefijo elegido en un campo separado
// (`<name>_country_prefix`, vacío en modo manual). Se valida contra la
// lista conocida antes de pasarlo a `normalizePhone` — un valor
// inesperado se ignora (cae al parseo de siempre) en vez de romper la carga.
function readSelectedPrefix(formData: FormData, fieldName = 'phone_country_prefix'): KnownCountryPrefix | undefined {
  const value = formData.get(fieldName);
  if (typeof value !== 'string' || !value) return undefined;
  return KNOWN_PREFIXES.has(value as KnownCountryPrefix) ? (value as KnownCountryPrefix) : undefined;
}

function duplicateRedirectQuery(conflict: { field: 'email' | 'phone'; patientId: string; patientName: string }) {
  const label = conflict.field === 'phone' ? 'teléfono' : 'email';
  const message = `Ya existe un paciente con este ${label}: ${conflict.patientName}`;
  return `error=${encodeURIComponent(message)}&duplicate_patient_id=${conflict.patientId}`;
}

const optionalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(160).nullable().optional()
);

const optionalFiscalText = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().max(240).nullable().optional(),
);

const optionalBillingCuit = z.preprocess(
  (value) => {
    if (typeof value !== 'string' || value.trim() === '') return null;
    return value.replace(/\D/g, '');
  },
  z.string().regex(/^\d{11}$/, 'El CUIT de facturación debe tener 11 dígitos').nullable().optional(),
);

const optionalVatConditionId = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.coerce.number().int().positive().nullable().optional(),
);

const optionalBillingEntityId = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().uuid().nullable().optional(),
);

const optionalSaleCondition = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.enum([
    'contado',
    'cuenta_corriente',
    'transferencia',
    'tarjeta_debito',
    'tarjeta_credito',
    'cheque',
    'otra',
    'otros_medios_electronicos',
  ]).nullable().optional(),
);

// Checkbox HTML: cuando está tildado, FormData trae 'on' (o el value que se le
// haya dado); cuando no está tildado, el campo directamente no viene en el
// FormData. Por eso el preprocess trata "ausente" y "off" como false, nunca
// como true — el consentimiento nunca se infiere ni se asume por defecto.
const checkboxBoolean = z.preprocess(
  (value) => value === 'on' || value === 'true' || value === true,
  z.boolean()
);

const patientSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, 'El nombre es obligatorio').max(160),
  alias: optionalText,
  use_alias_for_communications: checkboxBoolean,
  phone: optionalText,
  email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().email('Email inválido').max(200).nullable().optional()
  ),
  dni: optionalText,
  insurance_name: optionalText,
  insurance_member_number: optionalText,
  insurance_plan: optionalText,
  fiscal_cuit: optionalBillingCuit,
  fiscal_vat_condition_id: optionalVatConditionId,
  fiscal_address: optionalFiscalText,
  fiscal_email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().email('Email fiscal del paciente inválido').max(200).nullable().optional(),
  ),
  billing_entity_id: optionalBillingEntityId,
  billing_display_name: optionalFiscalText,
  billing_legal_name: optionalFiscalText,
  billing_cuit: optionalBillingCuit,
  billing_vat_condition_id: optionalVatConditionId,
  billing_address: optionalFiscalText,
  billing_email: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.string().trim().email('Email de facturación inválido').max(200).nullable().optional(),
  ),
  billing_sale_condition: optionalSaleCondition,
  care_location: optionalText,
  default_price: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? null : value,
    z.coerce.number().nonnegative().nullable().optional()
  ),
  whatsapp_consent: checkboxBoolean,
  appointment_reminders_opt_in: checkboxBoolean,
});

function formDataToPatient(formData: FormData) {
  return patientSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    alias: formData.get('alias'),
    use_alias_for_communications: formData.get('use_alias_for_communications'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    dni: formData.get('dni'),
    insurance_name: formData.get('insurance_name'),
    insurance_member_number: formData.get('insurance_member_number'),
    insurance_plan: formData.get('insurance_plan'),
    fiscal_cuit: formData.get('fiscal_cuit'),
    fiscal_vat_condition_id: formData.get('fiscal_vat_condition_id'),
    fiscal_address: formData.get('fiscal_address'),
    fiscal_email: formData.get('fiscal_email'),
    billing_entity_id: formData.get('billing_entity_id'),
    billing_display_name: formData.get('billing_display_name'),
    billing_legal_name: formData.get('billing_legal_name'),
    billing_cuit: formData.get('billing_cuit'),
    billing_vat_condition_id: formData.get('billing_vat_condition_id'),
    billing_address: formData.get('billing_address'),
    billing_email: formData.get('billing_email'),
    billing_sale_condition: formData.get('billing_sale_condition'),
    care_location: formData.get('care_location'),
    default_price: formData.get('default_price'),
    whatsapp_consent: formData.get('whatsapp_consent'),
    appointment_reminders_opt_in: formData.get('appointment_reminders_opt_in'),
  });
}

async function resolveBillingEntity(params: {
  supabase: any;
  tenantId: string;
  updateSelected?: boolean;
  data: {
    insurance_name?: string | null;
    billing_entity_id?: string | null;
    billing_display_name?: string | null;
    billing_legal_name?: string | null;
    billing_cuit?: string | null;
    billing_vat_condition_id?: number | null;
    billing_address?: string | null;
    billing_email?: string | null;
    billing_sale_condition?: string | null;
  };
}): Promise<string | null> {
  const { supabase, tenantId, data, updateSelected = false } = params;

  if (data.billing_entity_id) {
    const { data: existing, error } = await supabase
      .from('billing_entities')
      .select('id')
      .eq('id', data.billing_entity_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle();

    if (error || !existing) {
      throw new Error('El pagador seleccionado no está disponible.');
    }

    const hasFiscalEdits = Boolean(
      data.billing_display_name ||
      data.billing_legal_name ||
      data.billing_cuit ||
      data.billing_vat_condition_id ||
      data.billing_address ||
      data.billing_email ||
      data.billing_sale_condition
    );

    if (updateSelected && hasFiscalEdits) {
      const updatePayload: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (data.billing_display_name) updatePayload.display_name = data.billing_display_name;
      if (data.billing_legal_name) updatePayload.legal_name = data.billing_legal_name;
      if (data.billing_cuit) updatePayload.cuit = data.billing_cuit;
      if (data.billing_vat_condition_id) {
        updatePayload.vat_condition_id = data.billing_vat_condition_id;
        updatePayload.vat_condition_label = vatConditionLabel(data.billing_vat_condition_id);
      }
      if (data.billing_address) updatePayload.commercial_address = data.billing_address;
      if (data.billing_email) updatePayload.billing_email = data.billing_email;
      if (data.billing_sale_condition) updatePayload.default_sale_condition = data.billing_sale_condition;

      const { error: updateError } = await supabase
        .from('billing_entities')
        .update(updatePayload)
        .eq('id', existing.id)
        .eq('tenant_id', tenantId);

      if (updateError) throw new Error('No se pudo actualizar el pagador.');
    }

    return existing.id as string;
  }

  const displayName =
    data.billing_display_name ??
    data.insurance_name ??
    data.billing_legal_name ??
    null;

  const hasNewBillingData = Boolean(
    displayName ||
    data.billing_cuit ||
    data.billing_legal_name ||
    data.billing_vat_condition_id ||
    data.billing_address ||
    data.billing_email
  );

  if (!hasNewBillingData) return null;
  if (!displayName) {
    throw new Error('Ingresá el nombre de la obra social o pagador.');
  }

  if (data.billing_cuit) {
    const { data: byCuit, error: lookupError } = await supabase
      .from('billing_entities')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('cuit', data.billing_cuit)
      .is('deleted_at', null)
      .maybeSingle();

    if (lookupError) throw new Error('No se pudo verificar el CUIT del pagador.');

    if (byCuit) {
      const { error: updateError } = await supabase
        .from('billing_entities')
        .update({
          display_name: displayName,
          legal_name: data.billing_legal_name ?? null,
          vat_condition_id: data.billing_vat_condition_id ?? null,
          vat_condition_label: vatConditionLabel(data.billing_vat_condition_id ?? null),
          commercial_address: data.billing_address ?? null,
          billing_email: data.billing_email ?? null,
          default_sale_condition: data.billing_sale_condition ?? 'cuenta_corriente',
          updated_at: new Date().toISOString(),
        })
        .eq('id', byCuit.id)
        .eq('tenant_id', tenantId);

      if (updateError) throw new Error('No se pudo actualizar el pagador.');
      return byCuit.id as string;
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('billing_entities')
    .insert({
      tenant_id: tenantId,
      kind: 'insurance',
      display_name: displayName,
      legal_name: data.billing_legal_name ?? null,
      cuit: data.billing_cuit ?? null,
      vat_condition_id: data.billing_vat_condition_id ?? null,
      vat_condition_label: vatConditionLabel(data.billing_vat_condition_id ?? null),
      commercial_address: data.billing_address ?? null,
      billing_email: data.billing_email ?? null,
      default_sale_condition: data.billing_sale_condition ?? 'cuenta_corriente',
    })
    .select('id')
    .single();

  if (insertError || !inserted) throw new Error('No se pudo guardar el pagador.');
  return inserted.id as string;
}

export async function createPatient(formData: FormData) {
  const parsed = formDataToPatient(formData);
  if (!parsed.success) {
    redirect(`/patients?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? 'Datos inválidos')}`);
  }

  const { supabase, tenantId } = await requireTenant();
  const {
    id: _id,
    billing_entity_id,
    billing_display_name,
    billing_legal_name,
    billing_cuit,
    billing_vat_condition_id,
    billing_address,
    billing_email,
    billing_sale_condition,
    ...payload
  } = parsed.data;

  const phoneNormalization = normalizePhone(payload.phone ?? null, { selectedPrefix: readSelectedPrefix(formData) });

  const duplicate = await findDuplicatePatient(supabase, {
    tenantId,
    email: payload.email ?? null,
    phoneE164: phoneNormalization.e164,
  });
  if (duplicate) redirect(`/patients?${duplicateRedirectQuery(duplicate)}`);

  let resolvedBillingEntityId: string | null = null;
  try {
    resolvedBillingEntityId = await resolveBillingEntity({
      supabase,
      tenantId,
      data: {
        insurance_name: payload.insurance_name ?? null,
        billing_entity_id: billing_entity_id ?? null,
        billing_display_name: billing_display_name ?? null,
        billing_legal_name: billing_legal_name ?? null,
        billing_cuit: billing_cuit ?? null,
        billing_vat_condition_id: billing_vat_condition_id ?? null,
        billing_address: billing_address ?? null,
        billing_email: billing_email ?? null,
        billing_sale_condition: billing_sale_condition ?? null,
      },
    });
  } catch (error) {
    redirect(`/patients?error=${encodeURIComponent(error instanceof Error ? error.message : 'No se pudo guardar el pagador')}`);
  }

  const { error } = await supabase.from('patients').insert({
    tenant_id: tenantId,
    ...payload,
    billing_entity_id: resolvedBillingEntityId,
    phone_e164: phoneNormalization.e164,
    whatsapp_consent_at: payload.whatsapp_consent ? new Date().toISOString() : null,
  });

  if (error) {
    redirect(`/patients?error=${encodeURIComponent('No se pudo crear el paciente')}`);
  }

  revalidatePath('/patients');
  redirect('/patients?success=created');
}

export async function updatePatient(formData: FormData) {
  const parsed = formDataToPatient(formData);
  if (!parsed.success || !parsed.data.id) {
    redirect('/patients?error=Datos%20inválidos');
  }

  const { supabase, tenantId } = await requireTenant();
  const {
    id,
    billing_entity_id,
    billing_display_name,
    billing_legal_name,
    billing_cuit,
    billing_vat_condition_id,
    billing_address,
    billing_email,
    billing_sale_condition,
    ...payload
  } = parsed.data;

  const phoneNormalization = normalizePhone(payload.phone ?? null, { selectedPrefix: readSelectedPrefix(formData) });

  const duplicate = await findDuplicatePatient(supabase, {
    tenantId,
    email: payload.email ?? null,
    phoneE164: phoneNormalization.e164,
    excludePatientId: id,
  });
  if (duplicate) redirect(`/patients/${id}?${duplicateRedirectQuery(duplicate)}`);

  // El timestamp de consentimiento sólo se actualiza en una transición real
  // false -> true (se guarda cuándo se otorgó), y se limpia si se revoca.
  // Si ya estaba en true y sigue en true, se conserva la fecha original.
  const { data: existing } = await supabase
    .from('patients')
    .select('whatsapp_consent, whatsapp_consent_at, billing_entity_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  let whatsappConsentAt: string | null = existing?.whatsapp_consent_at ?? null;
  if (payload.whatsapp_consent && !existing?.whatsapp_consent) {
    whatsappConsentAt = new Date().toISOString();
  } else if (!payload.whatsapp_consent) {
    whatsappConsentAt = null;
  }

  let resolvedBillingEntityId: string | null = null;
  try {
    resolvedBillingEntityId = await resolveBillingEntity({
      supabase,
      tenantId,
      updateSelected: Boolean(
        billing_entity_id &&
        existing?.billing_entity_id &&
        billing_entity_id === existing.billing_entity_id
      ),
      data: {
        insurance_name: payload.insurance_name ?? null,
        billing_entity_id: billing_entity_id ?? null,
        billing_display_name: billing_display_name ?? null,
        billing_legal_name: billing_legal_name ?? null,
        billing_cuit: billing_cuit ?? null,
        billing_vat_condition_id: billing_vat_condition_id ?? null,
        billing_address: billing_address ?? null,
        billing_email: billing_email ?? null,
        billing_sale_condition: billing_sale_condition ?? null,
      },
    });
  } catch (error) {
    redirect(`/patients/${id}?error=${encodeURIComponent(error instanceof Error ? error.message : 'No se pudo guardar el pagador')}`);
  }

  const { data, error } = await supabase
    .from('patients')
    .update({
      ...payload,
      billing_entity_id: resolvedBillingEntityId,
      phone_e164: phoneNormalization.e164,
      whatsapp_consent_at: whatsappConsentAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error || !data) {
    redirect(`/patients/${id}?error=${encodeURIComponent('No se pudo actualizar el paciente')}`);
  }

  revalidatePath('/patients');
  revalidatePath(`/patients/${id}`);
  redirect(`/patients/${id}?success=updated`);
}

// Fase 1 de auditoría clínica (ver supabase/migrations/20260918120000_clinical_audit_log.sql):
// archivar el paciente y registrar la auditoría ocurren dentro de la MISMA
// transacción, en la RPC `archive_patient_with_audit`. tenant_id y
// actor_user_id los resuelve la propia función desde auth.uid() +
// tenant_members — nunca se los mandamos desde acá. Mismos mensajes/redirects
// que antes; sólo cambia cómo se escribe el archivado.
export async function archivePatient(formData: FormData) {
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) redirect('/patients?error=Paciente%20inválido');

  const { supabase } = await requireTenant();

  const { data, error } = await supabase
    .rpc('archive_patient_with_audit', { p_patient_id: id.data })
    .single()
    .returns<ArchivePatientRpcResult>();

  // Nunca se loguean datos clínicos ni parámetros de negocio acá — sólo
  // code/message técnicos de Supabase, mismo criterio que
  // lib/export/response.ts y lib/appointments/public-token.ts.
  if (error) {
    console.error('[patients] archive_patient_with_audit failed', { code: error.code, message: error.message });
  }

  if (error || !data?.ok) {
    redirect(`/patients/${id.data}?error=${encodeURIComponent('No se pudo archivar el paciente')}`);
  }

  revalidatePath('/patients');
  redirect('/patients?success=archived');
}

// Sesiones y Seguimientos son la misma tabla (`patient_follow_ups`) —
// `appointment_id` sigue siendo la fuente estructural de verdad (presente
// para sesión, null para seguimiento general); la UI distingue una de otra
// exclusivamente por `appointment_id IS NOT NULL`, nunca por `source_type`.
//
// Fase 1 de auditoría clínica: crear la nota y registrar la auditoría
// ocurren dentro de la MISMA transacción, en la RPC
// `create_patient_follow_up_with_audit` (ver la migración citada arriba).
// Esa RPC hace internamente las mismas validaciones de paciente/turno que
// antes hacía este archivo por separado — ya no se repiten acá.
//
// source_type: la RPC siempre inserta 'manual_text' — es el único valor del
// CHECK real de patient_follow_ups.source_type (`IN ('manual_text',
// 'voice_note')`) compatible con una carga manual. Los valores anteriores de
// este archivo ('manual_session' / 'manual_follow_up') NO existen en el
// schema real y hubieran fallado contra la base — se corrigen acá, sin tocar
// Voice Notes ni el valor 'voice_note'.
export async function createManualFollowUp(formData: FormData) {
  const parsed = z.object({
    patientId: z.string().uuid(),
    content: z.string().trim().min(2, 'La nota no puede estar vacía').max(10000),
    appointmentId: z.preprocess(
      (value) => (
        value == null || (typeof value === 'string' && value.trim() === '')
          ? undefined
          : value
      ),
      z.string().uuid().optional(),
    ),
  }).safeParse({
    patientId: formData.get('patientId'),
    content: formData.get('content'),
    appointmentId: formData.get('appointmentId'),
  });

  if (!parsed.success) {
    redirect('/patients?error=Nota%20inválida');
  }

  const { supabase } = await requireTenant();

  const { data, error } = await supabase
    .rpc('create_patient_follow_up_with_audit', {
      p_patient_id: parsed.data.patientId,
      p_content: parsed.data.content,
      p_appointment_id: parsed.data.appointmentId ?? null,
    })
    .single()
    .returns<CreatePatientFollowUpRpcResult>();

  if (error) {
    console.error('[patients] create_patient_follow_up_with_audit failed', { code: error.code, message: error.message });
    redirect(`/patients/${parsed.data.patientId}?error=${encodeURIComponent('No se pudo guardar la nota')}`);
  }

  if (!data?.ok) {
    if (data?.reason === 'appointment_invalid') {
      redirect(`/patients/${parsed.data.patientId}?error=${encodeURIComponent('El turno seleccionado no es válido')}`);
    }
    redirect('/patients?error=Paciente%20no%20disponible');
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  redirect(`/patients/${parsed.data.patientId}?success=followup`);
}

// Ficha clínica: información general y relativamente estable del paciente.
// Se edita directamente acá (upsert por patient_id + tenant_id) — a
// diferencia de antes, NO depende de que existan seguimientos cargados.
//
// Fase 1 de auditoría clínica: el upsert de patient_records y su registro en
// clinical_audit_log ocurren dentro de la MISMA transacción, en la RPC
// `upsert_patient_record_with_audit` (ver
// supabase/migrations/20260918120000_clinical_audit_log.sql). Esa RPC valida
// paciente/tenant internamente — ya no se repite ese select acá.
//
// `patient_records.follow_up` existe en la base real pero este flujo NUNCA
// lo lee ni lo escribe (no está en el Zod de abajo, no se manda a la RPC,
// que a su vez tampoco lo toca) — se preserva exactamente el comportamiento
// actual. Si en el futuro se habilita follow_up en la ficha clínica, hay que
// ampliar este formulario/Zod Y la RPC (y su allowlist de auditoría) juntos,
// en una migración aparte.
export async function upsertPatientRecord(formData: FormData) {
  const optional = z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(10000).nullable().optional(),
  );

  const parsed = z.object({
    patientId: z.string().uuid(),
    reason: optional,
    background: optional,
    diagnosis: optional,
    plan: optional,
    notes: optional,
  }).safeParse({
    patientId: formData.get('patientId'),
    reason: formData.get('reason'),
    background: formData.get('background'),
    diagnosis: formData.get('diagnosis'),
    plan: formData.get('plan'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    redirect('/patients?error=Ficha%20cl%C3%ADnica%20inv%C3%A1lida');
  }

  const { supabase } = await requireTenant();

  const { data, error } = await supabase
    .rpc('upsert_patient_record_with_audit', {
      p_patient_id: parsed.data.patientId,
      p_reason: parsed.data.reason ?? null,
      p_background: parsed.data.background ?? null,
      p_diagnosis: parsed.data.diagnosis ?? null,
      p_plan: parsed.data.plan ?? null,
      p_notes: parsed.data.notes ?? null,
    })
    .single()
    .returns<UpsertPatientRecordRpcResult>();

  if (error) {
    console.error('[patients] upsert_patient_record_with_audit failed', { code: error.code, message: error.message });
    redirect(`/patients/${parsed.data.patientId}?error=${encodeURIComponent('No se pudo guardar la ficha clínica')}`);
  }

  if (!data?.ok) {
    redirect('/patients?error=Paciente%20no%20disponible');
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  redirect(`/patients/${parsed.data.patientId}?success=record`);
}
