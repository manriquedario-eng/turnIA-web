'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_SECTIONS } from './nav-items';
import { IconLogout } from '@/components/ui/icons';

export function Sidebar({
  open,
  onClose,
  logoutAction,
  email,
  role,
}: {
  open: boolean;
  onClose: () => void;
  logoutAction: () => void | Promise<void>;
  email: string;
  role: string;
}) {
  const pathname = usePathname();
  const initials = email.slice(0, 2).toUpperCase();

  return (
    <>
      <div className={`sidebar-backdrop ${open ? 'open' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`app-sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">Tu</span>
          TurnIA
        </div>

        <div className="sidebar-profile">
          <div className="sidebar-profile-avatar">{initials}</div>
          <div className="sidebar-profile-copy">
            <div className="sidebar-profile-name">{email}</div>
            <div className="sidebar-profile-role">{role}</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((item) => !item.hideOnDesktopSidebar);
            if (items.length === 0) return null;
            return (
            <div key={section.label}>
              <div className="sidebar-section-label">{section.label}</div>
              {items.map((item) => {
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
            );
          })}
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
