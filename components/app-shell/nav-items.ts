import type { ComponentType } from 'react';
import {
  IconBell,
  IconCalendar,
  IconClock,
  IconHome,
  IconSearch,
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

// Misma información y mismas rutas que el nav anterior — sólo reorganizadas
// en secciones para el nuevo sidebar. No se agrega ni se quita ninguna página.
export const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Principal',
    items: [
      { href: '/dashboard', label: 'Inicio', icon: IconHome, mobile: true },
      { href: '/search', label: 'Buscar', icon: IconSearch, mobile: true, hideOnDesktopSidebar: true },
      // Recordatorios personales — ítem visible en el sidebar de escritorio
      // (antes oculto a propósito; Dario pidió que aparezca como entrada
      // propia en vez de depender sólo de la tarjeta del Dashboard).
      { href: '/reminders', label: 'Recordatorios', icon: IconBell },
    ],
  },
  {
    label: 'Consultorio',
    items: [
      { href: '/agenda', label: 'Agenda', icon: IconCalendar, mobile: true },
      { href: '/patients', label: 'Pacientes', icon: IconUsers, mobile: true },
      // Recurrentes y lista de espera sigue existiendo como ruta — ya no es
      // un ítem propio y permanente del sidebar (conceptualmente es parte
      // de Agenda). Se accede desde el header de Agenda. hideOnDesktopSidebar
      // ya cubre exactamente este caso: no listar en desktop, ruta intacta.
      { href: '/planning', label: 'Recurrentes y espera', icon: IconClock, hideOnDesktopSidebar: true },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { href: '/payments', label: 'Pagos y caja', icon: IconWallet, mobile: true },
      { href: '/metrics', label: 'Deudas y métricas', icon: IconWallet },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/settings', label: 'Configuración', icon: IconSettings },
      // Servicios vive dentro de Configuración (pestaña "Servicios") — la
      // ruta /services sigue existiendo, sólo no es un ítem propio del
      // sidebar de escritorio para no competir con Configuración.
      { href: '/services', label: 'Servicios', icon: IconTag, hideOnDesktopSidebar: true },
    ],
  },
];

export const MOBILE_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items).filter(
  (item) => item.mobile,
);
