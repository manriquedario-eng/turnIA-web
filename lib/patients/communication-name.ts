export type PatientCommunicationNameInput = {
  name: string;
  alias?: string | null;
  use_alias_for_communications?: boolean | null;
};

/**
 * Nombre que TurnIA debe usar al hablarle al paciente.
 * La identificación formal/fiscal sigue usando siempre patients.name.
 */
export function resolvePatientCommunicationName(patient: PatientCommunicationNameInput): string {
  const fullName = patient.name.trim();
  const alias = patient.alias?.trim();

  if (patient.use_alias_for_communications && alias) {
    return alias;
  }

  return fullName || 'Paciente';
}
