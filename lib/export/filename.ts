// Nombres de archivo (PARTE 11 del pedido): claros, sin ids internos, sin
// tenant ids, sin tokens, sin caracteres inválidos para el sistema de
// archivos del usuario (Windows incluido, ya que Dario lo usa desde ahí).

const EXPORT_TZ = 'America/Argentina/Buenos_Aires';

function todayStamp(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: EXPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Saca acentos, caracteres no imprimibles y símbolos inválidos en nombres de archivo (Windows/mac/Linux). */
export function sanitizeFilenamePart(value: string): string {
  const withoutAccents = value.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cleaned = withoutAccents
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return cleaned || 'TurnIA';
}

const EXTENSION_BY_FORMAT: Record<'pdf' | 'docx' | 'xlsx', string> = {
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx',
};

/**
 * Arma "TurnIA_<parte1>_<parte2>_..._YYYY-MM-DD.ext", sanitizando cada parte
 * por separado (así un nombre de paciente con "/" o emojis no rompe nada).
 */
export function buildExportFilename(parts: string[], format: 'pdf' | 'docx' | 'xlsx'): string {
  const safeParts = parts.map(sanitizeFilenamePart).filter(Boolean);
  const name = ['TurnIA', ...safeParts, todayStamp()].join('_');
  return `${name}.${EXTENSION_BY_FORMAT[format]}`;
}
