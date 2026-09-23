import { NextResponse } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ prescriptionId: string }> },
) {
  const { prescriptionId } = await params;
  const { supabase, tenantId, user } = await requireTenant();

  const { data: prescription } = await supabase
    .from('prescriptions')
    .select('id,professional_id')
    .eq('id', prescriptionId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!prescription) {
    return NextResponse.json({ error: 'Receta no encontrada.' }, { status: 404 });
  }

  if (prescription.professional_id !== user.id) {
    return NextResponse.json({ error: 'No tenés permiso para operar sobre esta receta.' }, { status: 403 });
  }

  return NextResponse.json(
    {
      error:
        'La anulación externa no está habilitada en TurnIA porque la documentación entregada por MisRX exige un usuario tipo procesadora con rol habilitado, distinto de la cuenta prestador externo usada para prescribir.',
      code: 'MISRX_CANCELLATION_REQUIRES_PROCESSOR_ACCOUNT',
    },
    { status: 501, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
