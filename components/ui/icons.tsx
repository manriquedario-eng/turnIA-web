// Íconos en línea (sin dependencias externas) para el sistema visual de TurnIA.
// Trazo consistente: 1.7px stroke, 20x20 viewBox, currentColor.

type IconProps = { size?: number };

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconHome({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M3 9.5 10 3l7 6.5" />
      <path d="M5 8v8h10V8" />
    </svg>
  );
}

export function IconCalendar({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <rect x="3" y="4.5" width="14" height="12" rx="2" />
      <path d="M3 8.5h14M7 2.5v3M13 2.5v3" />
    </svg>
  );
}

export function IconUsers({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <circle cx="7.5" cy="7" r="2.6" />
      <path d="M2.5 17c.6-3 2.4-4.5 5-4.5s4.4 1.5 5 4.5" />
      <circle cx="14.5" cy="7.5" r="2" />
      <path d="M13 12.6c1.9.2 3.4 1.6 3.9 3.9" />
    </svg>
  );
}

export function IconClock({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l2.6 1.6" />
    </svg>
  );
}

export function IconReceipt({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M5 2.8h10v14.4l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V4.8a2 2 0 0 1 2-2Z" />
      <path d="M7 7h6M7 10h6M7 13h4" />
    </svg>
  );
}

export function IconWallet({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <rect x="2.5" y="5" width="15" height="11" rx="2" />
      <path d="M2.5 8.5h15" />
      <circle cx="13.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTag({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M10.5 3H4a1 1 0 0 0-1 1v6.5l8.4 8.4a1 1 0 0 0 1.4 0l5.1-5.1a1 1 0 0 0 0-1.4L10.5 3Z" />
      <circle cx="6.7" cy="6.7" r="1.1" />
    </svg>
  );
}

export function IconSettings({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 2.7v2.1M10 15.2v2.1M17.3 10h-2.1M4.8 10H2.7M15.1 4.9l-1.5 1.5M6.4 13.6l-1.5 1.5M15.1 15.1l-1.5-1.5M6.4 6.4 4.9 4.9" />
    </svg>
  );
}

export function IconSearch({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <circle cx="8.7" cy="8.7" r="5.2" />
      <path d="m17 17-4.3-4.3" />
    </svg>
  );
}

export function IconMenu({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M3 5.5h14M3 10h14M3 14.5h14" />
    </svg>
  );
}

export function IconClose({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M4.5 4.5l11 11M15.5 4.5l-11 11" />
    </svg>
  );
}

export function IconChevronLeft({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M12.5 4.5 7 10l5.5 5.5" />
    </svg>
  );
}

export function IconChevronRight({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M7.5 4.5 13 10l-5.5 5.5" />
    </svg>
  );
}

export function IconPlus({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

export function IconPhone({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M5 3.5h2.2l1 3.3-1.6 1.3a9 9 0 0 0 4.3 4.3l1.3-1.6 3.3 1v2.2c0 .8-.7 1.4-1.5 1.3-6-.6-9.9-4.5-10.5-10.5-.1-.8.5-1.5 1.3-1.5Z" />
    </svg>
  );
}

export function IconMail({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
      <path d="m3 5.5 7 5.5 7-5.5" />
    </svg>
  );
}

export function IconBell({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M5 8.5a5 5 0 0 1 10 0c0 3 1 4 1.5 4.7H3.5C4 12.5 5 11.5 5 8.5Z" />
      <path d="M8.3 16a1.8 1.8 0 0 0 3.4 0" />
    </svg>
  );
}

export function IconCheck({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M4 10.5 8 14.5 16 5.5" />
    </svg>
  );
}

export function IconLogout({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M8 3.5H4.8a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1H8" />
      <path d="M12.5 6.5 16.5 10l-4 3.5M16.5 10H7.3" />
    </svg>
  );
}

/* Spinner de carga para botones/estados is-loading (Fase 1 — sistema de
   botones ampliado). Usa la misma animación btn-spin definida en
   globals.css para los botones nativos con .is-loading, así ambos giran
   igual sin duplicar el keyframe. */
export function IconSpinner({ size = 16 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      style={{ animation: 'btn-spin 0.6s linear infinite' }}
    >
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M17.5 10a7.5 7.5 0 0 0-7.5-7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconMic({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <rect x="7" y="2.5" width="6" height="10" rx="3" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5M7 17.5h6" />
    </svg>
  );
}

/* Íconos agregados para el rediseño Concepto C (Editorial Minimal): hoja
   (saludo del dashboard + panel motivacional), sol (panel motivacional),
   candado y ojo (campo de contraseña, decorativos) — mismo trazo/estilo
   que el resto del set. */
export function IconLeaf({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M4 16c-.6-6.5 3.4-11 12-11.5.5 8-3.7 12-11.5 12Z" />
      <path d="M5 15c2.5-2.7 5-5 9.7-9" />
    </svg>
  );
}

export function IconSun({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.8v2M10 15.2v2M17.2 10h-2M4.8 10h-2M15.1 4.9l-1.4 1.4M6.3 13.7l-1.4 1.4M15.1 15.1l-1.4-1.4M6.3 6.3 4.9 4.9" />
    </svg>
  );
}

export function IconLock({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <rect x="4" y="9" width="12" height="8" rx="2" />
      <path d="M6.5 9V6.3a3.5 3.5 0 0 1 7 0V9" />
    </svg>
  );
}

export function IconEye({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" {...base}>
      <path d="M2 10s2.8-5.5 8-5.5S18 10 18 10s-2.8 5.5-8 5.5S2 10 2 10Z" />
      <circle cx="10" cy="10" r="2.3" />
    </svg>
  );
}
