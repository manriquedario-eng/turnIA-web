// Identidad del profesional para mostrar en Topbar/Sidebar/Dashboard.
// Fuente de verdad: profiles.display_name. Si está vacío, el fallback NO
// debe ser el email crudo (eso es justo lo que se pidió sacar de la UI) —
// se deriva un nombre razonable de la parte local del email
// ("dario.gomez@..." -> "Dario Gomez"). Si ni siquiera hay email, cae a un
// genérico. Esto es sólo presentación: nunca se guarda nada nuevo en la base.
export function resolveDisplayName(displayName: string | null | undefined, email: string | null | undefined): string {
  const trimmed = (displayName ?? '').trim();
  if (trimmed) return trimmed;

  const local = (email ?? '').split('@')[0]?.trim();
  if (local) {
    const words = local.replace(/[._-]+/g, ' ').trim();
    if (words) {
      return words
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }

  return 'Profesional';
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
