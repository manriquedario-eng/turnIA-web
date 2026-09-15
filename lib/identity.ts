// Identidad del profesional para mostrar en Topbar/Sidebar/Dashboard.
// Fuente de verdad: profiles.display_name (editable en Configuración →
// "Nombre visible"). Si está vacío, el fallback es un genérico neutro
// ("Profesional") — NUNCA el email crudo, y NUNCA un nombre inventado a
// partir del email (eso daba resultados como "Manriquedario" a partir de
// "manriquedario@gmail.com", que es justo lo que se pidió sacar). El
// segundo parámetro de la función se ignora a propósito: se deja como
// parámetro por compatibilidad con los llamadores existentes, que hoy le
// siguen pasando `user.email`, pero ya no se usa para derivar nada.
export function resolveDisplayName(displayName: string | null | undefined, _email?: string | null): string {
  const trimmed = (displayName ?? '').trim();
  return trimmed || 'Profesional';
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  administrator: 'Administrador',
  professional: 'Profesional',
  staff: 'Asistente',
  assistant: 'Asistente',
  member: 'Miembro',
};

export function roleLabel(role: string | null | undefined): string {
  const value = (role ?? '').trim().toLowerCase();
  if (!value) return '';
  return ROLE_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}
