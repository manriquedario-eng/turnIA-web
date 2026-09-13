// Badge de estado reutilizable. Mapea estados reales de la base (turnos,
// lista de espera, etc.) a una variante visual. No inventa estados nuevos:
// cualquier valor no reconocido cae en la variante neutral con su texto tal cual.

const VARIANTS: Record<string, string> = {
  confirmado: 'badge-confirmado',
  confirmed: 'badge-confirmed',
  pendiente: 'badge-pendiente',
  pending: 'badge-pending',
  programado: 'badge-programado',
  scheduled: 'badge-scheduled',
  cancelado: 'badge-cancelado',
  cancelled: 'badge-cancelled',
  ausente: 'badge-ausente',
  no_show: 'badge-no_show',
  'no-show': 'badge-no_show',
  completado: 'badge-completado',
  completed: 'badge-completed',
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const value = (status ?? '').toLowerCase();
  const variant = VARIANTS[value] ?? 'badge-neutral';
  return <span className={`badge ${variant}`}>{status || 'Sin estado'}</span>;
}
