// Formateo de presentación para exportaciones (PARTE 13 del pedido):
// fecha dd/mm/aaaa, hora HH:mm, moneda "ARS $30.000", siempre en
// America/Argentina/Buenos_Aires — nunca ISO crudo en un documento
// destinado a una persona.

const EXPORT_TZ = 'America/Argentina/Buenos_Aires';

export function formatExportDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { timeZone: EXPORT_TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function formatExportTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', { timeZone: EXPORT_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function formatExportDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${formatExportDate(iso)} ${formatExportTime(iso)}`;
}

export function formatExportCurrency(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return '—';
  const code = (currency || 'ARS').toUpperCase();
  const value = amount.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${code} $${value}`;
}

/** Texto seguro para celdas/párrafos: nunca null/undefined suelto, nunca vacío sin indicarlo. */
export function textOrDash(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed || '—';
}

export function textOrEmptyNote(value: string | null | undefined, emptyLabel = 'Sin información registrada'): string {
  const trimmed = (value ?? '').trim();
  return trimmed || emptyLabel;
}
