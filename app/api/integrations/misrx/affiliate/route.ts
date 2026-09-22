import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { checkRateLimit } from '@/lib/rate-limit';
import { getMisRxAdapterForUser } from '@/lib/misrx/service';

function positiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest) {
  const { supabase, tenantId, user } = await requireTenant();

  const convenioId = positiveInteger(request.nextUrl.searchParams.get('convenio_id'));
  const patientId = request.nextUrl.searchParams.get('patient_id')?.trim();

  if (!convenioId || !patientId) {
    return NextResponse.json({ error: 'Faltan convenio_id o patient_id válidos.' }, { status: 400 });
  }

  const limit = await checkRateLimit({
    scope: 'misrx-affiliate-user',
    key: user.id,
    windowSeconds: 60,
    maxCount: 20,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas. Intentá nuevamente en unos segundos.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const { data: patient } = await supabase
    .from('patients')
    .select('id,name,dni,insurance_member_number')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!patient) {
    return NextResponse.json({ error: 'Paciente no encontrado.' }, { status: 404 });
  }

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const result = await adapterResult.data.findAffiliate({
    convenioId,
    dni: patient.dni?.replace(/\D/g, '') || undefined,
    affiliateNumber: patient.insurance_member_number?.trim() || undefined,
    fullName: patient.name?.trim() || undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status ?? 502 });
  }

  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
