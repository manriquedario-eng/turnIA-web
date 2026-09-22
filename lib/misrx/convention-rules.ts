export type MisRxConventionRules = {
  conventionId: number;
  maxProducts?: number;
  validityDays?: number;
  requiresAuthorization?: boolean;
  requiresDni?: boolean;
  requiresCredential?: boolean;
  requiresSex?: boolean;
  externalEnabled?: boolean;
  environment?: 'homologation' | 'production' | 'unknown';
};

const KNOWN_RULES: Record<number, MisRxConventionRules> = {
  800: {
    conventionId: 800,
    maxProducts: 2,
    validityDays: 60,
    environment: 'homologation',
  },
};

export function getMisRxConventionRules(
  conventionId: number | null | undefined,
): MisRxConventionRules | null {
  if (!conventionId) return null;
  return KNOWN_RULES[conventionId] ?? {
    conventionId,
    environment: 'unknown',
  };
}

export function getMisRxMaxProducts(
  conventionId: number | null | undefined,
): number | null {
  return getMisRxConventionRules(conventionId)?.maxProducts ?? null;
}
