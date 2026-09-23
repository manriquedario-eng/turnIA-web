import 'server-only';

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export type MisRxHomologationConfig = {
  enabled: boolean;
  conventionId?: number;
  doctorId?: number;
  patientDni?: string;
  patientCredential?: string;
  issuingEnabled: boolean;
};

export function getMisRxHomologationConfig(): MisRxHomologationConfig {
  const enabled = process.env.MISRX_HOMOLOGATION_ENABLED?.trim().toLowerCase() === 'true';

  return {
    enabled,
    issuingEnabled: process.env.MISRX_HOMOLOGATION_ISSUING_ENABLED?.trim().toLowerCase() === 'true',
    conventionId: positiveInteger(process.env.MISRX_HOMOLOGATION_CONVENTION_ID),
    doctorId: positiveInteger(process.env.MISRX_HOMOLOGATION_DOCTOR_ID),
    patientDni: process.env.MISRX_HOMOLOGATION_PATIENT_DNI?.trim() || undefined,
    patientCredential: process.env.MISRX_HOMOLOGATION_PATIENT_CREDENTIAL?.trim() || undefined,
  };
}

export function isMisRxHomologationForConvention(
  conventionId: number | null | undefined,
): boolean {
  const config = getMisRxHomologationConfig();
  return Boolean(config.enabled && config.conventionId && conventionId === config.conventionId);
}


export function isMisRxProductionIssuingEnabled(): boolean {
  return process.env.MISRX_PRODUCTION_ISSUING_ENABLED?.trim().toLowerCase() === 'true';
}
