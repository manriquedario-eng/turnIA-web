'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireTenant } from '@/lib/auth/require-user';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { getMisRxMaxProducts } from '@/lib/misrx/convention-rules';

const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable().optional(),
  );

const draftSchema = z.object({
  patientId: z.string().uuid(),
  diagnosis: optionalText(500),
  cie10: optionalText(20),
  observations: optionalText(4000),
  longTermTreatment: z.preprocess(
    (value) => value === 'on' || value === 'true' || value === true,
    z.boolean(),
  ),
});

export async function createPrescriptionDraft(formData: FormData) {
  const parsed = draftSchema.safeParse({
    patientId: formData.get('patientId'),
    diagnosis: formData.get('diagnosis'),
    cie10: formData.get('cie10'),
    observations: formData.get('observations'),
    longTermTreatment: formData.get('longTermTreatment'),
  });

  if (!parsed.success) {
    redirect('/prescriptions?error=Datos%20de%20receta%20inv%C3%A1lidos');
  }

  const { supabase, tenantId, user } = await requireTenant();

  const { data: patient } = await supabase
    .from('patients')
    .select('id')
    .eq('id', parsed.data.patientId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!patient) {
    redirect('/prescriptions?error=Paciente%20no%20disponible');
  }

  const { data: prescription, error } = await supabase
    .from('prescriptions')
    .insert({
      tenant_id: tenantId,
      professional_id: user.id,
      patient_id: patient.id,
      provider: 'misrx',
      status: 'draft',
      diagnosis: parsed.data.diagnosis ?? null,
      cie10: parsed.data.cie10 ?? null,
      observations: parsed.data.observations ?? null,
      long_term_treatment: parsed.data.longTermTreatment,
      prescribed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !prescription) {
    console.error('[misrx] create draft failed', {
      code: error?.code,
      message: error?.message,
    });
    redirect(
      `/prescriptions?patient=${parsed.data.patientId}&error=${encodeURIComponent('No se pudo crear el borrador de receta')}`,
    );
  }

  revalidatePath('/prescriptions');
  revalidatePath(`/patients/${parsed.data.patientId}`);
  redirect(`/patients/${parsed.data.patientId}/prescriptions/${prescription.id}`);
}


const itemSchema = z.object({
  patientId: z.string().uuid(),
  prescriptionId: z.string().uuid(),
  conventionId: z.coerce.number().int().positive(),
  providerProductId: z.string().trim().regex(/^\d+$/, 'Producto inválido'),
  providerProductCode: optionalText(120),
  brand: optionalText(240),
  genericName: optionalText(240),
  presentation: optionalText(240),
  potency: optionalText(120),
  laboratory: optionalText(240),
  quantity: z.coerce.number().positive().max(100),
  coveragePercentage: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.coerce.number().min(0).max(100).nullable().optional(),
  ),
  printBrand: z.preprocess(
    (value) => value === 'on' || value === 'true' || value === true,
    z.boolean(),
  ),
  substitutable: z.preprocess(
    (value) => value === 'on' || value === 'true' || value === true,
    z.boolean(),
  ),
});

