import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { getMisRxAdapterForUser, isMisRxProviderConfigured } from '@/lib/misrx/service';
import { getMisRxHomologationConfig } from '@/lib/misrx/homologation';
import { getMisRxMaxProducts } from '@/lib/misrx/convention-rules';
import { checkRateLimit } from '@/lib/rate-limit';

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

  const homologation = getMisRxHomologationConfig();
  if (!homologation.enabled || !homologation.issuingEnabled) {
    return NextResponse.json(
      { error: 'La emisión de homologación está bloqueada por configuración.' },
      { status: 403 },
    );
  }

  if (!homologation.conventionId || !homologation.doctorId) {
    return NextResponse.json(
      { error: 'Faltan convenio o medico_id de homologación.' },
      { status: 503 },
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

  if (prescription.convention_id !== homologation.conventionId) {
    return NextResponse.json(
      { error: 'Este endpoint sólo permite el convenio configurado para homologación.' },
      { status: 400 },
    );
  }

  if (!prescription.affiliate_id) {
    return NextResponse.json(
      { error: 'Para homologación seleccioná primero el afiliado devuelto por MisRX.' },
      { status: 400 },
    );
  }

  const service = createSupabaseServiceClient();
  const { data: items, error: itemsError } = await service
    .from('prescription_items')
    .select('provider_product_id,quantity,coverage_percentage,print_brand,substitutable,diagnosis,cie10')
    .eq('prescription_id', prescription.id)
    .order('created_at', { ascending: true });

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

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const sessionResult = await adapterResult.data.testSession();
  if (!sessionResult.ok) {
    return NextResponse.json(
      { error: 'La sesión MisRX no pudo validarse antes de emitir.' },
      { status: sessionResult.status ?? 502 },
    );
  }

  const prescriberResult = await adapterResult.data.verifyPrescriber();
  if (!prescriberResult.ok) {
    return NextResponse.json(
      { error: prescriberResult.errorMessage },
      { status: prescriberResult.status ?? 403 },
    );
  }

  let conventionPlanCode: number | undefined;
  if (prescription.plan_id) {
    const plansResult = await adapterResult.data.getPlans({
      convenioId: prescription.convention_id,
      affiliateId: prescription.affiliate_id,
    });

    if (!plansResult.ok) {
      return NextResponse.json(
        { error: 'No se pudo validar el plan seleccionado con MisRX.' },
        { status: plansResult.status ?? 502 },
      );
    }

    const selectedPlan = plansResult.data.data.find(
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

  await service.from('prescription_events').insert({
    prescription_id: prescription.id,
    event_type: 'homologation_send_started',
    metadata: {
      convention_id: prescription.convention_id,
      doctor_id: homologation.doctorId,
      verified_misrx_usuario_id: prescriberResult.data.usuarioId ?? null,
      verified_misrx_propio_id: prescriberResult.data.propioId ?? null,
      verified_professional_dni: prescriberResult.data.profile.nrodoc,
      verified_professional_matricula_tipo: prescriberResult.data.profile.tipo_matricula,
      verified_professional_matricula: prescriberResult.data.profile.matricula,
      verified_professional_especialidad_id: prescriberResult.data.profile.especialidad_id,
      item_count: items.length,
      plan_id: prescription.plan_id ?? null,
      convenio_plan_cod: conventionPlanCode ?? null,
    },
  });

  const result = await adapterResult.data.issuePrescription({
    convenio_id: prescription.convention_id,
    medico_id: homologation.doctorId,
    afiliado_id: prescription.affiliate_id,
    diagnostico: prescription.diagnosis ?? undefined,
    tProlongado: Boolean(prescription.long_term_treatment),
    convenio_plan_cod: conventionPlanCode,
    observaciones: prescription.observations ?? undefined,
    fecha_receta: todayIsoDate(),
    items: items.map((item) => ({
      producto_id: Number(item.provider_product_id),
      cantidad: Number(item.quantity),
      porc_cobertura: item.coverage_percentage == null ? undefined : Number(item.coverage_percentage),
      imprimeMarca: Boolean(item.print_brand),
      sustituible: item.substitutable == null ? true : Boolean(item.substitutable),
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
      event_type: 'homologation_send_error',
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
  const itemRejected = result.data.items?.some((item) => item.status && !providerStatusOk(item.status)) ?? false;
  const finalStatus = accepted && !itemRejected ? 'issued' : 'rejected';
  const now = new Date().toISOString();

  await supabase
    .from('prescriptions')
    .update({
      status: finalStatus,
      // Guardamos primero el nrorecetario canónico devuelto por MisRX porque
      // es el identificador que exige el endpoint oficial de anulación.
      provider_prescription_number:
        result.data.nrorecetario ??
        result.data.nrorecetario_receta ??
        result.data.nrorecetario_os ??
        null,
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
    event_type: finalStatus === 'issued' ? 'homologation_issued' : 'homologation_rejected',
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
    prescriptionNumber:
      result.data.nrorecetario ??
      result.data.nrorecetario_receta ??
      result.data.nrorecetario_os ??
      null,
    tokenPresent: Boolean(result.data.token),
    items: result.data.items ?? [],
  }, {
    status: finalStatus === 'issued' ? 200 : 422,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
