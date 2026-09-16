// Excel de un paciente — una hoja por sección (PARTE 7 del pedido: "no
// meter toda la información en una sola celda gigante"). Sólo se agregan
// las hojas pedidas en `sections`.

import ExcelJS from 'exceljs';
import type { PatientExportData, PatientExportSection } from '../types';
import { formatExportCurrency, formatExportDate, formatExportDateTime, formatExportTime, textOrDash } from '../format';
import { modalityLabel, statusLabel, paymentMethodLabel } from '@/lib/labels';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE7DE' } };

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });
}

export async function buildPatientWorkbook(data: PatientExportData, sections: Set<PatientExportSection>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TurnIA';
  wb.created = new Date();

  const wantsAll = sections.has('full');

  if (wantsAll || sections.has('data')) {
    const sheet = wb.addWorksheet('Datos');
    sheet.columns = [
      { header: 'Campo', key: 'field', width: 28 },
      { header: 'Valor', key: 'value', width: 40 },
    ];
    styleHeaderRow(sheet.getRow(1));
    const p = data.patient;
    const rows: [string, string][] = [
      ['Nombre', textOrDash(p.name)],
      ['DNI', textOrDash(p.dni)],
      ['Teléfono', textOrDash(p.phone)],
      ['Email', textOrDash(p.email)],
      ['Obra social', textOrDash(p.insuranceName)],
      ['Nº afiliado', textOrDash(p.insuranceMemberNumber)],
      ['Plan', textOrDash(p.insurancePlan)],
      ['Lugar de atención', textOrDash(p.careLocation)],
      ['Precio habitual', p.defaultPrice != null ? formatExportCurrency(p.defaultPrice, 'ARS') : '—'],
      ['Próximo turno', formatExportDateTime(data.summary.nextAppointmentAt)],
      ['Último turno', formatExportDateTime(data.summary.lastAppointmentAt)],
      ['Saldo pendiente', formatExportCurrency(data.summary.pendingBalance, 'ARS')],
    ];
    for (const [field, value] of rows) sheet.addRow({ field, value });
  }

  if ((wantsAll || sections.has('clinical')) && data.clinicalRecord) {
    const sheet = wb.addWorksheet('Ficha clínica');
    sheet.columns = [
      { header: 'Campo', key: 'field', width: 20 },
      { header: 'Contenido', key: 'value', width: 80 },
    ];
    styleHeaderRow(sheet.getRow(1));
    const r = data.clinicalRecord;
    const rows: [string, string][] = [
      ['Motivo', textOrDash(r.reason)],
      ['Antecedentes', textOrDash(r.background)],
      ['Seguimiento', textOrDash(r.followUp)],
      ['Notas', textOrDash(r.notes)],
      ['Plan', textOrDash(r.plan)],
      ['Última actualización', formatExportDateTime(r.updatedAt)],
    ];
    for (const [field, value] of rows) {
      const row = sheet.addRow({ field, value });
      row.getCell('value').alignment = { wrapText: true, vertical: 'top' };
    }
  }

  if (wantsAll || sections.has('sessions')) {
    const sheet = wb.addWorksheet('Sesiones');
    sheet.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Hora', key: 'time', width: 8 },
      { header: 'Servicio', key: 'service', width: 22 },
      { header: 'Modalidad', key: 'modality', width: 14 },
      { header: 'Estado', key: 'status', width: 14 },
      { header: 'Nota', key: 'note', width: 60 },
    ];
    styleHeaderRow(sheet.getRow(1));
    for (const s of data.sessions) {
      const row = sheet.addRow({
        date: formatExportDate(s.date),
        time: formatExportTime(s.date),
        service: textOrDash(s.service),
        modality: modalityLabel(s.modality),
        status: statusLabel(s.status),
        note: textOrDash(s.note),
      });
      row.getCell('note').alignment = { wrapText: true, vertical: 'top' };
    }
  }

  if (wantsAll || sections.has('followups')) {
    const sheet = wb.addWorksheet('Seguimientos');
    sheet.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Contenido', key: 'content', width: 80 },
    ];
    styleHeaderRow(sheet.getRow(1));
    for (const f of data.followUps) {
      const row = sheet.addRow({ date: formatExportDate(f.date), content: textOrDash(f.content) });
      row.getCell('content').alignment = { wrapText: true, vertical: 'top' };
    }
  }

  if (wantsAll || sections.has('payments')) {
    const sheet = wb.addWorksheet('Pagos');
    sheet.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Importe', key: 'amount', width: 16 },
      { header: 'Medio', key: 'method', width: 18 },
      { header: 'Turno asociado', key: 'appointment', width: 18 },
    ];
    styleHeaderRow(sheet.getRow(1));
    for (const p of data.payments) {
      sheet.addRow({
        date: formatExportDate(p.date),
        amount: formatExportCurrency(p.amount, p.currency),
        method: paymentMethodLabel(p.method),
        appointment: p.appointmentDate ? formatExportDate(p.appointmentDate) : '—',
      });
    }
  }

  if (wantsAll || sections.has('activity')) {
    const sheet = wb.addWorksheet('Actividad');
    sheet.columns = [
      { header: 'Fecha', key: 'date', width: 12 },
      { header: 'Hora', key: 'time', width: 8 },
      { header: 'Tipo', key: 'type', width: 14 },
      { header: 'Descripción', key: 'title', width: 40 },
      { header: 'Detalle', key: 'detail', width: 40 },
    ];
    styleHeaderRow(sheet.getRow(1));
    for (const a of data.activity) {
      const row = sheet.addRow({
        date: formatExportDate(a.date),
        time: formatExportTime(a.date),
        type: a.type,
        title: textOrDash(a.title),
        detail: textOrDash(a.detail),
      });
      row.getCell('detail').alignment = { wrapText: true, vertical: 'top' };
    }
  }

  // Ninguna sección pedida generó hoja (caso borde) — dejar al menos una
  // hoja vacía con una nota, para no devolver un .xlsx sin hojas (ExcelJS lo
  // permite escribir, pero Excel/LibreOffice lo abren como archivo roto).
  if (wb.worksheets.length === 0) {
    wb.addWorksheet('Sin datos').addRow(['No hay información para las secciones solicitadas.']);
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