export async function addPrescriptionItem(formData: FormData) {
  const parsed = itemSchema.safeParse({
    patientId: formData.get('patientId'),
    prescriptionId: formData.get('prescriptionId'),
    conventionId: formData.get('conventionId'),
    providerProductId: formData.get('providerProductId'),
    providerProductCode: formData.get('providerProductCode'),
    brand: formData.get('brand'),
    genericName: formData.get('genericName'),
    presentation: formData.get('presentation'),
    potency: formData.get('potency'),
    laboratory: formData.get('laboratory'),
    quantity: formData.get('quantity'),
    coveragePercentage: formData.get('coveragePercentage'),
    printBrand: formData.get('printBrand'),
    substitutable: formData.get('substitutable'),
  });

  if (!parsed.success) {
    redirect(
      `/patients/${String(formData.get('patientId') ?? '')}/prescriptions/${String(formData.get('prescriptionId') ?? '')}?error=${encodeURIComponent('Medicamento inválido')}`,
    );
  }

  const { supabase, tenantId, user } = await requireTenant();
  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,patient_id,status,professional_id')
    .eq('id', parsed.data.prescriptionId)
    .eq('tenant_id', tenantId)
    .eq('patient_id', parsed.data.patientId)
    .maybeSingle();

  if (
    !prescription ||
    prescription.status !== 'draft' ||
    prescription.professional_id !== user.id
  ) {
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('El borrador no está disponible para editar')}`,
    );
  }

  if (!isServiceRoleConfigured()) {
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('Configuración del servidor incompleta')}`,
    );
  }

  const maxProducts = getMisRxMaxProducts(parsed.data.conventionId);
  if (maxProducts) {
    const service = createSupabaseServiceClient();
    const { count, error: countError } = await service
      .from('prescription_items')
      .select('id', { count: 'exact', head: true })
      .eq('prescription_id', prescription.id);

    if (countError) {
      console.error('[misrx] count prescription items failed', {
        code: countError.code,
        message: countError.message,
      });
      redirect(
        `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('No se pudo validar el límite de medicamentos')}`,
      );
    }

    if ((count ?? 0) >= maxProducts) {
      redirect(
        `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent(`Este convenio admite como máximo ${maxProducts} medicamentos por receta`)}`,
      );
    }
  }

  const { error: conventionError } = await supabase
    .from('prescriptions')
    .update({
      convention_id: parsed.data.conventionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', prescription.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .eq('status', 'draft');

  if (conventionError) {
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('No se pudo guardar el convenio')}`,
    );
  }

  const service = createSupabaseServiceClient();
  const { error: itemError } = await service
    .from('prescription_items')
    .insert({
      prescription_id: prescription.id,
      provider_product_id: parsed.data.providerProductId,
      provider_product_code: parsed.data.providerProductCode ?? null,
      brand: parsed.data.brand ?? null,
      generic_name: parsed.data.genericName ?? null,
      presentation: parsed.data.presentation ?? null,
      potency: parsed.data.potency ?? null,
      laboratory: parsed.data.laboratory ?? null,
      quantity: parsed.data.quantity,
      coverage_percentage: parsed.data.coveragePercentage ?? null,
      print_brand: parsed.data.printBrand,
      substitutable: parsed.data.substitutable,
    });

  if (itemError) {
    console.error('[misrx] add prescription item failed', {
      code: itemError.code,
      message: itemError.message,
    });
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('No se pudo agregar el medicamento')}`,
    );
  }

  revalidatePath('/prescriptions');
  revalidatePath(`/patients/${parsed.data.patientId}`);
  revalidatePath(`/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}`);
  redirect(
    `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?success=item-added`,
  );
}

export async function removePrescriptionItem(formData: FormData) {
  const parsed = z.object({
    patientId: z.string().uuid(),
    prescriptionId: z.string().uuid(),
    itemId: z.string().uuid(),
  }).safeParse({
    patientId: formData.get('patientId'),
    prescriptionId: formData.get('prescriptionId'),
    itemId: formData.get('itemId'),
  });

  if (!parsed.success) redirect('/patients?error=Medicamento%20inv%C3%A1lido');

  const { supabase, tenantId, user } = await requireTenant();
  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,status,professional_id')
    .eq('id', parsed.data.prescriptionId)
    .eq('tenant_id', tenantId)
    .eq('patient_id', parsed.data.patientId)
    .maybeSingle();

  if (
    !prescription ||
    prescription.status !== 'draft' ||
    prescription.professional_id !== user.id ||
    !isServiceRoleConfigured()
  ) {
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('El borrador no está disponible para editar')}`,
    );
  }

  const service = createSupabaseServiceClient();
  const { error } = await service
    .from('prescription_items')
    .delete()
    .eq('id', parsed.data.itemId)
    .eq('prescription_id', prescription.id);

  if (error) {
    console.error('[misrx] remove prescription item failed', {
      code: error.code,
      message: error.message,
    });
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('No se pudo quitar el medicamento')}`,
    );
  }

  revalidatePath(`/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}`);
  redirect(
    `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?success=item-removed`,
  );
}


