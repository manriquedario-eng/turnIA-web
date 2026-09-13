'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_SECTIONS } from './nav-items';
import { IconLogout } from '@/components/ui/icons';

export function Sidebar({
  open,
  onClose,
  logoutAction,
}: {
  open: boolean;
  onClose: () => void;
  logoutAction: () => void | Promise<void>;
}) {
  const pathname = usePathname();

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`app-sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">Tu</span>
          TurnIA
        </div>

        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`sidebar-link ${isActive ? 'active' : ''}`}
                    onClick={onClose}
                  >
                    <Icon />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <form action={logoutAction}>
            <button type="submit">
              <IconLogout /> Salir
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
