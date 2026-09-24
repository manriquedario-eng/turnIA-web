// Exportación de Pagos y caja del tenant actual — Excel, PDF o Word.
// Acepta período opcional (from/to en YYYY-MM-DD) y pagina los datos
// server-side para no truncar silenciosamente el archivo.

import { type NextRequest } from 'next/server';
import { requireTenant } from '@/lib/auth/require-user';
import { fetchPaymentsExportData, PaymentsExportTooLargeError } from '@/lib/export/authorize';
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

  const datePattern = /^\\d{4}-\\d{2}-\\d{2}$/;
  const from = searchParams.get('from')?.trim() || '';
  const to = searchParams.get('to')?.trim() || '';

  if ((from && !datePattern.test(from)) || (to && !datePattern.test(to))) {
    return exportErrorResponse('Período inválido. Usá fechas con formato AAAA-MM-DD.', 400);
  }
  if (from && to && from > to) {
    return exportErrorResponse('La fecha desde no puede ser posterior a la fecha hasta.', 400);
  }

  const range = {
    fromIso: from ? new Date(`${from}T00:00:00-03:00`).toISOString() : undefined,
    toIso: to ? new Date(`${to}T23:59:59.999-03:00`).toISOString() : undefined,
  };

  let data;
  try {
    data = await fetchPaymentsExportData(supabase, user.id, tenantId, user.email ?? null, range);
  } catch (err) {
    if (err instanceof PaymentsExportTooLargeError) {
      return exportErrorResponse('El período tiene más de 10.000 registros. Elegí un período más corto para exportar sin perder datos.', 400);
    }
    logExportError('pagos — lectura de datos', err);
    return exportErrorResponse('No pudimos leer los datos para exportar. Intentá nuevamente.', 500);
  }

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
