import ExcelJS from 'exceljs';
import type { PaymentsExportData } from '../types';
import { formatExportCurrency, formatExportDate, textOrDash } from '../format';
import { paymentMethodLabel } from '@/lib/labels';

function headerStyle(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE7DE' } };
  });
}

export async function buildPaymentsWorkbook(data: PaymentsExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TurnIA';
  wb.created = new Date();

  const paymentsSheet = wb.addWorksheet('Pagos');
  paymentsSheet.columns = [
    { header: 'Fecha', key: 'date', width: 12 },
    { header: 'Paciente', key: 'patient', width: 26 },
    { header: 'Medio', key: 'method', width: 18 },
    { header: 'Importe', key: 'amount', width: 16 },
    { header: 'Turno', key: 'appointment', width: 14 },
  ];
  headerStyle(paymentsSheet.getRow(1));
  for (const p of data.payments) {
    paymentsSheet.addRow({
      date: formatExportDate(p.date),
      patient: textOrDash(p.patientName),
      method: paymentMethodLabel(p.method),
      amount: formatExportCurrency(p.amount, p.currency),
      appointment: p.appointmentDate ? formatExportDate(p.appointmentDate) : '—',
    });
  }

  const cashSheet = wb.addWorksheet('Caja manual');
  cashSheet.columns = [
    { header: 'Fecha', key: 'date', width: 12 },
    { header: 'Tipo', key: 'kind', width: 12 },
    { header: 'Concepto', key: 'concept', width: 26 },
    { header: 'Importe', key: 'amount', width: 16 },
  ];
  headerStyle(cashSheet.getRow(1));
  for (const c of data.cashMovements) {
    cashSheet.addRow({
      date: formatExportDate(c.date),
      kind: c.kind === 'in' ? 'Ingreso' : 'Egreso',
      concept: textOrDash(c.concept),
      amount: formatExportCurrency(c.amount, 'ARS'),
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
