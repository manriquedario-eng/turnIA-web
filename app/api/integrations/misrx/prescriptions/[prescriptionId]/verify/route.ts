import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { createSupabaseServiceClient, isServiceRoleConfigured } from '@/lib/supabase/service';
import { getMisRxAdapterForUser } from '@/lib/misrx/service';
import { checkRateLimit } from '@/lib/rate-limit';

function prescriptionNumberFromRow(row: Record<string, unknown>) {
  for (const key of ['nrorecetario', 'nrorecetario_receta', 'nrorecetario_os']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params;
  const { supabase, tenantId, user } = await requireTenant();

  const limit = await checkRateLimit({
    scope: 'misrx-verify-prescription-user',
    key: user.id,
    windowSeconds: 60,
    maxCount: 20,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas verificaciones. Intentá nuevamente en unos segundos.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,professional_id,convention_id,provider_prescription_number,status')
    .eq('id', prescriptionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!prescription) {
    return NextResponse.json({ error: 'Receta no encontrada.' }, { status: 404 });
  }

  if (prescription.professional_id !== user.id) {
    return NextResponse.json({ error: 'No tenés permiso para verificar esta receta.' }, { status: 403 });
  }

  if (!prescription.convention_id || !prescription.provider_prescription_number) {
    return NextResponse.json(
      { error: 'La receta todavía no tiene convenio o número de recetario MisRX.' },
      { status: 400 },
    );
  }

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const result = await adapterResult.data.listPrescriptions({
    convenioId: prescription.convention_id,
    page: 0,
    filter: prescription.provider_prescription_number,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status ?? 502 });
  }

  const expected = String(prescription.provider_prescription_number).trim();
  const match = result.data.data.find((row) => {
    const candidates = [
      row.nrorecetario,
      row.nrorecetario_receta,
      row.nrorecetario_os,
    ].map((value) => value == null ? '' : String(value).trim());

    return candidates.includes(expected);
  });

  if (isServiceRoleConfigured()) {
    const service = createSupabaseServiceClient();
    await service.from('prescription_events').insert({
      prescription_id: prescription.id,
      event_type: match ? 'misrx_verified' : 'misrx_verification_not_found',
      provider_status: match && typeof match.recetas_estado_desc === 'string'
        ? match.recetas_estado_desc
        : null,
      provider_message: match
        ? 'La receta fue encontrada en el listado externo de MisRX.'
        : 'La receta no fue encontrada por número en el listado externo de MisRX.',
      metadata: {
        local_status: prescription.status,
        prescription_number: expected,
      },
    });
  }

  return NextResponse.json({
    verified: Boolean(match),
    prescriptionNumber: match ? prescriptionNumberFromRow(match) || expected : expected,
    remoteStatus: match && typeof match.recetas_estado_desc === 'string'
      ? match.recetas_estado_desc
      : null,
    message: match
      ? 'Receta localizada en MisRX.'
      : 'MisRX respondió correctamente, pero no devolvió esta receta en la búsqueda.',
  }, {
    status: match ? 200 : 404,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
