import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { getMisRxAdapterForUser, isMisRxProviderConfigured } from '@/lib/misrx/service';
import {
  getMisRxHomologationConfig,
  isMisRxProductionIssuingEnabled,
} from '@/lib/misrx/homologation';
import { getMisRxMaxProducts } from '@/lib/misrx/convention-rules';
import { checkRateLimit } from '@/lib/rate-limit';
import type { MisRxConvention, MisRxPlan, MisRxProfessionalProfile } from '@/lib/misrx/types';

function todayIsoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function providerStatusOk(value: string | undefined) {
  return value?.trim().toUpperCase() === 'OK';
}

function digits(value: string | null | undefined) {
  return value?.replace(/\D/g, '') ?? '';
}

function positiveRule(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function doctorPayload(profile: MisRxProfessionalProfile) {
  const sex = profile.sexo?.trim().toUpperCase();
  const medicoSexo = sex === 'M' || sex === 'F' || sex === 'X' ? sex : 'X';

  return {
    medico_dni: Number(profile.nrodoc),
    medico_tipo_matricula: profile.tipo_matricula.trim(),
    medico_matricula: Number(profile.matricula),
    medico_especialidad_id: Number(profile.especialidad_id),
    medico_apellido: profile.apellido?.trim() || undefined,
    medico_nombres: profile.nombres?.trim() || undefined,
    medico_sexo: medicoSexo as 'M' | 'F' | 'X',
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params;
  const { supabase, tenantId, user } = await requireTenant();

  if (!isServiceRoleConfigured() || !isMisRxProviderConfigured()) {
    return NextResponse.json(
      { error: 'La integración MisRX no está completamente configurada.' },
      { status: 503 },
    );
  }

  const limit = await checkRateLimit({
    scope: 'misrx-issue-user',
    key: user.id,
    windowSeconds: 60,
    maxCount: 5,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos de emisión. Esperá unos segundos y volvé a intentar.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,patient_id,professional_id,status,convention_id,plan_id,affiliate_id,diagnosis,cie10,observations,long_term_treatment')
    .eq('id', prescriptionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!prescription) {
    return NextResponse.json({ error: 'Borrador no encontrado.' }, { status: 404 });
  }

  if (prescription.professional_id !== user.id) {
    return NextResponse.json({ error: 'No tenés permiso para emitir esta receta.' }, { status: 403 });
  }

  if (prescription.status !== 'draft') {
    return NextResponse.json(
      { error: 'La receta ya no está disponible para una nueva emisión.' },
      { status: 409 },
    );
  }

  if (!prescription.convention_id) {
    return NextResponse.json({ error: 'Falta seleccionar el convenio.' }, { status: 400 });
  }

  if (!prescription.affiliate_id) {
    return NextResponse.json(
      { error: 'Seleccioná primero el afiliado devuelto por MisRX.' },
      { status: 400 },
    );
  }

  const homologation = getMisRxHomologationConfig();
  const homologationActive = Boolean(
    homologation.enabled &&
    homologation.conventionId &&
    prescription.convention_id === homologation.conventionId
  );

  if (homologationActive) {
    if (!homologation.issuingEnabled) {
      return NextResponse.json(
        { error: 'La emisión de homologación está bloqueada por configuración.' },
        { status: 403 },
      );
    }

    if (!homologation.doctorId) {
      return NextResponse.json(
        { error: 'Falta medico_id de homologación.' },
        { status: 503 },
      );
    }
  } else if (!isMisRxProductionIssuingEnabled()) {
    return NextResponse.json(
      { error: 'La emisión productiva MisRX está bloqueada por configuración.' },
      { status: 403 },
    );
  }

  const service = createSupabaseServiceClient();
  const [{ data: patient }, { data: items, error: itemsError }] = await Promise.all([
    supabase
      .from('patients')
      .select('id,dni,birth_date,sex,insurance_member_number')
      .eq('id', prescription.patient_id)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
    service
      .from('prescription_items')
      .select('provider_product_id,quantity,coverage_percentage,print_brand,substitutable,diagnosis,cie10')
      .eq('prescription_id', prescription.id)
      .order('created_at', { ascending: true }),
  ]);

  if (!patient) {
    return NextResponse.json({ error: 'Paciente no encontrado.' }, { status: 404 });
  }

  if (itemsError || !items?.length) {
    return NextResponse.json(
      { error: 'La receta necesita al menos un medicamento válido.' },
      { status: 400 },
    );
  }

  const maxProducts = getMisRxMaxProducts(prescription.convention_id);
  if (maxProducts && items.length > maxProducts) {
    return NextResponse.json(
      { error: `Este convenio admite como máximo ${maxProducts} medicamentos por receta.` },
      { status: 400 },
    );
  }

  const invalidItem = items.some((item) =>
    !item.provider_product_id ||
    !/^\d+$/.test(String(item.provider_product_id)) ||
    Number(item.quantity) <= 0
  );

  if (invalidItem) {
    return NextResponse.json(
      { error: 'Hay medicamentos sin identificador MisRX o cantidad válida.' },
      { status: 400 },
    );
  }

  if (homologationActive) {
    const expectedDni = digits(homologation.patientDni);
    const currentDni = digits(patient.dni);
    const expectedCredential = homologation.patientCredential?.trim() ?? '';
    const currentCredential = patient.insurance_member_number?.trim() ?? '';

    if (
      !expectedDni ||
      !expectedCredential ||
      currentDni !== expectedDni ||
      currentCredential !== expectedCredential
    ) {
      return NextResponse.json(
        { error: 'El paciente no coincide con el DNI/credencial configurados para homologación.' },
        { status: 400 },
      );
    }
  }

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const adapter = adapterResult.data;
  const sessionResult = await adapter.testSession();
  if (!sessionResult.ok) {
    return NextResponse.json(
      { error: 'La sesión MisRX no pudo validarse antes de emitir.' },
      { status: sessionResult.status ?? 502 },
    );
  }

  const externalProviderResult = homologationActive
    ? await adapter.verifyExternalProvider()
    : null;
  const productionPrescriberResult = homologationActive
    ? null
    : await adapter.verifyPrescriber();

  const prescriberError = externalProviderResult && !externalProviderResult.ok
    ? externalProviderResult
    : productionPrescriberResult && !productionPrescriberResult.ok
      ? productionPrescriberResult
      : null;

  if (prescriberError) {
    return NextResponse.json(
      { error: prescriberError.errorMessage },
      { status: prescriberError.status ?? 403 },
    );
  }

  const verifiedUsuarioId = externalProviderResult?.ok
    ? externalProviderResult.data.usuarioId
    : productionPrescriberResult?.ok
      ? productionPrescriberResult.data.usuarioId
      : undefined;
  const verifiedPropioId = externalProviderResult?.ok
    ? externalProviderResult.data.propioId
    : productionPrescriberResult?.ok
      ? productionPrescriberResult.data.propioId
      : undefined;

  const conventionsResult = await adapter.getEnabledConventions('');
  let convention: MisRxConvention | undefined;

  if (conventionsResult.ok) {
    convention = conventionsResult.data.data.find(
      (item) =>
        Number(item.convenio_id) === Number(prescription.convention_id) &&
        (item.autorizado == null || Number(item.autorizado) !== 0)
    );
  }

  if (!convention && homologationActive) {
    convention = {
      convenio_id: prescription.convention_id,
      nombre: 'Homologación MisRX',
      autorizado: 1,
    };
  }

  if (!convention) {
    return NextResponse.json(
      {
        error: conventionsResult.ok
          ? 'El convenio seleccionado no figura habilitado para el profesional en MisRX.'
          : 'No se pudo comprobar en MisRX que el convenio siga habilitado.',
      },
      { status: conventionsResult.ok ? 400 : conventionsResult.status ?? 502 },
    );
  }

  if (Number(convention.digital_indica_prestador ?? 0) !== 0) {
    return NextResponse.json(
      { error: 'Este convenio exige seleccionar una institución prestadora y ese flujo todavía no está habilitado en TurnIA.' },
      { status: 400 },
    );
  }

  const hasDiagnosis = Boolean(prescription.diagnosis?.trim() || prescription.cie10?.trim());
  const hasCie10 = Boolean(prescription.cie10?.trim());

  if (convention.diagnostico_requerido) {
    if (convention.solo_cie10 ? !hasCie10 : !hasDiagnosis) {
      return NextResponse.json(
        { error: convention.solo_cie10 ? 'Este convenio exige código CIE-10.' : 'Este convenio exige diagnóstico o CIE-10.' },
        { status: 400 },
      );
    }
  }

  if (convention.diagnostico_por_producto && !hasDiagnosis) {
    return NextResponse.json(
      { error: 'Este convenio exige diagnóstico por producto. Cargá diagnóstico o CIE-10.' },
      { status: 400 },
    );
  }

  if (convention.posologia_requierida && !prescription.observations?.trim()) {
    return NextResponse.json(
      { error: 'Este convenio requiere posología/notas.' },
      { status: 400 },
    );
  }

  if (
    convention.permite_sustitucion === false &&
    items.some((item) => item.substitutable === true)
  ) {
    return NextResponse.json(
      { error: 'Este convenio no permite sustitución de medicamentos.' },
      { status: 400 },
    );
  }

  if (convention.digital_elige_plan && !prescription.plan_id) {
    return NextResponse.json(
      { error: 'Este convenio exige seleccionar un plan.' },
      { status: 400 },
    );
  }

  let selectedPlan: MisRxPlan | undefined;
  let conventionPlanCode: number | undefined;

  if (prescription.plan_id) {
    const plansResult = await adapter.getPlans({
      convenioId: prescription.convention_id,
      affiliateId: prescription.affiliate_id,
    });

    if (!plansResult.ok) {
      return NextResponse.json(
        { error: 'No se pudo validar el plan seleccionado con MisRX.' },
        { status: plansResult.status ?? 502 },
      );
    }

    selectedPlan = plansResult.data.data.find(
      (plan) => Number(plan.plan_id) === Number(prescription.plan_id),
    );

    if (!selectedPlan) {
      return NextResponse.json(
        { error: 'El plan guardado ya no está disponible para este afiliado y convenio.' },
        { status: 400 },
      );
    }

    if (selectedPlan.convenio_plan_cod != null) {
      conventionPlanCode = Number(selectedPlan.convenio_plan_cod);
    }

    const planItemLimit = positiveRule(selectedPlan.regla_items_por_receta);
    if (planItemLimit && items.length > planItemLimit) {
      return NextResponse.json(
        { error: `El plan admite como máximo ${planItemLimit} medicamento(s) por receta.` },
        { status: 400 },
      );
    }

    const planUnitLimit = positiveRule(selectedPlan.regla_unidades_por_receta);
    const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (planUnitLimit && totalUnits > planUnitLimit) {
      return NextResponse.json(
        { error: `El plan admite como máximo ${planUnitLimit} unidad(es) por receta.` },
        { status: 400 },
      );
    }
  }

  const { data: locked, error: lockError } = await supabase
    .from('prescriptions')
    .update({
      status: 'sending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', prescription.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();

  if (lockError || !locked) {
    return NextResponse.json(
      { error: 'La receta cambió de estado antes de emitir. Volvé a verificarla.' },
      { status: 409 },
    );
  }

  const eventPrefix = homologationActive ? 'homologation' : 'misrx';

  await service.from('prescription_events').insert({
    prescription_id: prescription.id,
    event_type: `${eventPrefix}_send_started`,
    metadata: {
      convention_id: prescription.convention_id,
      doctor_id: homologationActive ? homologation.doctorId ?? null : null,
      verified_misrx_usuario_id: verifiedUsuarioId ?? null,
      verified_misrx_propio_id: verifiedPropioId ?? null,
      item_count: items.length,
      plan_id: prescription.plan_id ?? null,
      convenio_plan_cod: conventionPlanCode ?? null,
    },
  });

  const productionProfile = productionPrescriberResult?.ok
    ? productionPrescriberResult.data.profile
    : null;

  if (!homologationActive && !productionProfile) {
    return NextResponse.json(
      { error: 'No se pudo resolver la identidad profesional para emitir.' },
      { status: 403 },
    );
  }

  const professionalData = homologationActive
    ? { medico_id: homologation.doctorId ?? undefined }
    : doctorPayload(productionProfile!);

  const planCoverage = typeof selectedPlan?.porc_cobertura === 'number'
    ? selectedPlan.porc_cobertura
    : undefined;

  const result = await adapter.issuePrescription({
    convenio_id: prescription.convention_id,
    ...professionalData,
    afiliado_id: prescription.affiliate_id,
    diagnostico: prescription.diagnosis ?? undefined,
    tProlongado: Boolean(prescription.long_term_treatment),
    convenio_plan_cod: conventionPlanCode,
    observaciones: prescription.observations ?? undefined,
    fecha_receta: todayIsoDate(),
    items: items.map((item) => ({
      producto_id: Number(item.provider_product_id),
      cantidad: Number(item.quantity),
      porc_cobertura:
        planCoverage ??
        (item.coverage_percentage == null ? undefined : Number(item.coverage_percentage)),
      imprimeMarca: Boolean(item.print_brand),
      sustituible: convention.permite_sustitucion === false
        ? false
        : item.substitutable == null
          ? true
          : Boolean(item.substitutable),
      diagnostico: item.diagnosis ?? prescription.diagnosis ?? undefined,
      cie10: item.cie10 ?? prescription.cie10 ?? undefined,
      solo_codigo_cie10: true,
    })),
  });

  if (!result.ok) {
    await supabase
      .from('prescriptions')
      .update({
        status: 'error',
        provider_status: 'ERROR',
        provider_status_description: result.errorMessage.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', prescription.id)
      .eq('tenant_id', tenantId)
      .eq('professional_id', user.id);

    await service.from('prescription_events').insert({
      prescription_id: prescription.id,
      event_type: `${eventPrefix}_send_error`,
      provider_status: 'ERROR',
      provider_message: result.errorMessage.slice(0, 1000),
      metadata: { status: result.status ?? null },
    });

    return NextResponse.json(
      { error: result.errorMessage },
      { status: result.status ?? 502 },
    );
  }

  const accepted = providerStatusOk(result.data.status);
  const itemRejected = result.data.items?.some(
    (item) => item.status && !providerStatusOk(item.status)
  ) ?? false;
  const finalStatus = accepted && !itemRejected ? 'issued' : 'rejected';
  const now = new Date().toISOString();

  const providerPrescriptionNumber =
    result.data.nrorecetario ??
    result.data.nrorecetario_receta ??
    result.data.nrorecetario_os ??
    null;

  await supabase
    .from('prescriptions')
    .update({
      status: finalStatus,
      provider_prescription_number: providerPrescriptionNumber,
      provider_token: result.data.token ?? null,
      provider_status: result.data.status ?? null,
      provider_status_description: result.data.msg ?? null,
      issued_at: finalStatus === 'issued' ? now : null,
      updated_at: now,
    })
    .eq('id', prescription.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id);

  await service.from('prescription_events').insert({
    prescription_id: prescription.id,
    event_type: `${eventPrefix}_${finalStatus === 'issued' ? 'issued' : 'rejected'}`,
    provider_status: result.data.status ?? null,
    provider_message: result.data.msg ?? null,
    metadata: {
      nrorecetario: result.data.nrorecetario ?? null,
      nrorecetario_os: result.data.nrorecetario_os ?? null,
      nrorecetario_receta: result.data.nrorecetario_receta ?? null,
      token_present: Boolean(result.data.token),
      items: result.data.items ?? [],
    },
  });

  return NextResponse.json({
    ok: finalStatus === 'issued',
    status: finalStatus,
    providerStatus: result.data.status ?? null,
    message: result.data.msg ?? null,
    prescriptionNumber: providerPrescriptionNumber,
    tokenPresent: Boolean(result.data.token),
    items: result.data.items ?? [],
  }, {
    status: finalStatus === 'issued' ? 200 : 422,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
