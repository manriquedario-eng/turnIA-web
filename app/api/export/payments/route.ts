// Exportación de Pagos y caja del tenant actual — Excel, PDF o Word (Word
// agregado en la pasada de corrección de PARTE 5). Sin filtro por período
// todavía (no existe en /payments hoy): se exporta lo mismo que ya trae la
// pantalla (últimos movimientos), sin construir una arquitectura de
// filtros nueva sólo para esto.

import { type NextRequest } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { fetchPaymentsExportData } from '@/lib/export/authorize';
import { buildExportFilename } from '@/lib/export/filename';
import { exportErrorResponse, exportFileResponse, logExportError, parseExportFormat } from '@/lib/export/response';
import { buildPaymentsWorkbook } from '@/lib/export/xlsx/payments';
import { buildPaymentsDocx } from '@/lib/export/docx/payments';
import { renderPaymentsPdf } from '@/lib/export/pdf/render';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { supabase, user, tenantId } = await requireTenant();
  const { searchParams } = new URL(request.url);
  const format = parseExportFormat(searchParams.get('format'), ['xlsx', 'pdf', 'docx']);
  if (!format) return exportErrorResponse('Formato inválido. Usá pdf, docx o xlsx.', 400);

  const data = await fetchPaymentsExportData(supabase, user.id, tenantId, user.email ?? null);

  let buffer: Buffer;
  try {
    if (format === 'xlsx') buffer = await buildPaymentsWorkbook(data);
    else if (format === 'docx') buffer = await buildPaymentsDocx(data);
    else buffer = await renderPaymentsPdf(data);
  } catch (err) {
    logExportError(`pagos — formato ${format}`, err);
    return exportErrorResponse('No pudimos generar el archivo. Intentá nuevamente.', 500);
  }

  const filename = buildExportFilename(['Pagos'], format);
  return exportFileResponse(buffer, filename, format);
}
