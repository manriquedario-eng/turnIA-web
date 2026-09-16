// Wrappers finitos alrededor de renderToBuffer — cada uno arma el elemento
// React del documento correspondiente y lo renderiza a un Buffer real de
// PDF (PARTE 5 del pedido: "NO quiero una captura de pantalla convertida a
// PDF" — @react-pdf/renderer genera PDF real, no HTML-a-imagen).
//
// IMPORTANTE: sólo funciona en runtime Node (no en Edge) — las rutas API
// que llaman a esto deben declarar `export const runtime = 'nodejs'`.

import { renderToBuffer } from '@react-pdf/renderer';
import type { AgendaExportData, PatientExportData, PatientExportSection, PatientsListExportData, PaymentsExportData } from '../types';
import { AgendaDocument } from './AgendaDocument';
import { PatientDocument } from './PatientDocument';
import { PatientsListDocument } from './PatientsListDocument';
import { PaymentsDocument } from './PaymentsDocument';

// Nota sobre el tipado: llamamos a estos componentes como funciones planas
// (PatientDocument({...}) en vez de <PatientDocument ... /> o
// createElement(PatientDocument, ...)) porque cada uno declara su tipo de
// retorno explícito como PdfDocumentElement (= ReactElement con las props
// reales de <Document>, ver pdf/shared.tsx). Así el valor que llega a
// renderToBuffer ya es del tipo exacto que la librería espera — sin "as any"
// ni casts genéricos. Es seguro porque estos componentes son puramente de
// presentación (no usan hooks de React), así que invocarlos directamente
// como función produce exactamente el mismo elemento que la forma JSX.

export async function renderPatientPdf(data: PatientExportData, sections: Set<PatientExportSection>): Promise<Buffer> {
  return renderToBuffer(PatientDocument({ data, sections }));
}

export async function renderPatientsListPdf(data: PatientsListExportData): Promise<Buffer> {
  return renderToBuffer(PatientsListDocument({ data }));
}

export async function renderPaymentsPdf(data: PaymentsExportData): Promise<Buffer> {
  return renderToBuffer(PaymentsDocument({ data }));
}

export async function renderAgendaPdf(data: AgendaExportData): Promise<Buffer> {
  return renderToBuffer(AgendaDocument({ data }));
}
