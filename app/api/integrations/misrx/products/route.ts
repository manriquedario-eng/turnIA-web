import { NextRequest, NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { checkRateLimit } from '@/lib/rate-limit';
import { getMisRxAdapterForUser } from '@/lib/misrx/service';

function nonNegativeInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const { supabase, tenantId, user } = await requireTenant();
  const params = request.nextUrl.searchParams;

  const convenioId = nonNegativeInteger(params.get('convenio_id'));
  const patientId = params.get('patient_id')?.trim();
  const query = params.get('q')?.trim() ?? '';

  if (!convenioId || !patientId || query.length < 2 || query.length > 100) {
    return NextResponse.json(
      { error: 'Se requieren convenio_id, patient_id y una búsqueda de 2 a 100 caracteres.' },
      { status: 400 },
    );
  }

  const limit = await checkRateLimit({
    scope: 'misrx-products-user',
    key: user.id,
    windowSeconds: 60,
    maxCount: 60,
  });

  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas consultas. Intentá nuevamente en unos segundos.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
  }

  const { data: patient } = await supabase
    .from('patients')
    .select('id,dni,insurance_member_number')
    .eq('id', patientId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!patient) {
    return NextResponse.json({ error: 'Paciente no encontrado.' }, { status: 404 });
  }

  const dniDigits = patient.dni?.replace(/\D/g, '') ?? '';
  const dni = /^\d+$/.test(dniDigits) ? Number(dniDigits) : undefined;

  const adapterResult = await getMisRxAdapterForUser({ tenantId, userId: user.id });
  if (!adapterResult.ok) {
    return NextResponse.json({ error: adapterResult.errorMessage }, { status: 503 });
  }

  const requestedPlanId = nonNegativeInteger(params.get('plan_id'));
  const searchInput = {
    query,
    convenioId,
    credential: patient.insurance_member_number?.trim() || undefined,
    dni,
    authorization: nonNegativeInteger(params.get('autorizacion')),
    planId: requestedPlanId,
    monodrogaId: nonNegativeInteger(params.get('monodroga_id')),
    formaFarmaId: nonNegativeInteger(params.get('forma_farma_id')),
    noIncluyeBajas: nonNegativeInteger(params.get('no_incluye_bajas')),
    productoId: nonNegativeInteger(params.get('producto_id')),
  };

  let result = await adapterResult.data.searchProducts(searchInput);

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage }, { status: result.status ?? 502 });
  }

  // Algunos planes devuelven cero resultados aun cuando el medicamento existe
  // para el convenio. En ese caso hacemos un segundo intento sin plan_id,
  // manteniendo convenio, afiliado y DNI. La cobertura se valida por separado.
  if (requestedPlanId && result.data.data.length === 0) {
    const fallback = await adapterResult.data.searchProducts({
      ...searchInput,
      planId: undefined,
    });

    if (fallback.ok && fallback.data.data.length > 0) {
      result = fallback;
    }
  }

  return NextResponse.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
