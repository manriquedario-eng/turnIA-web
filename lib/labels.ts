// Traducciones de presentación para valores internos (estado de turno,
// modalidad, método de pago) que se guardan en la base en inglés o en
// minúscula sin acentos. Esto es SOLO texto para mostrar en pantalla — nunca
// cambia lo que se guarda ni lo que se compara en el código (por ejemplo
// `status === 'cancelled'` en otros archivos sigue comparando contra el
// valor real, no contra esta etiqueta).
//
// Un valor no reconocido nunca rompe la pantalla: se muestra "humanizado"
// (guiones bajos → espacios, primera letra en mayúscula) en vez de un texto
// crudo tipo "no_show", pero sin inventar una traducción que no tenemos.

const STATUS_LABELS: Record<string, string> = {
  scheduled: 'Agendado',
  programado: 'Agendado',
  confirmed: 'Confirmado',
  confirmado: 'Confirmado',
  pending: 'Pendiente',
  pendiente: 'Pendiente',
  cancelled: 'Cancelado',
  cancelado: 'Cancelado',
  completed: 'Atendido',
  completado: 'Atendido',
  no_show: 'Ausente',
  'no-show': 'Ausente',
  ausente: 'Ausente',
};

const MODALITY_LABELS: Record<string, string> = {
  in_person: 'Presencial',
  presencial: 'Presencial',
  home_visit: 'Domicilio',
  domicilio: 'Domicilio',
  online: 'Online',
};

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  efectivo: 'Efectivo',
  card: 'Tarjeta',
  tarjeta: 'Tarjeta',
  transfer: 'Transferencia',
  transferencia: 'Transferencia',
  insumo: 'Insumo',
};

function humanize(value: string): string {
  const withSpaces = value.replace(/[_-]+/g, ' ').trim();
  if (!withSpaces) return value;
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function translate(dict: Record<string, string>, value: string | null | undefined, fallback: string): string {
  const raw = (value ?? '').trim();
  if (!raw) return fallback;
  const hit = dict[raw.toLowerCase()];
  return hit ?? humanize(raw);
}

export function statusLabel(status: string | null | undefined): string {
  return translate(STATUS_LABELS, status, 'Sin estado');
}

export function modalityLabel(modality: string | null | undefined): string {
  return translate(MODALITY_LABELS, modality, 'Sin modalidad');
}

export function paymentMethodLabel(method: string | null | undefined): string {
  return translate(PAYMENT_METHOD_LABELS, method, 'Sin método');
}
