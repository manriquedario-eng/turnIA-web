// Word (.docx) del listado de pacientes — PARTE 4 del pedido de corrección.
// Mismas columnas que ya ofrece Excel (lib/export/xlsx/patients.ts): nunca
// información clínica, sólo lo que ya se ve en /patients, del tenant actual.

import type { Paragraph, Table } from 'docx';
import type { PatientsListExportData } from '../types';
import { formatExportCurrency, formatExportDateTime, textOrDash } from '../format';
import { buildDocHeader, emptyNote, packDocument, simpleTable } from './shared';

export async function buildPatientsListDocx(data: PatientsListExportData): Promise<Buffer> {
  const children: (Paragraph | Table)[] = buildDocHeader('Listado de pacientes', data.professional, data.generatedAt);

  if (data.rows.length === 0) {
    children.push(emptyNote('No hay pacientes cargados.'));
  } else {
    children.push(
      simpleTable(
        ['Nombre', 'Teléfono', 'Email', 'DNI', 'Obra social', 'Plan', 'Estado', 'Próximo turno', 'Saldo'],
        data.rows.map((r) => [
          r.name,
          textOrDash(r.phone),
          textOrDash(r.email),
          textOrDash(r.dni),
          textOrDash(r.insuranceName),
          textOrDash(r.insurancePlan),
          r.status,
          r.nextAppointmentAt ? formatExportDateTime(r.nextAppointmentAt) : 'Sin turno programado',
          formatExportCurrency(r.pendingBalance, 'ARS'),
        ]),
      ),
    );
  }

  return packDocument('Listado de pacientes — TurnIA', children);
}