const metadataSchema = z.object({
  patientId: z.string().uuid(),
  prescriptionId: z.string().uuid(),
  conventionId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.coerce.number().int().positive().nullable().optional(),
  ),
  affiliateId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.coerce.number().int().positive().nullable().optional(),
  ),
  planId: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.coerce.number().int().positive().nullable().optional(),
  ),
  diagnosis: optionalText(500),
  cie10: optionalText(20),
  observations: optionalText(4000),
  longTermTreatment: z.preprocess(
    (value) => value === 'on' || value === 'true' || value === true,
    z.boolean(),
  ),
});

export async function updatePrescriptionDraftMetadata(formData: FormData) {
  const parsed = metadataSchema.safeParse({
    patientId: formData.get('patientId'),
    prescriptionId: formData.get('prescriptionId'),
    conventionId: formData.get('conventionId'),
    affiliateId: formData.get('affiliateId'),
    planId: formData.get('planId'),
    diagnosis: formData.get('diagnosis'),
    cie10: formData.get('cie10'),
    observations: formData.get('observations'),
    longTermTreatment: formData.get('longTermTreatment'),
  });

  if (!parsed.success) {
    redirect('/patients?error=Datos%20de%20receta%20inv%C3%A1lidos');
  }

  const { supabase, tenantId, user } = await requireTenant();
  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,status,professional_id')
    .eq('id', parsed.data.prescriptionId)
    .eq('tenant_id', tenantId)
    .eq('patient_id', parsed.data.patientId)
    .maybeSingle();

  if (
    !prescription ||
    prescription.status !== 'draft' ||
    prescription.professional_id !== user.id
  ) {
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('El borrador no está disponible para editar')}`,
    );
  }

  const maxProducts = getMisRxMaxProducts(parsed.data.conventionId ?? null);
  if (maxProducts && isServiceRoleConfigured()) {
    const service = createSupabaseServiceClient();
    const { count, error: countError } = await service
      .from('prescription_items')
      .select('id', { count: 'exact', head: true })
      .eq('prescription_id', prescription.id);

    if (countError) {
      console.error('[misrx] validate convention item limit failed', {
        code: countError.code,
        message: countError.message,
      });
      redirect(
        `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('No se pudo validar el convenio')}`,
      );
    }

    if ((count ?? 0) > maxProducts) {
      redirect(
        `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent(`Este convenio admite como máximo ${maxProducts} medicamentos por receta`)}`,
      );
    }
  }

  const { error } = await supabase
    .from('prescriptions')
    .update({
      convention_id: parsed.data.conventionId ?? null,
      affiliate_id: parsed.data.affiliateId ?? null,
      plan_id: parsed.data.planId ?? null,
      diagnosis: parsed.data.diagnosis ?? null,
      cie10: parsed.data.cie10 ?? null,
      observations: parsed.data.observations ?? null,
      long_term_treatment: parsed.data.longTermTreatment,
      updated_at: new Date().toISOString(),
    })
    .eq('id', prescription.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .eq('status', 'draft');

  if (error) {
    console.error('[misrx] update draft metadata failed', {
      code: error.code,
      message: error.message,
    });
    redirect(
      `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?error=${encodeURIComponent('No se pudo actualizar el borrador')}`,
    );
  }

  revalidatePath(`/patients/${parsed.data.patientId}`);
  revalidatePath(`/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}`);
  redirect(
    `/patients/${parsed.data.patientId}/prescriptions/${parsed.data.prescriptionId}?success=metadata-updated`,
  );
}
