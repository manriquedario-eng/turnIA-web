import ExcelJS from 'exceljs';
import type { PatientsListExportData } from '../types';
import { formatExportCurrency, formatExportDateTime, textOrDash } from '../format';

export async function buildPatientsListWorkbook(data: PatientsListExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TurnIA';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Pacientes');
  sheet.columns = [
    { header: 'Nombre', key: 'name', width: 28 },
    { header: 'Teléfono', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'DNI', key: 'dni', width: 14 },
    { header: 'Obra social', key: 'insurance', width: 20 },
    { header: 'Plan', key: 'plan', width: 16 },
    { header: 'Estado', key: 'status', width: 12 },
    { header: 'Próximo turno', key: 'next', width: 20 },
    { header: 'Saldo', key: 'balance', width: 16 },
  ];
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE7DE' } };
  });

  for (const row of data.rows) {
    sheet.addRow({
      name: row.name,
      phone: textOrDash(row.phone),
      email: textOrDash(row.email),
      dni: textOrDash(row.dni),
      insurance: textOrDash(row.insuranceName),
      plan: textOrDash(row.insurancePlan),
      status: row.status,
      next: row.nextAppointmentAt ? formatExportDateTime(row.nextAppointmentAt) : 'Sin turno programado',
      balance: formatExportCurrency(row.pendingBalance, 'ARS'),
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
