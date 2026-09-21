export const VAT_CONDITIONS = [
  { id: 1, label: 'IVA Responsable Inscripto' },
  { id: 4, label: 'IVA Sujeto Exento' },
  { id: 5, label: 'Consumidor Final' },
  { id: 6, label: 'Responsable Monotributo' },
  { id: 7, label: 'Sujeto No Categorizado' },
  { id: 8, label: 'Proveedor del Exterior' },
  { id: 9, label: 'Cliente del Exterior' },
  { id: 10, label: 'IVA Liberado – Ley N° 19.640' },
  { id: 13, label: 'Monotributista Social' },
  { id: 15, label: 'IVA No Alcanzado' },
  { id: 16, label: 'Monotributo Trabajador Independiente Promovido' },
] as const;

export const SALE_CONDITIONS = [
  { value: 'contado', label: 'Contado' },
  { value: 'cuenta_corriente', label: 'Cuenta corriente' },
  { value: 'transferencia', label: 'Transferencia bancaria' },
  { value: 'tarjeta_debito', label: 'Tarjeta de débito' },
  { value: 'tarjeta_credito', label: 'Tarjeta de crédito' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'otros_medios_electronicos', label: 'Otros medios de pago electrónico' },
  { value: 'otra', label: 'Otra' },
] as const;

export type SaleCondition = typeof SALE_CONDITIONS[number]['value'];

export function vatConditionLabel(id: number | null | undefined): string | null {
  if (id == null) return null;
  return VAT_CONDITIONS.find((item) => item.id === id)?.label ?? null;
}

export function saleConditionLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return SALE_CONDITIONS.find((item) => item.value === value)?.label ?? value;
}
