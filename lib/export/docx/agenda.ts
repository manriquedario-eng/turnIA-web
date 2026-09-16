// Word (.docx) de la Agenda — PARTE 3 del pedido de corrección: mismo
// contenido que ya ofrecían Excel/PDF (día/semana/mes + tabla de turnos,
// sin meeting_url completo — ver lib/export/authorize.ts), ahora también en
// formato editable.

import type { Paragraph, Table } from 'docx';
import type { AgendaExportData } from '../types';
import { formatExportDate, formatExportTime, textOrDash } from '../format';
import { modalityLabel, statusLabel } from '@/lib/labels';
import { buildDocHeader, emptyNote, packDocument, simpleTable } from './shared';

const VIEW_LABEL: Record<AgendaExportData['view'], string> = {
  day: 'Día',
  week: 'Semana',
  month: 'Mes',
};

export async function buildAgendaDocx(data: AgendaExportData): Promise<Buffer> {
  const children: (Paragraph | Table)[] = buildDocHeader(
    'Agenda',
    data.professional,
    data.generatedAt,
    `${VIEW_LABEL[data.view]} · ${data.periodLabel}`,
  );

  if (data.rows.length === 0) {
    children.push(emptyNote('No hay turnos en este período.'));
  } else {
    children.push(
      simpleTable(
        ['Fecha', 'Hora inicio', 'Hora fin', 'Paciente', 'Servicio', 'Modalidad', 'Estado'],
        data.rows.map((r) => [
          formatExportDate(r.startTime),
          formatExportTime(r.startTime),
          formatExportTime(r.endTime),
          textOrDash(r.patientName),
          textOrDash(r.service),
          modalityLabel(r.modality),
          statusLabel(r.status),
        ]),
      ),
    );
  }

  return packDocument('Agenda — TurnIA', children);
}
