import type { ComponentType } from 'react';
import {
  IconBell,
  IconCalendar,
  IconClock,
  IconHome,
  IconMail,
  IconSearch,
  IconReceipt,
  IconSettings,
  IconTag,
  IconUsers,
  IconWallet,
} from '@/components/ui/icons';

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Mostrar también en la barra inferior de móvil. */
  mobile?: boolean;
  /**
   * No listar en el sidebar de escritorio. La ruta sigue existiendo y el
   * item sigue disponible para móvil / lookup de título — sólo se oculta
   * como entrada de primer nivel en desktop porque ahora hay un buscador
   * en vivo en el Topbar que cubre el mismo caso de uso más rápido.
   */
  hideOnDesktopSidebar?: boolean;
};

export type NavSection = {
  label: string;
  items: NavItem[];
};

// Navegación principal de TurnIA. Las rutas ocultas siguen existiendo cuando
// conceptualmente pertenecen a otra sección o tienen un acceso más directo.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard', label: 'Inicio', icon: IconHome, mobile: true },
      { href: '/search', label: 'Buscar', icon: IconSearch, mobile: true, hideOnDesktopSidebar: true },
      { href: '/reminders', label: 'Recordatorios', icon: IconBell },
      { href: '/notifications', label: 'Notificaciones', icon: IconMail },
    ],
  },
  {
    label: 'Consultorio',
    items: [
      { href: '/agenda', label: 'Agenda', icon: IconCalendar, mobile: true },
      { href: '/patients', label: 'Pacientes', icon: IconUsers, mobile: true },
      { href: '/prescriptions', label: 'Recetas', icon: IconReceipt },
      { href: '/planning', label: 'Recurrentes y espera', icon: IconClock, hideOnDesktopSidebar: true },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { href: '/payments', label: 'Pagos y caja', icon: IconWallet, mobile: true },
      { href: '/billing', label: 'Facturación', icon: IconReceipt },
      { href: '/reimbursements', label: 'Reintegros', icon: IconReceipt },
      { href: '/metrics', label: 'Deudas y métricas', icon: IconWallet },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/settings', label: 'Configuración', icon: IconSettings },
      { href: '/services', label: 'Servicios', icon: IconTag, hideOnDesktopSidebar: true },
    ],
  },
];

export const MOBILE_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items).filter(
  (item) => item.mobile,
);
