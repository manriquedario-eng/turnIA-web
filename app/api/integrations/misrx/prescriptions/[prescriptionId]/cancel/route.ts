import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { getMisRxAdapterForUser } from '@/lib/misrx/service';
import { getMisRxHomologationConfig } from '@/lib/misrx/homologation';
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params;
  const { supabase, tenantId, user } = await requireTenant();

  if (!isServiceRoleConfigured()) {
    return NextResponse.json({ error: 'Configuración del servidor incompleta.' }, { status: 503 });
  }

  const limit = await checkRateLimit({
    scope: 'misrx-cancel-prescription-user',
    key: user.id,
    windowSeconds: 60,
    maxCount: 5,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos de anulación. Intentá nuevamente en unos segundos.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,professional_id,status,convention_id,provider_prescription_number')
    .eq('id', prescriptionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!prescription) {
    return NextResponse.json({ error: 'Receta no encontrada.' }, { status: 404 });
  }

  if (prescription.professional_id !== user.id) {
    return NextResponse.json({ error: 'No tenés permiso para anular esta receta.' }, { status: 403 });
  }

  if (prescription.status !== 'issued') {
    return NextResponse.json(
      { error: 'Sólo una receta emitida puede anularse.' },
      { status: 409 },
    );
  }

  if (!prescription.convention_id || !prescription.provider_prescription_number) {
    return NextResponse.json(
      { error: 'Faltan datos del proveedor para anular la receta.' },
      { status: 400 },
    );
  }

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const adapter = adapterResult.data;
  const sessionResult = await adapter.testSession();
  if (!sessionResult.ok) {
    return NextResponse.json(
      { error: 'No se pudo validar la sesión MisRX antes de anular.' },
      { status: sessionResult.status ?? 502 },
    );
  }

  const homologation = getMisRxHomologationConfig();
  const homologationActive = Boolean(
    homologation.enabled &&
    homologation.conventionId &&
    prescription.convention_id === homologation.conventionId
  );

  const professionalResult = homologationActive
    ? await adapter.verifyExternalProvider()
    : await adapter.verifyPrescriber();

  if (!professionalResult.ok) {
    return NextResponse.json(
      { error: professionalResult.errorMessage },
      { status: professionalResult.status ?? 403 },
    );
  }

  const result = await adapter.cancelPrescription({
    convenio_id: prescription.convention_id,
    nro_recetario: prescription.provider_prescription_number,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status ?? 502 });
  }

  if (result.data.success !== true) {
    return NextResponse.json(
      { error: typeof result.data.data === 'string' && result.data.data.trim()
        ? result.data.data
        : 'MisRX no confirmó la anulación de la receta.' },
      { status: 422 },
    );
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('prescriptions')
    .update({
      status: 'cancelled',
      cancelled_at: now,
      provider_status: 'CANCELLED',
      provider_status_description:
        typeof result.data.data === 'string' ? result.data.data.slice(0, 1000) : 'Anulada en MisRX',
      updated_at: now,
    })
    .eq('id', prescription.id)
    .eq('tenant_id', tenantId)
    .eq('professional_id', user.id)
    .eq('status', 'issued');

  if (updateError) {
    return NextResponse.json(
      { error: 'MisRX anuló la receta, pero TurnIA no pudo actualizar el estado local. Requiere conciliación.' },
      { status: 500 },
    );
  }

  const service = createSupabaseServiceClient();
  await service.from('prescription_events').insert({
    prescription_id: prescription.id,
    event_type: 'misrx_cancelled',
    provider_status: 'CANCELLED',
    provider_message: typeof result.data.data === 'string' ? result.data.data.slice(0, 1000) : null,
    metadata: {
      resultado_id: result.data.resultado_id ?? null,
      prescription_number: prescription.provider_prescription_number,
      homologation: homologationActive,
    },
  });

  return NextResponse.json({
    ok: true,
    status: 'cancelled',
    message: typeof result.data.data === 'string' ? result.data.data : 'Receta anulada en MisRX.',
  }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
