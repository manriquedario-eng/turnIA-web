export function isFiscalProfileEnabled(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  const value = profile as Record<string, unknown>;

  if (typeof value.fiscal_enabled === 'boolean') return value.fiscal_enabled;

  // Compatibilidad con perfiles creados antes de que existiera el switch.
  // Si ya tenían datos fiscales guardados, no los desactivamos de golpe.
  return Boolean(
    (typeof value.cuit === 'string' && value.cuit.trim()) ||
    (typeof value.business_name === 'string' && value.business_name.trim()) ||
    (typeof value.tax_condition === 'string' && value.tax_condition.trim()) ||
    (typeof value.activity_code === 'string' && value.activity_code.trim())
  );
}
