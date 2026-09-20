import ExcelJS from 'exceljs';
import type { AgendaExportData } from '../types';
import { formatExportDate, formatExportTime, textOrDash } from '../format';
import { modalityLabel, statusLabel } from '@/lib/labels';

export async function buildAgendaWorkbook(data: AgendaExportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TurnIA';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Agenda');
  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 12 },
    { header: 'Hora inicio', key: 'start', width: 12 },
    { header: 'Hora fin', key: 'end', width: 12 },
    { header: 'Paciente', key: 'patient', width: 26 },
    { header: 'Servicio', key: 'service', width: 22 },
    { header: 'Modalidad', key: 'modality', width: 14 },
    { header: 'Estado', key: 'status', width: 14 },
  ];
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE7DE' } };
  });

  for (const row of data.rows) {
    sheet.addRow({
      date: formatExportDate(row.startTime),
      start: formatExportTime(row.startTime),
      end: formatExportTime(row.endTime),
      patient: textOrDash(row.patientName),
      service: textOrDash(row.service),
      modality: modalityLabel(row.modality),
      status: statusLabel(row.status),
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
