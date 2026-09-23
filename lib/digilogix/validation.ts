export function normalizeCuil(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Valida CUIT/CUIL argentino de 11 dígitos, incluyendo dígito verificador.
 * No consulta identidad ni padrón: sólo evita enviar valores mal formados.
 */
export function isValidCuil(value: string): boolean {
  const digits = normalizeCuil(value);
  if (!/^\d{11}$/.test(digits)) return false;

  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, index) => acc + Number(digits[index]) * weight, 0);
  const mod = 11 - (sum % 11);
  const check = mod === 11 ? 0 : mod === 10 ? 9 : mod;
  return check === Number(digits[10]);
}
