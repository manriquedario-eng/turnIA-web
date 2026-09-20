// Word (.docx) de Pagos y caja — PARTE 5 del pedido de corrección. Misma
// información que ya ofrecen Excel/PDF (lib/export/xlsx/payments.ts,
// lib/export/pdf/PaymentsDocument.tsx): dos secciones (pagos + movimientos
// manuales de caja), del tenant actual.
//
// Nota de consistencia: el pedido original listaba "Moneda" como columna
// separada en Pagos y "Medio" como columna separada en Caja manual. El
// dato ya existente (misma fuente que Excel/PDF) no separa esos dos casos:
// el importe de Pagos ya se formatea con su moneda incluida (p. ej.
// "ARS $30.000", ver formatExportCurrency) y Caja manual no trae un medio
// de pago distinto del concepto en el modelo actual
// (fetchPaymentsExportData en lib/export/authorize.ts). Se mantienen las
// mismas columnas que Excel/PDF para no introducir una inconsistencia
// nueva entre los tres formatos — señalado en el reporte final.

import type { Paragraph, Table } from 'docx';
import type { PaymentsExportData } from '../types';
import { formatExportCurrency, formatExportDate, textOrDash } from '../format';
import { paymentMethodLabel } from '@/lib/labels';
import { buildDocHeader, emptyNote, packDocument, sectionHeading, simpleTable } from './shared';

export async function buildPaymentsDocx(data: PaymentsExportData): Promise<Buffer> {
  const totalCollected = data.payments.reduce((sum, p) => sum + p.amount, 0);
  const children: (Paragraph | Table)[] = buildDocHeader(
    'Pagos y caja',
    data.professional,
    data.generatedAt,
    `Total cobrado en el período mostrado: ${formatExportCurrency(totalCollected, 'ARS')}`,
  );

  children.push(sectionHeading('Pagos'));
  if (data.payments.length === 0) {
    children.push(emptyNote('No hay pagos registrados.'));
  } else {
    children.push(
      simpleTable(
        ['Fecha', 'Paciente', 'Medio', 'Importe', 'Turno'],
        data.payments.map((p) => [
          formatExportDate(p.date),
          textOrDash(p.patientName),
          paymentMethodLabel(p.method),
          formatExportCurrency(p.amount, p.currency),
          p.appointmentDate ? formatExportDate(p.appointmentDate) : '—',
        ]),
      ),
    );
  }

  children.push(sectionHeading('Movimientos manuales de caja'));
  if (data.cashMovements.length === 0) {
    children.push(emptyNote('No hay movimientos manuales de caja.'));
  } else {
    children.push(
      simpleTable(
        ['Fecha', 'Tipo', 'Concepto', 'Importe'],
        data.cashMovements.map((c) => [
          formatExportDate(c.date),
          c.kind === 'in' ? 'Ingreso' : 'Egreso',
          textOrDash(c.concept),
          formatExportCurrency(c.amount, 'ARS'),
        ]),
      ),
    );
  }

  return packDocument('Pagos y caja — TurnIA', children);
}
