// Tipos compartidos del sistema de exportación (PDF / Word / Excel).
//
// Deliberadamente "planos": cada builder de formato (pdf/docx/xlsx) recibe
// estos mismos objetos ya resueltos y autorizados — nunca vuelve a tocar
// Supabase ni recibe un id crudo. Toda la resolución + validación de
// tenant/paciente vive en lib/export/authorize.ts.

export type ExportFormat = 'pdf' | 'docx' | 'xlsx';

export type PatientExportSection =
  | 'full'
  | 'clinical'
  | 'sessions'
  | 'followups'
  | 'activity'
  | 'data'
  | 'payments';

/** Datos del profesional/consultorio para encabezados de documentos — nunca incluye ids internos. */
export type ProfessionalInfo = {
  displayName: string;
  profession: string | null;
  licenseNumber: string | null;
  professionalCollege: string | null;
  cuit: string | null;
  businessName: string | null;
  officeAddress: string | null;
  locality: string | null;
  province: string | null;
  professionalPhone: string | null;
  professionalEmail: string | null;
};

export type PatientRecordData = {
  name: string;
  dni: string | null;
  phone: string | null;
  email: string | null;
  insuranceName: string | null;
  insuranceMemberNumber: string | null;
  insurancePlan: string | null;
  careLocation: string | null;
  defaultPrice: number | null;
};

export type PatientSummary = {
  nextAppointmentAt: string | null;
  nextAppointmentStatus: string | null;
  lastAppointmentAt: string | null;
  lastAppointmentStatus: string | null;
  pendingBalance: number;
};

export type ClinicalRecord = {
  reason: string | null;
  background: string | null;
  followUp: string | null;
  notes: string | null;
  plan: string | null;
  updatedAt: string | null;
};

export type SessionRow = {
  date: string;
  service: string | null;
  modality: string | null;
  status: string | null;
  note: string | null;
};

export type FollowUpRow = {
  date: string;
  content: string;
};

export type ActivityRow = {
  date: string;
  type: string;
  title: string;
  detail: string | null;
};

export type PatientPaymentRow = {
  date: string;
  amount: number;
  currency: string;
  method: string | null;
  appointmentDate: string | null;
};

export type PatientExportData = {
  professional: ProfessionalInfo;
  patient: PatientRecordData;
  summary: PatientSummary;
  clinicalRecord: ClinicalRecord | null;
  sessions: SessionRow[];
  followUps: FollowUpRow[];
  activity: ActivityRow[];
  payments: PatientPaymentRow[];
  generatedAt: string;
};

export type PatientsListRow = {
  name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
  insuranceName: string | null;
  insurancePlan: string | null;
  status: string;
  nextAppointmentAt: string | null;
  pendingBalance: number;
};

export type PatientsListExportData = {
  professional: ProfessionalInfo;
  rows: PatientsListRow[];
  generatedAt: string;
};

export type PaymentExportRow = {
  date: string;
  patientName: string | null;
  method: string | null;
  amount: number;
  currency: string;
  appointmentDate: string | null;
};

export type CashMovementExportRow = {
  date: string;
  kind: 'in' | 'out';
  concept: string | null;
  amount: number;
};

export type PaymentsExportData = {
  professional: ProfessionalInfo;
  payments: PaymentExportRow[];
  cashMovements: CashMovementExportRow[];
  generatedAt: string;
};

export type AgendaExportRow = {
  date: string;
  startTime: string;
  endTime: string;
  patientName: string | null;
  service: string | null;
  modality: string | null;
  status: string | null;
};

export type AgendaExportData = {
  professional: ProfessionalInfo;
  view: 'day' | 'week' | 'month';
  periodLabel: string;
  rows: AgendaExportRow[];
  generatedAt: string;
};
