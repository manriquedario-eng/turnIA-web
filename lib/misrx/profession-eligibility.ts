export function isClearlyNonPrescriberProfession(value: unknown): boolean {
  if (typeof value !== 'string') return false;

  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (!normalized) return false;

  const nonPrescriberTerms = [
    'psicolog',
    'kinesiolog',
    'fisioter',
    'nutricion',
    'fonoaudi',
    'terapista ocupacional',
    'trabajo social',
    'trabajador social',
    'enfermer',
    'acompanante terapeutico',
    'psicopedagog',
  ];

  return nonPrescriberTerms.some((term) => normalized.includes(term));
}

export function shouldShowMisRxForDeclaredProfession(value: unknown): boolean {
  return !isClearlyNonPrescriberProfession(value);
}
